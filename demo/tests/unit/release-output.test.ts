import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { buildNodeCliCommand, buildReleaseOutputDirectory, sanitizeSegment } =
  require('../../../code/scripts/package-release.cjs') as {
    buildNodeCliCommand: (
      cliPath: string,
      args: string[],
      nodeExecutable?: string
    ) => { command: string; args: string[] }
    buildReleaseOutputDirectory: (input: {
      version: string
      change: string
      model: string
    }) => string
    sanitizeSegment: (value: string, label: string) => string
  }

describe('release output directory', () => {
  it('runs command-line tools through Node instead of Windows cmd wrappers', () => {
    expect(buildNodeCliCommand('C:\\npm\\npm-cli.js', ['run', 'build'], 'node.exe')).toEqual({
      command: 'node.exe',
      args: ['C:\\npm\\npm-cli.js', 'run', 'build']
    })
  })

  it('uses version, change summary, and execution model under demo', () => {
    expect(
      buildReleaseOutputDirectory({
        version: '1.0.5',
        change: '项目目录分类',
        model: 'GPT-5'
      }).replace(/\\/g, '/')
    ).toBe('demo/moonmeter-1.0.5-项目目录分类-GPT-5')
  })

  it('replaces filesystem-unsafe characters', () => {
    expect(sanitizeSegment('修复 / 首页:*', '修改说明')).toBe('修复-首页')
  })

  it('rejects missing metadata', () => {
    expect(() => sanitizeSegment('   ', '执行模型')).toThrow('缺少执行模型')
  })
})
