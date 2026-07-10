/** 用量日志分页测试:覆盖 getLogsPage 的分页与排序逻辑。 (glm-5.2) */
import { describe, expect, it, vi } from 'vitest'

interface UsageRow {
  id: number
  api_key_id: string | null
  provider_id: string
  model: string
  period_start: string | null
  period_end: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  cache_creation_tokens: number | null
  cache_read_tokens: number | null
  total_tokens: number | null
  cost: number | null
  currency: string | null
  source: string
  session_id: string | null
  message_id: string | null
  agent_label: string | null
  captured_at: string
}

const usageRows: UsageRow[] = [
  row(1, '2026-07-06T12:00:00.000Z', 'glm-5.2'),
  row(2, '2026-07-06T11:00:00.000Z', 'glm-5.2'),
  row(3, '2026-07-06T10:00:00.000Z', 'glm-5.2'),
  row(4, '2026-07-05T09:00:00.000Z', 'gpt-4o')
]

function row(id: number, capturedAt: string, model: string): UsageRow {
  return {
    id,
    api_key_id: null,
    provider_id: 'claude-code',
    model,
    period_start: null,
    period_end: null,
    prompt_tokens: 100,
    completion_tokens: 50,
    cache_creation_tokens: null,
    cache_read_tokens: null,
    total_tokens: 150,
    cost: null,
    currency: null,
    source: 'session-log',
    session_id: null,
    message_id: `m-${id}`,
    agent_label: null,
    captured_at: capturedAt
  }
}

function matches(sql: string, args: unknown[], item: UsageRow) {
  let i = 0
  if (sql.includes('provider_id = ?') && item.provider_id !== args[i++]) return false
  if (sql.includes('captured_at >= ?') && item.captured_at < (args[i++] as string)) return false
  if (sql.includes('captured_at <= ?') && item.captured_at > (args[i++] as string)) return false
  if (sql.includes('source = ?') && item.source !== args[i++]) return false
  if (sql.includes('LOWER(model) LIKE LOWER(?)')) {
    const needle = String(args[i++]).replaceAll('%', '').toLowerCase()
    if (!item.model.toLowerCase().includes(needle)) return false
  }
  return true
}

vi.mock('../../../src/main/store/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => {
        if (sql.includes('FROM pricing_entries')) return []
        if (!sql.includes('FROM usage_records')) throw new Error(`unexpected SQL: ${sql}`)
        const limit = args.at(-2) as number
        const offset = args.at(-1) as number
        return usageRows
          .filter((item) => matches(sql, args.slice(0, -2), item))
          .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
          .slice(offset, offset + limit)
      },
      get: (...args: unknown[]) => {
        if (!sql.includes('COUNT(*) AS total')) throw new Error(`unexpected SQL: ${sql}`)
        return {
          total: usageRows.filter((item) => matches(sql, args, item)).length
        }
      }
    })
  })
}))

// 用量日志分页测试套件:验证 queryUsagePage 的切片、总数与排序行为
describe('queryUsagePage', () => {
  it('returns the requested slice and total count for matching logs', async () => {
    const { queryUsagePage } = await import('../../../src/main/store/usage-repo')

    const page = queryUsagePage({
      fromISO: '2026-07-06T00:00:00.000Z',
      toISO: '2026-07-06T23:59:59.999Z',
      source: 'session-log',
      limit: 2,
      offset: 1
    })

    expect(page.total).toBe(3)
    expect(page.limit).toBe(2)
    expect(page.offset).toBe(1)
    expect(page.rows.map((r) => r.id)).toEqual([2, 3])
  })
})
