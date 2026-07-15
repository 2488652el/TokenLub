import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { getPrebuildTarget } = require('../../scripts/postinstall-target.cjs') as {
  getPrebuildTarget: (input: {
    platform: string
    arch: string
    electronVersion: string
  }) => string[]
}

describe('postinstall prebuild target', () => {
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
