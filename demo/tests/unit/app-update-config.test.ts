import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface PackageConfig {
  dependencies: Record<string, string>
  build: {
    publish: Array<Record<string, string>>
    win: { target: Array<{ target: string }> }
  }
}

describe('application update packaging contract', () => {
  it('publishes NSIS update metadata to the MoonMeter GitHub repository', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as PackageConfig

    expect(pkg.dependencies['electron-updater']).toBeTruthy()
    expect(pkg.build.publish).toContainEqual({
      provider: 'github',
      owner: '2488652el',
      repo: 'MoonMeter',
      releaseType: 'release'
    })
    expect(pkg.build.win.target.some((target) => target.target === 'nsis')).toBe(true)
  })
})
