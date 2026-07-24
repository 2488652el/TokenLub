import type { RefreshAllResult, TotalSpendSummary, UsageRecord } from '../types/usage'

export type DashboardHealthTone = 'healthy' | 'partial' | 'error' | 'empty'

export interface DashboardHealth {
  coverage: number
  pricedRequests: number
  unpricedRequests: number
  lastCapturedAt: string | null
  failedSources: number
  tone: DashboardHealthTone
}

function latestValidTimestamp(records: UsageRecord[]): string | null {
  let latest = Number.NEGATIVE_INFINITY
  let latestISO: string | null = null

  for (const record of records) {
    const timestamp = Date.parse(record.capturedAt)
    if (Number.isFinite(timestamp) && timestamp > latest) {
      latest = timestamp
      latestISO = record.capturedAt
    }
  }

  return latestISO
}

/** 汇总首页所需的数据可信度指标，保持渲染层只负责展示。 */
export function buildDashboardHealth(
  spend: TotalSpendSummary | null,
  records: UsageRecord[],
  refreshResult: RefreshAllResult | null
): DashboardHealth {
  const pricedRequests = spend?.pricedRequests ?? 0
  const unpricedRequests = spend?.unpricedRequests ?? 0
  const totalRequests = spend?.totalRequests ?? 0
  const coverage = totalRequests > 0 ? pricedRequests / totalRequests : 0
  const failedSources = refreshResult?.failed ?? 0

  const tone: DashboardHealthTone =
    failedSources > 0
      ? 'error'
      : totalRequests === 0
        ? 'empty'
        : unpricedRequests > 0
          ? 'partial'
          : 'healthy'

  return {
    coverage,
    pricedRequests,
    unpricedRequests,
    lastCapturedAt: latestValidTimestamp(records),
    failedSources,
    tone
  }
}
