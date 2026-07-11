/** 自定义 postinstall 脚本测试:原生预编译下载失败时应交由 electron-builder 重建。 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('postinstall-better-sqlite3', () => {
  it('defers a failed prebuild download to electron-builder instead of invoking an undeclared node-gyp', () => {
    const source = readFileSync(resolve('scripts/postinstall-better-sqlite3.cjs'), 'utf8')

    expect(source).toContain('deferring native rebuild to electron-builder')
    expect(source).not.toContain("node_modules', 'node-gyp'")
  })
})
