/**
 * alert 评估单元测试:覆盖 evaluateAlertRule / usageSliceToRecord / evaluateAlerts,
 * 校验阈值触发、用量转记录与告警事件写入(含冷却与禁用规则)。
 * (glm-5.2)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AlertRule } from '@shared/types/alert'
import type { BalanceSnapshot } from '@shared/types/provider'

// Mock the store layer so evaluateAlerts can be tested without a live DB.
// evaluateAlertRule is a pure function and tested directly.
vi.mock('../../../src/main/store/alerts-repo', () => ({
  listAlerts: vi.fn(() => [] as AlertRule[]),
  markAlertTriggered: vi.fn(() => {}),
  insertAlertEvent: vi.fn(() => {})
}))
vi.mock('../../../src/main/store/balance-repo', () => ({
  insertBalance: vi.fn(),
  latestBalances: vi.fn(() => [] as Array<BalanceSnapshot & { id: number; apiKeyId?: string }>)
}))
vi.mock('../../../src/main/store/usage-repo', () => ({
  insertUsage: vi.fn(() => ({ inserted: 0, skipped: 0 }))
}))
vi.mock('../../../src/main/store/pricing-repo', () => ({
  findPricing: vi.fn(() => null)
}))
vi.mock('../../../src/main/store/keys-repo', () => ({
  listKeys: vi.fn(() => []),
  getDecryptedKey: vi.fn(() => '')
}))
vi.mock('../../../src/main/store/settings-store', () => ({
  getSetting: vi.fn(() => null),
  setSetting: vi.fn()
}))
vi.mock('../../../src/main/store/db', () => ({ getDb: vi.fn() }))
vi.mock('../../../src/main/providers/registry', () => ({ getProvider: vi.fn() }))

import {
  evaluateAlertRule,
  evaluateAlerts,
  usageSliceToRecord
} from '../../../src/main/scheduler/refresh'
import {
  listAlerts,
  markAlertTriggered,
  insertAlertEvent
} from '../../../src/main/store/alerts-repo'
import { latestBalances } from '../../../src/main/store/balance-repo'

function makeRule(over: Record<string, unknown> = {}): AlertRule {
  const base: Record<string, unknown> = {
    id: 'rule-1',
    scope: 'provider',
    providerId: 'openai-admin',
    threshold: 10,
    metric: 'remaining_amount',
    enabled: true,
    createdAt: '2026-07-01T00:00:00Z'
  }
  const merged = { ...base, ...over }
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) delete merged[k]
  }
  return merged as unknown as AlertRule
}

function makeSnap(over: Record<string, unknown> = {}): BalanceSnapshot {
  const base: Record<string, unknown> = {
    providerId: 'openai-admin',
    capturedAt: '2026-07-06T00:00:00Z',
    remaining: 5,
    total: 100,
    currency: 'USD'
  }
  const merged = { ...base, ...over }
  for (const k of Object.keys(merged)) {
    if (merged[k] === undefined) delete merged[k]
  }
  return merged as unknown as BalanceSnapshot
}

// evaluateAlertRule (pure):纯函数判定单条规则是否触发(含边界与除零防御)
describe('evaluateAlertRule (pure)', () => {
  it('fires when remaining_amount <= threshold', () => {
    const r = makeRule({ metric: 'remaining_amount', threshold: 10 })
    const s = makeSnap({ remaining: 5 })
    const result = evaluateAlertRule(r, s)
    expect(result).not.toBeNull()
    expect(result!.fires).toBe(true)
    expect(result!.value).toBe(5)
  })

  it('does NOT fire when remaining_amount > threshold', () => {
    const r = makeRule({ metric: 'remaining_amount', threshold: 10 })
    const s = makeSnap({ remaining: 50 })
    const result = evaluateAlertRule(r, s)!
    expect(result.fires).toBe(false)
  })

  it('fires at the boundary (<=)', () => {
    const r = makeRule({ metric: 'remaining_amount', threshold: 10 })
    const s = makeSnap({ remaining: 10 })
    expect(evaluateAlertRule(r, s)!.fires).toBe(true)
  })

  it('fires when remaining_pct <= threshold', () => {
    const r = makeRule({ metric: 'remaining_pct', threshold: 10 })
    const s = makeSnap({ remaining: 5, total: 100 }) // 5%
    const result = evaluateAlertRule(r, s)!
    expect(result.fires).toBe(true)
    expect(result.value).toBeCloseTo(5, 5)
  })

  it('does NOT fire when remaining_pct > threshold', () => {
    const r = makeRule({ metric: 'remaining_pct', threshold: 10 })
    const s = makeSnap({ remaining: 50, total: 100 }) // 50%
    expect(evaluateAlertRule(r, s)!.fires).toBe(false)
  })

  it('returns null for remaining_pct when total is missing', () => {
    const r = makeRule({ metric: 'remaining_pct', threshold: 10 })
    const s = makeSnap({ remaining: 5, total: undefined })
    expect(evaluateAlertRule(r, s)).toBeNull()
  })

  it('returns null when remaining is missing', () => {
    const r = makeRule({ metric: 'remaining_amount', threshold: 10 })
    const s = makeSnap({ remaining: undefined })
    expect(evaluateAlertRule(r, s)).toBeNull()
  })

  it('returns null for remaining_pct when total is 0 (avoid div-by-zero)', () => {
    const r = makeRule({ metric: 'remaining_pct', threshold: 10 })
    const s = makeSnap({ remaining: 0, total: 0 })
    expect(evaluateAlertRule(r, s)).toBeNull()
  })

  it('returns null for NaN values (defensive against bad provider data)', () => {
    const r = makeRule({ metric: 'remaining_amount', threshold: 10 })
    const s = makeSnap({ remaining: NaN })
    expect(evaluateAlertRule(r, s)).toBeNull()
  })
})

// usageSliceToRecord (pure):将用量切片转为记录,缺失成本时按定价补算
describe('usageSliceToRecord (pure)', () => {
  it('computes missing cost from pricing and preserves vendor-api period', () => {
    const rec = usageSliceToRecord(
      {
        providerId: 'openai-admin',
        model: 'gpt-4o',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-02T00:00:00.000Z',
        promptTokens: 1_000_000,
        completionTokens: 500_000,
        source: 'vendor-api'
      },
      {
        apiKeyId: 'key-1',
        pricing: {
          providerId: 'openai-admin',
          model: 'gpt-4o',
          promptPricePerMtok: 3,
          completionPricePerMtok: 15,
          currency: 'USD',
          source: 'user'
        }
      }
    )
    expect(rec.apiKeyId).toBe('key-1')
    expect(rec.periodStart).toBe('2026-07-01T00:00:00.000Z')
    expect(rec.capturedAt).toBe('2026-07-02T00:00:00.000Z')
    expect(rec.totalTokens).toBe(1_500_000)
    expect(rec.cost).toBeCloseTo(10.5, 8)
    expect(rec.currency).toBe('USD')
  })

  it('keeps provider cost when present instead of recalculating', () => {
    const rec = usageSliceToRecord(
      {
        providerId: 'anthropic-admin',
        model: 'anthropic-org-aggregate',
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-02T00:00:00.000Z',
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        cost: 4.25,
        currency: 'USD'
      },
      {
        apiKeyId: 'key-1',
        pricing: {
          providerId: 'anthropic-admin',
          model: 'anthropic-org-aggregate',
          promptPricePerMtok: 999,
          completionPricePerMtok: 999,
          currency: 'USD',
          source: 'user'
        }
      }
    )
    expect(rec.cost).toBe(4.25)
  })
})

// evaluateAlerts (integration):结合 mock 的 store 层验证告警事件写入与冷却跳过
describe('evaluateAlerts (integration with mocked store)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes an event + marks triggered when a rule fires', () => {
    const now = new Date('2026-07-06T12:00:00Z')
    const rule = makeRule({ metric: 'remaining_amount', threshold: 10 })
    vi.mocked(listAlerts).mockReturnValue([rule])
    vi.mocked(latestBalances).mockReturnValue([
      { ...makeSnap({ remaining: 5 }), id: 1, apiKeyId: 'k1' }
    ])
    const result = evaluateAlerts(now)
    expect(result.fired).toBe(1)
    expect(insertAlertEvent).toHaveBeenCalledTimes(1)
    expect(markAlertTriggered).toHaveBeenCalledWith('rule-1', now.toISOString())
  })

  it('skips a rule that fired within the 5-minute cooldown', () => {
    const rule = makeRule({
      metric: 'remaining_amount',
      threshold: 10,
      lastTriggeredAt: '2026-07-06T11:58:00Z' // 2 minutes ago
    })
    vi.mocked(listAlerts).mockReturnValue([rule])
    vi.mocked(latestBalances).mockReturnValue([
      { ...makeSnap({ remaining: 5 }), id: 1, apiKeyId: 'k1' }
    ])
    const result = evaluateAlerts(new Date('2026-07-06T12:00:00Z'))
    expect(result.fired).toBe(0)
    expect(result.skipped).toBe(1)
    expect(insertAlertEvent).not.toHaveBeenCalled()
    expect(markAlertTriggered).not.toHaveBeenCalled()
  })

  it('re-fires a rule past the cooldown', () => {
    const rule = makeRule({
      metric: 'remaining_amount',
      threshold: 10,
      lastTriggeredAt: '2026-07-06T11:50:00Z' // 10 minutes ago
    })
    vi.mocked(listAlerts).mockReturnValue([rule])
    vi.mocked(latestBalances).mockReturnValue([
      { ...makeSnap({ remaining: 5 }), id: 1, apiKeyId: 'k1' }
    ])
    const result = evaluateAlerts(new Date('2026-07-06T12:00:00Z'))
    expect(result.fired).toBe(1)
    expect(insertAlertEvent).toHaveBeenCalledTimes(1)
  })

  it('does NOT evaluate disabled rules', () => {
    const rule = makeRule({ metric: 'remaining_amount', threshold: 10, enabled: false })
    vi.mocked(listAlerts).mockReturnValue([rule])
    vi.mocked(latestBalances).mockReturnValue([
      { ...makeSnap({ remaining: 5 }), id: 1, apiKeyId: 'k1' }
    ])
    const result = evaluateAlerts()
    expect(result.fired).toBe(0)
    expect(insertAlertEvent).not.toHaveBeenCalled()
  })

  it('skips remaining_pct rule when total is missing (no event written)', () => {
    const rule = makeRule({ metric: 'remaining_pct', threshold: 10 })
    vi.mocked(listAlerts).mockReturnValue([rule])
    vi.mocked(latestBalances).mockReturnValue([
      { ...makeSnap({ remaining: 5, total: undefined }), id: 1, apiKeyId: 'k1' }
    ])
    const result = evaluateAlerts()
    expect(result.fired).toBe(0)
    expect(result.skipped).toBe(1)
    expect(insertAlertEvent).not.toHaveBeenCalled()
  })

  it('global rule evaluates against all snapshots', () => {
    const rule = makeRule({
      scope: 'global',
      metric: 'remaining_amount',
      threshold: 10,
      providerId: undefined
    })
    vi.mocked(listAlerts).mockReturnValue([rule])
    vi.mocked(latestBalances).mockReturnValue([
      { ...makeSnap({ providerId: 'openai-admin', remaining: 5 }), id: 1, apiKeyId: 'k1' },
      { ...makeSnap({ providerId: 'deepseek', remaining: 50 }), id: 2, apiKeyId: 'k2' }
    ])
    const result = evaluateAlerts()
    expect(result.fired).toBe(1) // rule fired (at least one snapshot breached)
    // Only the breaching snapshot writes an event
    expect(insertAlertEvent).toHaveBeenCalledTimes(1)
  })

  it('returns fired:0 when there are no snapshots', () => {
    vi.mocked(listAlerts).mockReturnValue([makeRule()])
    vi.mocked(latestBalances).mockReturnValue([])
    const result = evaluateAlerts()
    expect(result.fired).toBe(0)
  })
})
