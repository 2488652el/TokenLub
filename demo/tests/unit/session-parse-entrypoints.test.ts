import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRendererPage(name: string): string {
  return readFileSync(resolve(process.cwd(), `code/src/renderer/pages/${name}.tsx`), 'utf8')
}

describe('session parse renderer entrypoints', () => {
  it.each(['Dashboard', 'ProviderSummary', 'RequestLogs'])(
    '%s refresh does not parse local CLI logs',
    (page) => {
      expect(readRendererPage(page)).not.toContain('window.api.log.sync(')
    }
  )

  it('opening API Keys only loads settings and existing statistics', () => {
    const source = readRendererPage('ApiKeys')
    const panelLoad = source.slice(
      source.indexOf('const loadSessionPanel'),
      source.indexOf('/** 计算可选供应商筛选列表')
    )

    expect(panelLoad).not.toContain('window.api.log.sync(')
    expect(source.match(/window\.api\.log\.sync\(/g)).toHaveLength(1)
  })
})
