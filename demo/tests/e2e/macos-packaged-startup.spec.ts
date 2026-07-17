import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const appBundle = process.env['TOKENLUB_PACKAGED_APP']
const packageVersion = (createRequire(__filename)('../../package.json') as { version: string })
  .version

function executablePath(appPath: string): string {
  return appPath.endsWith('.app') ? join(appPath, 'Contents', 'MacOS', 'TokenLub') : appPath
}

test('starts the packaged macOS app with an isolated profile', async () => {
  test.skip(process.platform !== 'darwin', 'macOS packaged smoke test')
  test.skip(!appBundle, 'TOKENLUB_PACKAGED_APP is required')

  const configuredRoot = process.env['TOKENLUB_TEST_USER_DATA']
  const root = configuredRoot
    ? resolve(configuredRoot)
    : mkdtempSync(join(tmpdir(), 'tokenlub-macos-e2e-'))
  if (configuredRoot) {
    if (existsSync(root)) throw new Error('TOKENLUB_TEST_USER_DATA must not already exist')
    mkdirSync(root, { recursive: true })
  }

  const home = join(root, 'home')
  const userData = join(root, 'user-data')
  mkdirSync(home, { recursive: true })
  let app: ElectronApplication | undefined

  try {
    app = await electron.launch({
      executablePath: executablePath(appBundle!),
      args: [`--user-data-dir=${userData}`, '--disable-gpu'],
      env: { ...process.env, HOME: home }
    })
    const window = await app.firstWindow()

    await expect(window).toHaveTitle('TokenLub')
    await expect(window.locator('body')).not.toBeEmpty()
    await expect(window.evaluate(() => window.api.version)).resolves.toBe(packageVersion)

    const locations = await window.evaluate(() => window.api.log.locations())
    expect(isAbsolute(locations.claudeProjects)).toBe(true)
    expect(isAbsolute(locations.codexSessions)).toBe(true)
    expect(locations).toEqual({
      claudeProjects: join(home, '.claude', 'projects'),
      codexSessions: join(home, '.codex', 'sessions'),
      kimiCodeSessions: join(home, '.kimi-code', 'sessions')
    })
    await expect(window.evaluate(() => window.api.log.discover())).resolves.toEqual({
      claude: [],
      codex: [],
      kimiCode: []
    })

    await window.evaluate(() => window.api.settings.set('macos_e2e_probe', 'ok'))
    await expect(window.evaluate(() => window.api.settings.get())).resolves.toMatchObject({
      macos_e2e_probe: 'ok'
    })

    const created = await window.evaluate(() =>
      window.api.keys.add({
        providerId: 'manual',
        alias: 'macOS E2E synthetic',
        apiKey: 'sk-tokenlub-e2e-only'
      })
    )
    await expect(window.evaluate(() => window.api.keys.list())).resolves.toContainEqual(created)
    await window.evaluate((id) => window.api.keys.delete(id), created.id)
    await expect(window.evaluate(() => window.api.keys.list())).resolves.toEqual([])
    expect(existsSync(join(userData, 'tokenlub.db'))).toBe(true)

    await window.evaluate(() => {
      window.location.hash = '#/logs'
    })
    await expect(window.getByText('请求日志', { exact: true }).first()).toBeVisible()
  } finally {
    await app?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
