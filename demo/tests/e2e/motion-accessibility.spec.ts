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
  return join(profileRoot, 'user-data', 'tokenlub.db')
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
    await expect(page).toHaveTitle('TokenLub')
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 })
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
          JSON.parse(localStorage.getItem('tokenlub.api-key-card-order.v1') ?? '[]')
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
          JSON.parse(localStorage.getItem('tokenlub.balance-card-order.v1') ?? '[]')
        )
      )
      .toEqual(balanceOrder)
    await expect(window.locator('[aria-live="polite"]')).toContainText('已移动到第 2 位')
  })
})
