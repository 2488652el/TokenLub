import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolveCompatibleUserDataPath } from '../../../../code/src/main/platform/user-data-compat'

describe('MoonMeter user-data compatibility', () => {
  const appData = path.join('C:', 'Users', 'tester', 'AppData', 'Roaming')
  const moonMeterProfile = path.join(appData, 'MoonMeter')

  it('keeps upgraded users on the TokenLub profile that owns their encryption context', () => {
    const tokenLubProfile = path.join(appData, 'TokenLub')
    const existing = new Set([
      path.join(tokenLubProfile, 'Local State'),
      path.join(tokenLubProfile, 'tokenlub.db')
    ])

    expect(
      resolveCompatibleUserDataPath(moonMeterProfile, appData, (item) => existing.has(item))
    ).toBe(tokenLubProfile)
  })

  it('accepts a legacy profile that already created the MoonMeter database name', () => {
    const tokenLubProfile = path.join(appData, 'TokenLub')
    const existing = new Set([
      path.join(tokenLubProfile, 'Local State'),
      path.join(tokenLubProfile, 'moonmeter.db')
    ])

    expect(
      resolveCompatibleUserDataPath(moonMeterProfile, appData, (item) => existing.has(item))
    ).toBe(tokenLubProfile)
  })

  it('does not select an incomplete legacy profile without Chromium Local State', () => {
    const tokenLubProfile = path.join(appData, 'TokenLub')
    const existing = new Set([path.join(tokenLubProfile, 'tokenlub.db')])

    expect(
      resolveCompatibleUserDataPath(moonMeterProfile, appData, (item) => existing.has(item))
    ).toBe(moonMeterProfile)
  })

  it('does not redirect an explicitly configured non-MoonMeter profile', () => {
    const customProfile = path.join(appData, 'CustomProfile')
    const tokenLubProfile = path.join(appData, 'TokenLub')
    const existing = new Set([
      path.join(tokenLubProfile, 'Local State'),
      path.join(tokenLubProfile, 'tokenlub.db')
    ])

    expect(
      resolveCompatibleUserDataPath(customProfile, appData, (item) => existing.has(item))
    ).toBe(customProfile)
  })
})
