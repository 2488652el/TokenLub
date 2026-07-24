import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * This suite intentionally launches the built desktop app instead of the
 * renderer in a browser. A fresh, synthetic profile keeps local CLI logs and
 * credentials outside the test's reach.
 */
const electronPath = createRequire(__filename)('electron') as string
const repoRoot = process.cwd()
const builtMain = join(repoRoot, 'demo', 'out', 'main', 'index.js')

const ROUTES = [
  { path: '/', marker: /使用统计|暂无用量数据/ },
  { path: '/agents', marker: '项目用量' },
  { path: '/providers', marker: 'Provider 汇总' },
  { path: '/models', marker: '模型对比' },
  { path: '/logs', marker: '请求日志' },
  { path: '/balance', marker: '余额查询' },
  { path: '/apikeys', marker: 'API Keys' },
  { path: '/pricing', marker: '价格配置' },
  { path: '/alerts', marker: '用量告警' },
  { path: '/settings', marker: '设置' }
] as const

const SENSITIVE_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'MOONMETER_EXCHANGE_ID',
  'MOONMETER_EXCHANGE_KEY',
  'TOKENLUB_EXCHANGE_ID',
  'TOKENLUB_EXCHANGE_KEY',
  'TOKENSCOPE_EXCHANGE_ID',
  'TOKENSCOPE_EXCHANGE_KEY'
]

type RunningAnimation = {
  target: string
  playState: string
  duration: number
  iterations: number
}

type ReducedMotionReport = {
  mediaMatches: boolean
  cssOffenders: string[]
  webAnimationOffenders: RunningAnimation[]
}

/**
 * Seed only the settings needed to keep a fresh profile offline. Electron's
 * bundled Node runtime is used because better-sqlite3 is built for Electron,
 * while the test runner itself may use a different Node ABI.
 */
function seedOfflineSettings(databasePath: string): void {
  const script = [
    "const Database=require('better-sqlite3');",
    'const db=new Database(process.argv[1]);',
    "db.exec('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');",
    "const put=db.prepare('INSERT OR REPLACE INTO app_settings (key,value) VALUES (?,?)');",
    "put.run('pricing_catalog_auto_update','false');",
    "put.run('pricing_exchange_policy','fallback');",
    "put.run('session_auto_parse_enabled','false');",
    'db.close();'
  ].join('')

  const result = spawnSync(electronPath, ['-e', script, databasePath], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.status !== 0) {
    throw new Error('failed to seed the isolated Electron profile')
  }
}

