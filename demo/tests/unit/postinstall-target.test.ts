import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { getPrebuildTarget } = require('../../../code/scripts/postinstall-target.cjs') as {
  getPrebuildTarget: (input: {
    platform: string
    arch: string
    electronVersion: string
  }) => string[]
}

describe('postinstall prebuild target', () => {
  it('resolves dependencies from the project root after script classification', () => {
    const script = readFileSync('code/scripts/postinstall-better-sqlite3.cjs', 'utf8')
    expect(script).toContain("path.join(__dirname, '..', '..')")
  })

  it.each([
    ['darwin', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'x64']
  ])('%s + %s uses the current Electron target', (platform, arch) => {
    expect(getPrebuildTarget({ platform, arch, electronVersion: '31.3.0' })).toEqual([
      '--runtime=electron',
      '--target=31.3.0',
      `--arch=${arch}`,
      `--platform=${platform}`
    ])
  })
})
