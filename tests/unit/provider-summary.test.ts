/**
 * provider 聚合工具单元测试:覆盖 computeTrend / formatPct / aggregateByModel /
 * topModelsForProvider / weekWindows / providerWeekWindows / buildDailyCostSeries。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import {
  aggregateByModel,
  buildDailyCostSeries,
  computeTrend,
  providerWeekWindows,
  topModelsForProvider,
  weekWindows
} from '@shared/utils/provider-aggregation'
import { formatPct } from '@shared/utils/money'
import type { UsageRecord } from '@shared/types/usage'

const NOW = new Date('2026-07-06T12:00:00Z')
const DAY_MS = 86_400_000

function rec(partial: Partial<UsageRecord>): UsageRecord {
  return {
    providerId: 'p1',
    model: 'm1',
    source: 'session-log',
    capturedAt: new Date().toISOString(),
    cost: 0,
    ...partial
  } as UsageRecord
}

// computeTrend:计算环比涨跌百分比,含空值与除零防御
describe('computeTrend', () => {
  it('returns null when either side is null', () => {
    expect(computeTrend(null, 10)).toBeNull()
    expect(computeTrend(10, null)).toBeNull()
    expect(computeTrend(undefined, 10)).toBeNull()
  })

  it('returns 0 when costs are equal', () => {
    expect(computeTrend(10, 10)).toBe(0)
  })

  it('returns positive percent when current > previous', () => {
    expect(computeTrend(15, 10)).toBeCloseTo(50, 5)
  })

  it('returns negative percent when current < previous', () => {
    expect(computeTrend(5, 10)).toBeCloseTo(-50, 5)
  })

  it('falls back to 100% when previous is 0 and current is positive', () => {
    // ponytail: 0 → N is "infinite" growth; saturated to 100 so the UI
    // never shows NaN.
    expect(computeTrend(10, 0)).toBe(100)
  })

  it('returns 0 when both are zero', () => {
    expect(computeTrend(0, 0)).toBe(0)
  })

  it('ignores non-finite numbers', () => {
    expect(computeTrend(Number.NaN, 10)).toBeNull()
    expect(computeTrend(10, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

// formatPct:将比率格式化为带百分号的展示字符串
describe('formatPct', () => {
  it('returns — for null / undefined / NaN', () => {
    expect(formatPct(null)).toBe('—')
    expect(formatPct(undefined)).toBe('—')
    expect(formatPct(Number.NaN)).toBe('—')
  })

  it('formats a positive ratio as one decimal place', () => {
    expect(formatPct(12.345)).toBe('12.3%')
    expect(formatPct(0)).toBe('0.0%')
    expect(formatPct(-25.5)).toBe('-25.5%')
  })
})

// aggregateByModel:按模型聚合用量(成本/Token/请求数/来源商)
describe('aggregateByModel', () => {
  it('groups logs by model, sums cost / tokens, counts requests, lists providers', () => {
    const logs: UsageRecord[] = [
      rec({ providerId: 'a', model: 'gpt-4', cost: 3, totalTokens: 1000 }),
      rec({ providerId: 'a', model: 'gpt-4', cost: 5, totalTokens: 2000 }),
      rec({ providerId: 'b', model: 'gpt-4', cost: 2, totalTokens: 500 }),
      rec({ providerId: 'b', model: 'claude', cost: 10, totalTokens: 4000 })
    ]
    const out = aggregateByModel(logs, 'CNY')
    const gpt4 = out.find((x) => x.model === 'gpt-4')!
    const claude = out.find((x) => x.model === 'claude')!
    expect(gpt4.cost).toBe(10)
    expect(gpt4.tokens).toBe(3500)
    expect(gpt4.requests).toBe(3)
    expect(gpt4.providers.sort()).toEqual(['a', 'b'])
    expect(claude.cost).toBe(10)
    expect(claude.requests).toBe(1)
    expect(claude.providers).toEqual(['b'])
    // sorted desc by cost
    expect(out[0]?.cost).toBeGreaterThanOrEqual(out[1]?.cost ?? 0)
  })

  it('treats blank model as (unknown)', () => {
    const logs: UsageRecord[] = [rec({ model: '', cost: 1 })]
    const out = aggregateByModel(logs, 'CNY')
    expect(out[0]?.model).toBe('(unknown)')
  })

  it('returns empty list when no logs', () => {
    expect(aggregateByModel([], 'CNY')).toEqual([])
  })
})

// topModelsForProvider:返回指定来源商成本最高的前 N 个模型
describe('topModelsForProvider', () => {
  it('returns top N models for a provider, sorted by cost desc', () => {
    const logs: UsageRecord[] = [
      rec({ providerId: 'a', model: 'm1', cost: 5 }),
      rec({ providerId: 'a', model: 'm2', cost: 20 }),
      rec({ providerId: 'a', model: 'm3', cost: 1 }),
      rec({ providerId: 'a', model: 'm2', cost: 5 }), // m2 total = 25
      rec({ providerId: 'b', model: 'm2', cost: 999 }) // ignore
    ]
    const top = topModelsForProvider(logs, 'a', 2)
    expect(top.map((x) => x.model)).toEqual(['m2', 'm1'])
    expect(top[0]?.cost).toBe(25)
  })

  it('returns empty list when provider has no logs', () => {
    expect(topModelsForProvider([], 'a', 3)).toEqual([])
    expect(topModelsForProvider([rec({ providerId: 'b' })], 'a', 3)).toEqual([])
  })
})

// weekWindows:按当前7天/上7天划分用量并分别汇总成本
describe('weekWindows', () => {
  it('partitions logs into current-7d vs previous-7d buckets anchored at now', () => {
    const logs: UsageRecord[] = [
      rec({ capturedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(), cost: 100 }), // current
      rec({ capturedAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString(), cost: 50 }), // current
      rec({ capturedAt: new Date(NOW.getTime() - 8 * DAY_MS).toISOString(), cost: 30 }), // previous
      rec({ capturedAt: new Date(NOW.getTime() - 12 * DAY_MS).toISOString(), cost: 20 }), // previous
      rec({ capturedAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(), cost: 999 }) // ignored
    ]
    const w = weekWindows(NOW, logs)
    expect(w.currentWeek).toBe(150)
    expect(w.previousWeek).toBe(50)
  })

  it('returns 0/0 when no logs fit either window', () => {
    const w = weekWindows(NOW, [])
    expect(w).toEqual({ currentWeek: 0, previousWeek: 0 })
  })

  it('skips records with unparseable capturedAt', () => {
    const logs: UsageRecord[] = [rec({ capturedAt: 'not-a-date', cost: 999 })]
    const w = weekWindows(NOW, logs)
    expect(w).toEqual({ currentWeek: 0, previousWeek: 0 })
  })
})

// providerWeekWindows:按来源商维度计算本周/上周成本窗口
describe('providerWeekWindows', () => {
  it('sums only the requested provider logs in each window', () => {
    const logs: UsageRecord[] = [
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
        cost: 100
      }),
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 8 * DAY_MS).toISOString(),
        cost: 40
      }),
      rec({
        providerId: 'b',
        capturedAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
        cost: 999
      }),
      rec({
        providerId: 'b',
        capturedAt: new Date(NOW.getTime() - 9 * DAY_MS).toISOString(),
        cost: 888
      }),
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        cost: 777
      })
    ]
    const w = providerWeekWindows(NOW, logs, 'a')
    expect(w.currentWeek).toBe(100)
    expect(w.previousWeek).toBe(40)
  })

  it('returns 0/0 when the provider has no logs', () => {
    const logs: UsageRecord[] = [
      rec({
        providerId: 'b',
        capturedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
        cost: 10
      })
    ]
    expect(providerWeekWindows(NOW, logs, 'a')).toEqual({ currentWeek: 0, previousWeek: 0 })
  })

  it('matches weekWindows boundaries exactly for a single provider', () => {
    const logs: UsageRecord[] = [
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
        cost: 10
      }),
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 5 * DAY_MS).toISOString(),
        cost: 20
      }),
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 8 * DAY_MS).toISOString(),
        cost: 30
      }),
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 12 * DAY_MS).toISOString(),
        cost: 40
      }),
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        cost: 999
      })
    ]
    expect(providerWeekWindows(NOW, logs, 'a')).toEqual(weekWindows(NOW, logs))
  })

  it('produces exact per-provider costs, not a global percentage approximation', () => {
    // Global current = 100, previous = 100. Provider A current = 10, previous = 50.
    // Approximation would yield current = 100 * 0.1 = 10, previous = 100 * 0.5 = 50
    // only when pct matches; here we assert the helper returns the real values.
    const logs: UsageRecord[] = [
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
        cost: 10
      }),
      rec({
        providerId: 'a',
        capturedAt: new Date(NOW.getTime() - 8 * DAY_MS).toISOString(),
        cost: 50
      }),
      rec({
        providerId: 'b',
        capturedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
        cost: 90
      }),
      rec({
        providerId: 'b',
        capturedAt: new Date(NOW.getTime() - 8 * DAY_MS).toISOString(),
        cost: 50
      })
    ]
    const w = providerWeekWindows(NOW, logs, 'a')
    expect(w.currentWeek).toBe(10)
    expect(w.previousWeek).toBe(50)
  })
})

// buildDailyCostSeries:生成按日成本序列,补齐缺失日期并输出 mm-dd 标签
describe('buildDailyCostSeries', () => {
  it('fills missing days with zero-cost points and emits mm-dd labels in order', () => {
    const now = new Date('2026-07-08T12:00:00Z')
    const out = buildDailyCostSeries(
      [
        { date: '2026-07-06', cost: 12.5, tokens: 0 },
        { date: '2026-07-08', cost: 7.25, tokens: 0 }
      ],
      3,
      now
    )

    expect(out).toEqual([
      { date: '2026-07-06', label: '07-06', cost: 12.5 },
      { date: '2026-07-07', label: '07-07', cost: 0 },
      { date: '2026-07-08', label: '07-08', cost: 7.25 }
    ])
  })

  it('coalesces duplicate dates into a single point using the last aggregated row', () => {
    const now = new Date('2026-07-08T12:00:00Z')
    const out = buildDailyCostSeries(
      [
        { date: '2026-07-08', cost: 1, tokens: 0 },
        { date: '2026-07-08', cost: 3, tokens: 0 }
      ],
      1,
      now
    )

    expect(out).toEqual([{ date: '2026-07-08', label: '07-08', cost: 3 }])
  })
})