function seedSyntheticModelUsage(databasePath: string): void {
  const fixtures = [
    {
      providerId: 'openrouter',
      model: 'openai/gpt-5.2',
      input: 160000,
      output: 42000,
      cacheRead: 68000,
      cacheWrite: 0,
      promptPrice: 2,
      completionPrice: 8
    },
    {
      providerId: 'claude-code',
      model: 'claude-sonnet-4.5',
      input: 92000,
      output: 26000,
      cacheRead: 44000,
      cacheWrite: 6000,
      promptPrice: 3,
      completionPrice: 15
    },
    {
      providerId: 'gemini-manual',
      model: 'gemini-3-pro',
      input: 78000,
      output: 18000,
      cacheRead: 12000,
      cacheWrite: 0,
      promptPrice: 1.25,
      completionPrice: 5
    },
    {
      providerId: 'moonshot',
      model: 'moonshotai/kimi-k3',
      input: 66000,
      output: 16000,
      cacheRead: 21000,
      cacheWrite: 0,
      promptPrice: 0.8,
      completionPrice: 3
    },
    {
      providerId: 'minimax',
      model: 'MiniMax-M2.5',
      input: 54000,
      output: 14000,
      cacheRead: 9000,
      cacheWrite: 0,
      promptPrice: 0.6,
      completionPrice: 2.4
    },
    {
      providerId: 'deepseek',
      model: 'deepseek-chat',
      input: 43000,
      output: 11000,
      cacheRead: 7000,
      cacheWrite: 0,
      promptPrice: 0.28,
      completionPrice: 0.42
    }
  ]
  const script = [
    "const Database=require('better-sqlite3');",
    'const db=new Database(process.argv[1]);',
    `const fixtures=${JSON.stringify(fixtures)};`,
    "const pricing=db.prepare(`INSERT OR REPLACE INTO pricing_entries (provider_id,billing_scope,model,prompt_price_per_mtok,completion_price_per_mtok,cache_read_price_per_mtok,cache_creation_price_per_mtok,currency,source,catalog_active,updated_at) VALUES (@providerId,'default',@model,@promptPrice,@completionPrice,0.1,0.5,'USD','user',1,@capturedAt)`);",
    "const usage=db.prepare(`INSERT INTO usage_records (provider_id,billing_scope,model,prompt_tokens,completion_tokens,cache_creation_tokens,cache_read_tokens,total_tokens,cost,currency,source,upstream_dimension,message_id,agent_label,captured_at) VALUES (@providerId,'default',@model,@input,@output,@cacheWrite,@cacheRead,@total,0,'USD','session-log','',@messageId,@agentLabel,@capturedAt)`);",
    'const insert=db.transaction((rows)=>{for(const [index,row] of rows.entries()){const capturedAt=new Date(Date.UTC(2026,6,20,8,index)).toISOString();pricing.run({...row,capturedAt});usage.run({...row,total:row.input+row.output,messageId:`model-card-${index}`,agentLabel:index%2===0?`tokenlub`:`vibe-cafe`,capturedAt});}});',
    'insert(fixtures);',
    "const extraPricing=db.prepare(`INSERT OR REPLACE INTO pricing_entries (provider_id,billing_scope,model,prompt_price_per_mtok,completion_price_per_mtok,currency,source,catalog_active,updated_at) VALUES ('manual','default',?,1,2,'USD','catalog',1,?)`);",
    "const seedPricing=db.transaction(()=>{for(let index=0;index<60;index++){extraPricing.run(`pricing-e2e-${String(index).padStart(2,'0')}`,'2026-07-20T08:00:00.000Z');}});",
    'seedPricing();',
    'db.close();'
  ].join('')

  const result = spawnSync(electronPath, ['-e', script, databasePath], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.status !== 0) {
    throw new Error('failed to seed synthetic model usage')
  }
}

function createIsolatedEnvironment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of SENSITIVE_ENV_KEYS) delete env[key]
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS

  const home = join(root, 'home')
  const appData = join(root, 'appdata')
  const localAppData = join(root, 'local-appdata')
  const xdgConfig = join(root, 'xdg-config')
  const xdgData = join(root, 'xdg-data')
  const kimiHome = join(home, '.kimi-code')
  for (const directory of [home, appData, localAppData, xdgConfig, xdgData, kimiHome]) {
    mkdirSync(directory, { recursive: true })
  }

  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    HOMEDRIVE: '',
    HOMEPATH: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_DATA_HOME: xdgData,
    KIMI_CODE_HOME: kimiHome
  })
  return env
}

function profileDatabasePath(profileRoot: string): string {
  return join(profileRoot, 'user-data', 'moonmeter.db')
}

