/**
 * preload 版本一致性测试:校验 preload 中暴露的版本号与 package.json 保持同步。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// preload 版本暴露:校验 preload 注入的版本与 package.json 一致
describe('preload version surface', () => {
  it('matches the package version shown by the renderer sidebar', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    const preload = readFileSync('code/src/preload/index.ts', 'utf8')
    const match = preload.match(/version:\s*'([^']+)'/)

    expect(match?.[1]).toBe(pkg.version)
  })
})
