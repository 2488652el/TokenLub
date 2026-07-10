/**
 * 用量类型定义:描述用量记录、分页、汇总摘要等数据结构。
 * 覆盖仪表盘、供应商汇总、按 Key/按模型花费、刷新结果等核心契约。
 * (glm-5.2)
 */

/** 用量数据来源:供应商 API 实时拉取 或 本地会话日志解析。 */
export type UsageSource = 'vendor-api' | 'session-log'

/** 单条用量记录:对应 usage_records 表的一行。 */
export interface UsageRecord {
  id?: number
  apiKeyId?: string
  providerId: string
  model: string
  periodStart?: string
  periodEnd?: string
  promptTokens?: number
  completionTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  totalTokens?: number
  cost?: number
  currency?: string
  source: UsageSource
  sessionId?: string
  messageId?: string
  agentLabel?: string
  capturedAt: string
}

/** 用量日志分页结果。 */
export interface UsageLogPage {
  rows: UsageRecord[]
  total: number
  limit: number
  offset: number
}

/** 总花费汇总:跨币种归一为 CNY,含定价匹配统计。 */
export interface TotalSpendSummary {
  total: number // amount in the primary currency
  currency: string // primary currency (the one with the largest amount; default 'CNY' if none)
  byCurrency: Array<{ currency: string; amount: number }>
  cnyTotal: number // all convertible amounts normalized to CNY
  convertedByCurrency: Array<{
    currency: string
    amount: number
    rateToCny: number
    cnyAmount: number
  }>
  exchangeRateSource: 'api' | 'fallback' | 'mixed' | 'none'
  exchangeRateUpdatedAt?: string
  unconvertedCurrencies: string[]
  pricedRequests: number // count of request rows that matched a pricing entry
  unpricedRequests: number // count of rows with no pricing match
  totalRequests: number
}

/**
 * Per-key spend estimate derived from `usage_records` × `pricing_entries`.
 *
 * Aggregates a single api_key's usage within the given window, prices each
 * (provider, model) group with the current `findPricing` lookup, and reports
 * the total in the primary currency. Mirrors {@link TotalSpendSummary}'s shape
 * so the renderer can render the two side-by-side with the same component.
 */
export interface KeySpendSummary {
  apiKeyId: string
  days: number
  total: number
  currency: string
  byCurrency: Array<{ currency: string; amount: number }>
  pricedRequests: number
  unpricedRequests: number
  totalRequests: number
  /** Distinct models seen in this window; surfaced for diagnostic chips. */
  models: string[]
}

/** 按模型花费聚合:单个模型的跨供应商统计。 */
export interface ModelSpendAggregate {
  model: string
  providers: string[]
  total: number
  currency: string
  byCurrency: Array<{ currency: string; amount: number }>
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requests: number
  pricedRequests: number
  unpricedRequests: number
}

/** 仪表盘汇总:总花费/Token/请求数,按供应商与按日的趋势数据。 */
export interface DashboardSummary {
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalRequests: number
  providers: Array<{
    providerId: string
    cost: number
    tokens: number
    pct: number
  }>
  daily: Array<{ date: string; cost: number; tokens: number }>
}

/** 供应商汇总:用于供应商列表页的单行统计。 */
export interface ProviderSummary {
  providerId: string
  displayName: string
  totalCost: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  requestCount: number
  avgLatencyMs?: number
  trendPct?: number
  color?: string
}

/** Per-key failure detail from a bulk refresh (e.g. usage.refreshAll). */
export interface RefreshFailure {
  alias: string
  providerId: string
  error: string
}

/** Shape returned by the `usage.refreshAll` IPC handler. */
export interface RefreshAllResult {
  started: boolean
  queued: number
  ok: boolean
  refreshed: number
  usageInserted: number
  usageSkipped: number
  failed: number
  failures: RefreshFailure[]
}