async function runningAnimations(page: Page): Promise<RunningAnimation[]> {
  return page.evaluate(() => {
    const describe = (animation: Animation): RunningAnimation => {
      const effect = animation.effect
      const timing = effect?.getComputedTiming()
      const duration =
        typeof timing?.duration === 'number' ? timing.duration : Number(timing?.duration ?? 0)
      const iterations =
        typeof timing?.iterations === 'number' ? timing.iterations : Number(timing?.iterations ?? 1)
      const target =
        effect && 'target' in effect ? ((effect as KeyframeEffect).target as Element | null) : null
      const className =
        target && typeof target.className === 'string'
          ? `.${target.className.trim().replace(/\s+/g, '.')}`
          : ''
      return {
        target: target
          ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${className}`
          : 'document',
        playState: animation.playState,
        duration,
        iterations
      }
    }

    return document
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running' || animation.pending)
      .map(describe)
  })
}

async function reducedMotionReport(page: Page): Promise<ReducedMotionReport> {
  return page.evaluate(() => {
    const maxDurationMs = (value: string): number =>
      value.split(',').reduce((max, token) => {
        const trimmed = token.trim()
        const number = Number.parseFloat(trimmed)
        if (!Number.isFinite(number)) return max
        return Math.max(
          max,
          trimmed.endsWith('s') && !trimmed.endsWith('ms') ? number * 1000 : number
        )
      }, 0)

    const cssOffenders: string[] = []
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      for (const pseudo of [undefined, '::before', '::after'] as const) {
        const style = getComputedStyle(element, pseudo)
        const animationDuration = maxDurationMs(style.animationDuration)
        const transitionDuration = maxDurationMs(style.transitionDuration)
        if (animationDuration > 50 || transitionDuration > 50) {
          const label = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`
          cssOffenders.push(`${label}${pseudo ?? ''}`)
        }
      }
    }

    const webAnimationOffenders = document
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running' || animation.pending)
      .map((animation) => {
        const effect = animation.effect
        const timing = effect?.getComputedTiming()
        const duration =
          typeof timing?.duration === 'number' ? timing.duration : Number(timing?.duration ?? 0)
        const iterations =
          typeof timing?.iterations === 'number'
            ? timing.iterations
            : Number(timing?.iterations ?? 1)
        const target =
          effect && 'target' in effect
            ? ((effect as KeyframeEffect).target as Element | null)
            : null
        return {
          target: target
            ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}`
            : 'document',
          playState: animation.playState,
          duration,
          iterations
        }
      })
      .filter((animation) => animation.duration > 50 || animation.iterations === Infinity)

    return {
      mediaMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      cssOffenders,
      webAnimationOffenders
    }
  })
}

async function navigateTo(page: Page, route: (typeof ROUTES)[number]): Promise<void> {
  await page.evaluate((path) => {
    window.location.hash = `#${path}`
  }, route.path)
  await expect
    .poll(() => page.evaluate(() => window.location.hash), {
      timeout: 5_000,
      message: `hash route ${route.path} did not become active`
    })
    .toBe(`#${route.path}`)
  await expect(page.locator('.page-content')).toBeVisible()
  await expect(page.locator('.page-content')).toContainText(route.marker)
}

async function expectSettled(page: Page): Promise<void> {
  await expect
    .poll(() => runningAnimations(page), {
      timeout: 8_000,
      intervals: [100, 250, 500],
      message: 'route retained a running CSS/Web Animation after settling'
    })
    .toEqual([])
}

async function dragFirstCardToSecond(page: Page): Promise<string[]> {
  const grid = page.locator('[data-sortable-grid]')
  const items = grid.locator('[data-sortable-id]')
  await expect(items).toHaveCount(3)
  const before = await items.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.sortableId ?? '')
  )
  const firstHandle = items.nth(0).locator('[data-drag-handle]')
  await firstHandle.scrollIntoViewIfNeeded()
  const handleBox = await firstHandle.boundingBox()
  const targetBox = await items.nth(1).boundingBox()
  if (!handleBox || !targetBox) throw new Error('sortable card bounds were unavailable')

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 8,
    handleBox.y + handleBox.height / 2 + 8,
    {
      steps: 3
    }
  )
  await expect(items.nth(0)).toHaveClass(/is-dragging/)
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 8
  })
  await expect(grid.locator('.is-sort-target')).toHaveCount(1)
  await expect
    .poll(() =>
      grid.locator('.is-sort-target').evaluate((element) => getComputedStyle(element).transform)
    )
    .not.toBe('none')
  await page.mouse.up()

  const expected = [before[1], before[0], ...before.slice(2)]
  await expect
    .poll(() =>
      items.evaluateAll((elements) =>
        elements.map((element) => (element as HTMLElement).dataset.sortableId ?? '')
      )
    )
    .toEqual(expected)
  return expected
}

