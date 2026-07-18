import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(process.cwd(), 'code/src/renderer/pages/RequestLogs.tsx'),
  'utf8'
)
const tableHeader = source.slice(source.indexOf('<thead'), source.indexOf('</thead>'))

describe('请求日志界面', () => {
  it('使用中文表头并将币种合并进费用列', () => {
    for (const label of [
      '时间',
      '供应商',
      '模型',
      '来源',
      '输入量',
      '输出量',
      '缓存读取',
      '缓存写入',
      '费用'
    ]) {
      expect(tableHeader).toContain(label)
    }
    expect(tableHeader).not.toContain('Currency')
  })

  it('使用供应商下拉和中文来源文案', () => {
    expect(source).toContain('<select')
    expect(source).toContain('全部供应商')
    expect(source).toContain("'API 调用'")
    expect(source).toContain("'CLI 会话'")
    expect(source).not.toContain('function FilterChip')
  })
})
