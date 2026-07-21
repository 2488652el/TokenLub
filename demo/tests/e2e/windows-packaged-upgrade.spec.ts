import { expect, test } from '@playwright/test'
import { _electron as electron, type ElectronApplication } from 'playwright'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const packagedApp = process.env['MOONMETER_PACKAGED_APP']
const legacyProfileSource = process.env['MOONMETER_LEGACY_PROFILE_SOURCE']

test('starts the packaged app with the TokenLub safeStorage profile after rebranding', async () => {
  test.skip(process.platform !== 'win32', 'Windows packaged upgrade smoke test')
  test.skip(!packagedApp, 'MOONMETER_PACKAGED_APP is required')
  test.skip(!legacyProfileSource, 'MOONMETER_LEGACY_PROFILE_SOURCE is required')

  const root = mkdtempSync(join(tmpdir(), 'moonmeter-upgrade-'))
  const legacyProfile = join(root, 'TokenLub')
  mkdirSync(legacyProfile, { recursive: true })

  for (const fileName of ['Local State', 'tokenlub.db', 'tokenlub.db-wal', 'tokenlub.db-shm']) {
    const source = join(legacyProfileSource!, fileName)
    if (existsSync(source)) copyFileSync(source, join(legacyProfile, fileName))
  }
  if (!existsSync(join(legacyProfile, 'Local State'))) {
    throw new Error('Legacy profile fixture is missing Local State')
  }
  if (!existsSync(join(legacyProfile, 'tokenlub.db'))) {
    throw new Error('Legacy profile fixture is missing tokenlub.db')
  }

  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      executablePath: packagedApp!,
      args: [`--user-data-dir=${join(root, 'MoonMeter')}`, '--disable-gpu'],
      env: {
        ...process.env,
        APPDATA: root,
        LOCALAPPDATA: join(root, 'local')
      }
    })
    const window = await app.firstWindow({ timeout: 15_000 })

    await expect(window).toHaveTitle('MoonMeter')
    await expect(window.locator('body')).not.toBeEmpty()
    await expect(window.evaluate(() => window.api.version)).resolves.toBe('1.2.1')
    const selectedUserData = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData')
    )
    expect(selectedUserData).toBe(legacyProfile)
    expect(existsSync(join(legacyProfile, 'moonmeter.db'))).toBe(true)
    expect(existsSync(join(root, 'MoonMeter', 'moonmeter.db'))).toBe(false)
    expect(basename(legacyProfile)).toBe('TokenLub')
  } finally {
    await app?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