test.describe.serial('Electron motion and accessibility', () => {
  test.describe.configure({ timeout: 90_000 })

  let app: ElectronApplication | undefined
  let page: Page | undefined
  let profileRoot: string | undefined

  test.beforeAll(async () => {
    expect(existsSync(builtMain), 'run npm run build before this Electron suite').toBe(true)

    profileRoot = mkdtempSync(join(tmpdir(), 'tokenlub-motion-e2e-'))
    const userData = join(profileRoot, 'user-data')
    mkdirSync(userData, { recursive: true })
    seedOfflineSettings(profileDatabasePath(profileRoot))

    app = await electron.launch({
      executablePath: electronPath,
      args: [
        '.',
        `--user-data-dir=${userData}`,
        '--disable-gpu',
        '--disable-background-networking',
        '--host-resolver-rules=MAP * 0.0.0.0,EXCLUDE localhost,EXCLUDE 127.0.0.1'
      ],
      cwd: repoRoot,
      env: createIsolatedEnvironment(profileRoot)
    })
    page = await app.firstWindow()
    page.setDefaultTimeout(8_000)
    await expect(page).toHaveTitle('MoonMeter')
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 })
    seedSyntheticModelUsage(profileDatabasePath(profileRoot))
    await page.evaluate(async () => {
      for (const alias of ['拖拽测试 Alpha', '拖拽测试 Beta', '拖拽测试 Gamma']) {
        await window.api.keys.add({
          providerId: 'manual',
          alias,
          apiKey: `sk-tokenlub-${alias}`,
          usageQueryEnabled: false
        })
      }
    })
  })

  test.afterAll(async () => {
    await app?.close()
    if (profileRoot) rmSync(profileRoot, { recursive: true, force: true })
  })

  test('renders all hash routes and settles without a persistent animation', async () => {
    const window = page
    if (!window) throw new Error('Electron window was not created')

    await window.emulateMedia({ reducedMotion: 'no-preference' })
    for (const route of ROUTES) {
      await navigateTo(window, route)
      await expectSettled(window)
    }
  })

  test('renders the dashboard metric grid and keeps range controls responsive', async ({
    browserName: _browserName
  }, testInfo) => {
    const window = page
    if (!window) throw new Error('Electron window was not created')
    expect(_browserName).toBe('chromium')
    const runtimeErrors: string[] = []
    const onConsole = (message: { type(): string; text(): string }) => {
      if (message.type() === 'error') runtimeErrors.push(message.text())
    }
    const onPageError = (error: Error) => runtimeErrors.push(error.message)
    window.on('console', onConsole)
    window.on('pageerror', onPageError)

    try {
      await navigateTo(
        window,
        ROUTES.find((item) => item.path === '/settings')!
      )
      await navigateTo(
        window,
        ROUTES.find((item) => item.path === '/')!
      )
      const metrics = window.locator('[data-dashboard-metric]')
      await expect(metrics).toHaveCount(8)
      await expect(metrics.filter({ hasText: '计价覆盖' })).toContainText('%')
      await expect(metrics.filter({ hasText: '最近数据' })).not.toContainText('Invalid')

      const sevenDays = window.getByRole('button', { name: '7 天', exact: true })
      await sevenDays.click()
      await expect(sevenDays).toHaveAttribute('aria-pressed', 'true')
      await expect(window.getByRole('button', { name: '30 天', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false'
      )

      const filterBar = window.locator('[data-usage-filter-bar]')
      await expect(filterBar).toBeVisible()
      await window.getByLabel('全局模型筛选').fill('gpt-5.2')
      await window.getByLabel('全局项目筛选').fill('tokenlub')
      await filterBar.getByRole('button', { name: 'CLI 会话', exact: true }).click()
      await filterBar.getByRole('button', { name: '应用', exact: true }).click()
      await expect(metrics.filter({ hasText: '总请求数' })).toContainText('1')

      await navigateTo(
        window,
        ROUTES.find((item) => item.path === '/logs')!
      )
      await expect(window.getByLabel('模型筛选')).toHaveValue('gpt-5.2')
      await expect(window.getByLabel('项目筛选')).toHaveValue('tokenlub')
      await expect(window.getByRole('row', { name: /openai\/gpt-5\.2/ })).toContainText('tokenlub')
      await window.screenshot({
        path: testInfo.outputPath('request-logs-filtered.png'),
        animations: 'disabled'
      })

      await navigateTo(
        window,
        ROUTES.find((item) => item.path === '/')!
      )
      const refresh = window.getByRole('button', { name: '刷新', exact: true })
      await refresh.click()
      await expect(refresh).toBeEnabled()
      await expect(metrics).toHaveCount(8)

      for (const viewport of [
        { width: 1280, height: 900, name: 'desktop' },
        { width: 900, height: 760, name: 'compact' }
      ]) {
        await window.setViewportSize(viewport)
        await window.locator('.page-content').evaluate((element) => {
          element.scrollTop = 0
        })
        await expect(metrics.first()).toBeVisible()
        expect(
          await window.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true)
        await window.screenshot({
          path: testInfo.outputPath(`dashboard-${viewport.name}.png`),
          animations: 'disabled'
        })
      }

      await window.setViewportSize({ width: 1280, height: 900 })
      await window.getByRole('button', { name: '深色' }).first().click()
      await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark')
      await window.locator('.page-content').evaluate((element) => {
        element.scrollTop = 0
      })
      await window.screenshot({
        path: testInfo.outputPath('dashboard-dark.png'),
        animations: 'disabled'
      })
      await window.locator('[data-usage-filter-bar]').getByRole('button', { name: '清除' }).click()
      expect(runtimeErrors).toEqual([])
    } finally {
      window.off('console', onConsole)
      window.off('pageerror', onPageError)
    }
  })

  test('honors prefers-reduced-motion for CSS and Web Animations on every route', async () => {
    const window = page
    if (!window) throw new Error('Electron window was not created')

    await window.emulateMedia({ reducedMotion: 'reduce' })
    for (const route of ROUTES) {
      await navigateTo(window, route)
      await window.waitForTimeout(50)
      const report = await reducedMotionReport(window)
      expect(report.mediaMatches).toBe(true)
      expect(report.cssOffenders, `${route.path} has a long CSS transition/animation`).toEqual([])
      expect(
        report.webAnimationOffenders,
        `${route.path} has a long-running Web Animation`
      ).toEqual([])
    }
  })

  test('switches and persists the MoonMeter appearance without exposing the legacy brand', async () => {
    const window = page
    if (!window) throw new Error('Electron window was not created')

    await navigateTo(
      window,
      ROUTES.find((item) => item.path === '/settings')!
    )
    await window.getByRole('button', { name: '深色' }).first().click()
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect
      .poll(() => window.evaluate(() => localStorage.getItem('moonmeter.appearance.v1')))
      .toBe('dark')
    await window.reload()
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(window.locator('body')).toContainText('MoonMeter')
    await expect(window.locator('body')).not.toContainText('TokenLub')

    await window.getByRole('button', { name: '跟随系统' }).first().click()
    await expect
      .poll(() => window.evaluate(() => localStorage.getItem('moonmeter.appearance.v1')))
      .toBe('system')
    await window.emulateMedia({ colorScheme: 'light' })
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'light')
    await window.emulateMedia({ colorScheme: 'dark' })
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('closes the API key modal with Escape and restores focus', async () => {
    const window = page
    if (!window) throw new Error('Electron window was not created')

    await window.emulateMedia({ reducedMotion: 'no-preference' })
    const route = ROUTES.find((item) => item.path === '/apikeys')!
    await navigateTo(window, route)
    const createButton = window.getByRole('button', { name: /创建新 Key/ }).first()
    await expect(createButton).toBeVisible()
    await createButton.click()

    const dialog = window.getByRole('dialog', { name: '创建新 API Key' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await window.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 2_000 })
    await expect(createButton).toBeFocused()
    await expectSettled(window)
  })

  test('renders model usage cards with LobeHub logos and token composition', async () => {
    const window = page
    if (!window) throw new Error('Electron window was not created')

    await navigateTo(
      window,
      ROUTES.find((item) => item.path === '/models')!
    )
    const cards = window.locator('[data-model-card]')
    await expect(cards).toHaveCount(6)
    await expect(cards.locator('[data-model-logo]')).toHaveCount(6)
    await expect(cards.first()).toContainText('Token 构成')
    await expect(cards.first()).toContainText('计价覆盖')
    await expect(window.getByText('LobeHub Icons', { exact: false })).toBeVisible()
  })

  test('keeps pricing controls compact and paginates the catalog', async () => {
    const window = page
    if (!window) throw new Error('Electron window was not created')

    await navigateTo(
      window,
      ROUTES.find((item) => item.path === '/pricing')!
    )

    const settings = window.locator('[data-pricing-settings]')
    await expect(settings).not.toHaveAttribute('open', '')
    await settings.locator('summary').click()
    await expect(window.getByRole('button', { name: /恢复全部官方价/ })).toBeVisible()

    const rows = window.locator('[data-pricing-row]')
    await expect(rows).toHaveCount(50)
    await window.getByRole('button', { name: /下一页/ }).click()
    await expect(window.getByText(/显示 51–/)).toBeVisible()
    await expect(rows).not.toHaveCount(50)

    await window.getByRole('textbox', { name: '搜索模型或 Provider' }).fill('gpt-5.2')
    await expect(rows.first()).toContainText('gpt-5.2')
    await expect(rows).not.toHaveCount(50)
  })

  test('drags and persists API key and balance card order with visible feedback', async () => {
    const window = page
    if (!window) throw new Error('Electron window was not created')

    await navigateTo(
      window,
      ROUTES.find((item) => item.path === '/apikeys')!
    )
    const apiKeyOrder = await dragFirstCardToSecond(window)
    await expect
      .poll(() =>
        window.evaluate(() =>
          JSON.parse(localStorage.getItem('moonmeter.api-key-card-order.v1') ?? '[]')
        )
      )
      .toEqual(apiKeyOrder)

    await window.reload()
    await expect(window.locator('#root')).not.toBeEmpty({ timeout: 15_000 })
    await navigateTo(
      window,
      ROUTES.find((item) => item.path === '/apikeys')!
    )
    await expect
      .poll(() =>
        window
          .locator('[data-sortable-grid] [data-sortable-id]')
          .evaluateAll((elements) =>
            elements.map((element) => (element as HTMLElement).dataset.sortableId ?? '')
          )
      )
      .toEqual(apiKeyOrder)

    await navigateTo(
      window,
      ROUTES.find((item) => item.path === '/balance')!
    )
    const balanceGrid = window.locator('[data-sortable-grid]')
    await expect(balanceGrid.locator('[data-sortable-id]')).toHaveCount(4)
    const firstBalanceHandle = balanceGrid.locator('[data-drag-handle]').first()
    await firstBalanceHandle.focus()
    await firstBalanceHandle.press('ArrowRight')
    const balanceOrder = await balanceGrid
      .locator('[data-sortable-id]')
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLElement).dataset.sortableId ?? '')
      )
    await expect
      .poll(() =>
        window.evaluate(() =>
          JSON.parse(localStorage.getItem('moonmeter.balance-card-order.v1') ?? '[]')
        )
      )
      .toEqual(balanceOrder)
    await expect(window.locator('[aria-live="polite"]')).toContainText('已移动到第 2 位')
  })
})
