/**
 * ponytail: pure aggregation helpers used by the Provider Summary page.
 * Extracted so they're trivially unit-testable without mounting React.
 *
 * No imports from `code/src/renderer/**`, no window.*, no React types.
 *
 * 中文说明:供应商汇总页的纯函数聚合工具(按模型/供应商/周窗口统计花费)。
 * (glm-5.2)
 */

import type { UsageRecord } from '../types/usage'

/** 按模型聚合结果:模型名、涉及供应商、花费、Token、请求数与币种。 */
export interface ModelAggregate {
  model: string
  providers: string[]
  cost: number
  tokens: number
  requests: number
  currency: string
}

/** 某供应商下单模型的花费/Token 条目。 */
export interface ProviderModelEntry {
  model: string
  cost: number
  tokens: number
}

/** 每日花费图表的一个数据点。 */
export interface DailyCostPoint {
  date: string
  label: string
  cost: number
}

/** 将 Date 转为本地时区的 YYYY-MM-DD 字符串。 */
function toLocalISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** ponytail: trend = (current - previous) / previous * 100.
 *  Returns `null` when previous is 0 (no comparison possible) AND when
 *  either side is null/undefined. Used by the By-Provider table column. */
export function computeTrend(
  currentWeekCost: number | null | undefined,
  previousWeekCost: number | null | undefined
): number | null {
  if (currentWeekCost == null || previousWeekCost == null) return null
  if (!Number.isFinite(currentWeekCost) || !Number.isFinite(previousWeekCost)) return null
  if (previousWeekCost === 0) {
    // ponytail: 0 → N is "infinite" growth; surface as 100% (saturating) so
    // the UI never shows NaN and the row stays visually informative.
    return currentWeekCost > 0 ? 100 : 0
  }
  return ((currentWeekCost - previousWeekCost) / previousWeekCost) * 100
}

/** ponytail: pure derivation: given all logs, return a list of
 *  {model, providers, cost, tokens, requests} sorted by cost desc. */
export function aggregateByModel(logs: UsageRecord[], fallbackCurrency = 'CNY'): ModelAggregate[] {
  const map = new Map<
    string,
    { providers: Set<string>; cost: number; tokens: number; requests: number; currency: string }
  >()
  for (const r of logs) {
    const model = r.model || '(unknown)'
    const cur = map.get(model) ?? {
      providers: new Set<string>(),
      cost: 0,
      tokens: 0,
      requests: 0,
      currency: r.currency ?? fallbackCurrency
    }
    cur.providers.add(r.providerId)
    cur.cost += r.cost ?? 0
    cur.tokens += r.totalTokens ?? (r.promptTokens ?? 0) + (r.completionTokens ?? 0)
    cur.requests += 1
    map.set(model, cur)
  }
  return Array.from(map.entries())
    .map(([model, v]) => ({
      model,
      providers: Array.from(v.providers).sort(),
      cost: v.cost,
      tokens: v.tokens,
      requests: v.requests,
      currency: v.currency
    }))
    .sort((a, b) => b.cost - a.cost)
}

/** ponytail: top-N models for a given provider id. */
export function topModelsForProvider(
  logs: UsageRecord[],
  providerId: string,
  n = 3
): ProviderModelEntry[] {
  const map = new Map<string, { cost: number; tokens: number }>()
  for (const r of logs) {
    if (r.providerId !== providerId) continue
    const m = r.model || '(unknown)'
    const cur = map.get(m) ?? { cost: 0, tokens: 0 }
    cur.cost += r.cost ?? 0
    cur.tokens += r.totalTokens ?? (r.promptTokens ?? 0) + (r.completionTokens ?? 0)
    map.set(m, cur)
  }
  return Array.from(map.entries())
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, n)
}

/** ponytail: split logs into "current 7 days" vs "previous 7 days" cost
 *  totals anchored at `now`. Anything older than 14 days is ignored. */
export function weekWindows(
  now: Date,
  logs: UsageRecord[]
): { currentWeek: number; previousWeek: number } {
  const t = now.getTime()
  const dayMs = 86_400_000
  const weekStart = t - 7 * dayMs
  const prevStart = t - 14 * dayMs
  let currentWeek = 0
  let previousWeek = 0
  for (const r of logs) {
    const ts = Date.parse(r.capturedAt)
    if (!Number.isFinite(ts)) continue
    const cost = r.cost ?? 0
    if (ts >= weekStart && ts < t) currentWeek += cost
    else if (ts >= prevStart && ts < weekStart) previousWeek += cost
  }
  return { currentWeek, previousWeek }
}

/** ponytail: exact per-provider week-over-week costs.
 *  Returns { currentWeek, previousWeek } from log rows whose `providerId`
 *  matches exactly. Logs outside the 14-day anchored window are ignored. */
export function providerWeekWindows(
  now: Date,
  logs: UsageRecord[],
  providerId: string
): { currentWeek: number; previousWeek: number } {
  return weekWindows(
    now,
    logs.filter((r) => r.providerId === providerId)
  )
}

/** ponytail: normalize dashboard `daily` rows into a dense date series.
 * SQL only returns dates with data; the chart wants a continuous x-axis. */
export function buildDailyCostSeries(
  daily: Array<{ date: string; cost: number; tokens: number }>,
  days: number,
  now: Date
): DailyCostPoint[] {
  const byDate = new Map(daily.map((row) => [row.date, row]))
  const out: DailyCostPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const date = toLocalISODate(d)
    const row = byDate.get(date)
    out.push({
      date,
      label: date.slice(5),
      cost: row?.cost ?? 0
    })
  }
  return out
}
