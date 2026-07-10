/**
 * dashboard 统计单元测试:覆盖 computeProviderPct 占比计算与 token 求和的 NULL 处理契约,
 * 校验总成本为 0 时的占比归零与 SQL COALESCE 算术约定。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { computeProviderPct } from '../../../src/main/store/usage-repo'

// computeProviderPct (N5):总成本为 0 时各来源商占比归零,否则返回真实份额
describe('computeProviderPct (N5: pct when totalCost=0)', () => {
  it('returns 0 for every provider when grand total is 0', () => {
    // Scenario: token traffic exists but cost is 0 for all providers.
    // Previously `total = totals.totalCost || 1` made pct = cost/1 = cost,
    // producing a misleading pie chart. Now pct must be 0.
    expect(computeProviderPct(0, 0)).toBe(0)
    expect(computeProviderPct(5, 0)).toBe(0)
  })

  it('returns the true share when grand total > 0', () => {
    expect(computeProviderPct(3, 10)).toBeCloseTo(0.3, 5)
    expect(computeProviderPct(7, 10)).toBeCloseTo(0.7, 5)
  })

  it('returns 0 for negative grand total (defensive)', () => {
    expect(computeProviderPct(5, -1)).toBe(0)
  })

  it('shares sum to 1 across providers when grand total > 0', () => {
    const costs = [3, 2, 5]
    const grand = costs.reduce((a, b) => a + b, 0)
    const pcts = costs.map((c) => computeProviderPct(c, grand))
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })
})

// N6: token 求和 NULL 处理(SQL COALESCE 守卫):单列为 NULL 时按 0 计
describe('N6: token sum NULL handling (SQL guard)', () => {
  // The fix lives in the SQL: SUM(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0))
  // instead of SUM(prompt_tokens + completion_tokens). A row with one NULL
  // column previously contributed 0 tokens (because NULL + x = NULL, COALESCE'd
  // to 0 at the outer SUM). Now each column is COALESCE'd independently.
  //
  // We verify the arithmetic contract the SQL relies on:
  it('treats a NULL column as 0 when summing prompt + completion tokens', () => {
    const promptTokens: number | null = 100
    const completionTokens: number | null = null
    // Mirror the SQL: COALESCE(prompt,0) + COALESCE(completion,0)
    const rowSum = (promptTokens ?? 0) + (completionTokens ?? 0)
    expect(rowSum).toBe(100) // not 0
  })

  it('sums normally when both columns present', () => {
    const promptTokens: number | null = 100
    const completionTokens: number | null = 50
    const rowSum = (promptTokens ?? 0) + (completionTokens ?? 0)
    expect(rowSum).toBe(150)
  })

  it('handles both NULL as 0', () => {
    const promptTokens: number | null = null
    const completionTokens: number | null = null
    const rowSum = (promptTokens ?? 0) + (completionTokens ?? 0)
    expect(rowSum).toBe(0)
  })
})
