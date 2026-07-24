import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryCalls: Array<{ sql: string; args: unknown[] }> = []

vi.mock('../../../../code/src/main/store/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (...args: unknown[]) => {
        queryCalls.push({ sql, args })
        return {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
          totalRequests: 0
        }
      },
      all: (...args: unknown[]) => {
        queryCalls.push({ sql, args })
        return []
      }
    })
  })
}))

describe('usage analysis aggregate filters', () => {
  beforeEach(() => {
    queryCalls.length = 0
  })

  it('applies source, model and project to every dashboard aggregate query', async () => {
    const { getDashboardSummary } = await import('../../../../code/src/main/store/usage-repo')

    getDashboardSummary({
      days: 0,
      source: 'session-log',
      modelContains: 'GPT',
      projectContains: 'TokenLub'
    })

    expect(queryCalls).toHaveLength(3)
    for (const call of queryCalls) {
      expect(call.sql).toContain('source = ?')
      expect(call.sql).toContain('LOWER(model) LIKE LOWER(?)')
      expect(call.sql).toContain("LOWER(COALESCE(agent_label, '')) LIKE LOWER(?)")
      expect(call.args).toEqual(['session-log', '%GPT%', '%TokenLub%'])
    }
  })

  it('uses the same filter builder for spend aggregation', async () => {
    const { computeTotalSpend } = await import('../../../../code/src/main/store/usage-repo')

    computeTotalSpend({ days: 0, projectContains: 'tokenlub' })

    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0]?.sql).toContain("LOWER(COALESCE(agent_label, '')) LIKE LOWER(?)")
    expect(queryCalls[0]?.args).toEqual(['%tokenlub%'])
  })
})
