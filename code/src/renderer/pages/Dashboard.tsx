/**
 * 仪表盘页面:展示总览统计(真实消耗 Tokens、总请求、总成本、缓存命中率)、
 * 按模型分组的用量趋势折线图、消费统计(折算人民币)与各 Key 余额快照。
 * 支持当日/7 天/30 天/全部的时间范围切换、刷新与导出 CSV。
 * (glm-5.2)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { AnimatedNumber, MotionGroup, ProgressBar } from '../components/motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import type { DashboardSummary, TotalSpendSummary } from '../../shared/types/usage'
import type { BalanceSnapshot } from '../../shared/types/provider'
import {
  buildModelUsageSeries,
  type UsageTrendModel,
  type UsageTrendRange,
  type UsageTrendSeries
} from '../../shared/utils/usage-trend'
import { readDashboardRange, writeDashboardRange } from '../../shared/utils/dashboard-range'

/** 时间范围类型,复用 UsageTrendRange */
type RangeKey = UsageTrendRange

/** 时间范围选项:key、显示文案、对应天数(all 为 null) */
const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: 'today', label: '当日', days: 1 },
  { key: '7d', label: '7 天', days: 7 },
  { key: '30d', label: '30 天', days: 30 },
  { key: 'all', label: '全部', days: null }
]

/** 将仪表盘汇总导出为 CSV 并触发下载 */
function handleExport(d: DashboardSummary | null) {
  // ponytail: keep export stub until Phase J wires `usage:export-csv`. The
  // button is functional even now (downloads a CSV built from the in-memory
  // summary) so users get immediate feedback instead of a dead button.
  const header = 'date,provider,model,prompt_tokens,completion_tokens,cost'
  const rows: string[] = []
  if (d) {
    for (const day of d.daily) {
      rows.push(`${day.date},*,*,*,*,${day.cost.toFixed(6)}`)
    }
  }
  const csv = [header, ...rows].join('\n') || `${header}\n`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tokenlub-export-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Fill missing days in the dashboard daily series. SQL GROUP BY only returns
 * days with data; without this helper the chart shows N-1 dashes for empty
 * days. Pure function, local to the page (no other consumer yet).
 *
 * 填充缺失日期:为没有数据的日期补零,使折线图连续无断点。 (glm-5.2)
 */
function fillMissingDays(
  daily: DashboardSummary['daily'],
  days: number
): DashboardSummary['daily'] {
  const byDate = new Map(daily.map((d) => [d.date, d]))
  const today = new Date()
  const out: DashboardSummary['daily'] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push(byDate.get(key) ?? { date: key, cost: 0, tokens: 0 })
  }
  return out
}

/** 返回今天 0 点的 Date */
function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** 计算指定时间范围的起始 ISO 时间(all 返回 undefined) */
function rangeSince(range: RangeKey): string | undefined {
  if (range === 'all') return undefined
  if (range === 'today') return startOfToday().toISOString()
  const days = RANGE_OPTIONS.find((r) => r.key === range)?.days ?? 30
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
}

/** 按模型分组的用量趋势折线图组件 */
function ModelUsageLineChart({ series }: { series: UsageTrendSeries }) {
  const reducedMotion = useReducedMotion()
  if (!series.points.length || !series.models.length) return null
  return (
    <div className="h-[360px] min-w-0">
      <div className="mb-3 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-[12px] text-[#71717a]">
        {series.models.map((m) => (
          <div key={m.key} className="inline-flex items-center gap-1.5 max-w-[180px] min-w-0">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: m.color }} />
            <span className="truncate" title={m.label}>
              {m.label}
            </span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series.points} margin={{ top: 10, right: 18, bottom: 12, left: 4 }}>
          <CartesianGrid stroke="#eef0f4" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#71717a' }}
            tickLine={false}
            minTickGap={24}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis
            width={52}
            tick={{ fontSize: 11, fill: '#71717a' }}
            tickFormatter={(v) => fmtCount(Number(v))}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ModelTooltip models={series.models} />} />
          {series.models.map((m) => (
            <Line
              key={m.key}
              type="monotone"
              dataKey={m.key}
              name={m.label}
              stroke={m.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={!reducedMotion}
              animationDuration={640}
              animationEasing="ease-out"
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** 折线图的自定义 Tooltip:展示各模型在该时间点的 Token 用量 */
function ModelTooltip({
  active,
  label,
  payload,
  models
}: {
  active?: boolean
  label?: string
  payload?: Array<{ dataKey?: string | number; value?: number }>
  models: UsageTrendModel[]
}) {
  if (!active || !payload?.length) return null
  const rows = payload
    .map((p) => {
      const model = models.find((m) => m.key === p.dataKey)
      return model ? { ...model, value: Number(p.value ?? 0) } : null
    })
    .filter((r): r is { key: string; label: string; color: string; value: number } => !!r)
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
  return (
    <div className="min-w-[180px] rounded-md border border-[#e5e7eb] bg-white px-3 py-2 shadow-sm">
      <div className="mb-1 text-[12px] font-medium text-[#09090b]">{label}</div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-[#9ca3af]">无消耗</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                <span className="truncate max-w-[150px]" title={r.label}>
                  {r.label}
                </span>
              </span>
              <span className="font-mono text-[#09090b]">{fmtCount(r.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 仪表盘页面组件。
 * 并行拉取仪表盘汇总、余额快照、总消费与请求日志,渲染概览指标、趋势图、消费与余额。
 */
export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [balances, setBalances] = useState<
    Array<BalanceSnapshot & { id: number; apiKeyId?: string }>
  >([])
  const [spend, setSpend] = useState<TotalSpendSummary | null>(null)
  const [range, setRange] = useState<RangeKey>(() => readDashboardRange(window.localStorage))
  const [modelSeries, setModelSeries] = useState<UsageTrendSeries>({
    points: [],
    models: [],
    bucketKind: 'day'
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  /** 加载仪表盘数据(汇总、余额、消费、日志) */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const selected = RANGE_OPTIONS.find((r) => r.key === range) ?? RANGE_OPTIONS[2]!
      const days = selected.days ?? 0
      const fromISO = rangeSince(range)
      // ponytail: a single dashboard call covers the chart + totals. Balance
      // snapshots are independent (per-key) so they ride along in parallel.
      // Total spend is computed from logs × pricing config over the period.
      const [d, b, s, logs] = await Promise.all([
        window.api.usage.getDashboard(days),
        window.api.balance.latest().catch(() => []),
        window.api.usage.getTotalSpend(days).catch(() => null),
        window.api.usage.getLogs({ ...(fromISO ? { fromISO } : {}), limit: 10000 }).catch(() => [])
      ])
      setSummary(
        d ? { ...d, daily: selected.days ? fillMissingDays(d.daily, selected.days) : d.daily } : d
      )
      setBalances(b)
      setSpend(s)
      setModelSeries(buildModelUsageSeries(logs, range))
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    void load()
  }, [load])

  /** 刷新已入库的用量并重新加载 */
  async function handleRefresh() {
    setRefreshing(true)
    try {
      await window.api.usage.refreshAll()
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  const isEmpty = !loading && (!summary || summary.totalRequests === 0) && balances.length === 0
  const totalTokens = summary
    ? summary.totalInputTokens + summary.totalOutputTokens + summary.totalCacheReadTokens
    : 0
  // ponytail: hero number is "used tokens over the period" — falls back to
  // 余额-used from balance snapshots if the dashboard has no usage yet.
  const usedFromBalance = balances.reduce((acc, s) => acc + (s.used ?? 0), 0)
  const heroNumber = totalTokens > 0 ? totalTokens : usedFromBalance > 0 ? usedFromBalance : null
  const remainingFromBalance = balances.reduce((acc, s) => acc + (s.remaining ?? 0), 0)
  const totalBalanceTokens = remainingFromBalance + usedFromBalance
  const cacheHitRate = totalTokens > 0 ? (summary?.totalCacheReadTokens ?? 0) / totalTokens : 0
  const topProviders = useMemo(() => {
    return [...(summary?.providers ?? [])].sort((a, b) => b.tokens - a.tokens).slice(0, 4)
  }, [summary])
  const activeRangeLabel = RANGE_OPTIONS.find((r) => r.key === range)?.label ?? '30 天'
  const hasCnySpend = Boolean(spend && spend.totalRequests > 0)
  const estimatedCostValue = hasCnySpend ? (spend?.cnyTotal ?? 0) : (summary?.totalCost ?? 0)

  return (
    <div className="page-content overflow-x-auto bg-[#fafafa] text-[#09090b]">
      {isEmpty ? (
        <Card className="border-[#e5e7eb] bg-white shadow-sm">
          <EmptyState
            icon="fa-chart-simple"
            title="暂无用量数据"
            hint="先在 API Keys 添加 Key 并刷新一次"
            action={
              <button
                className="btn btn-primary btn-sm"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <i className="fa-solid fa-arrows-rotate" /> 立即刷新
              </button>
            }
          />
        </Card>
      ) : (
        <MotionGroup className="mx-auto flex min-w-[760px] max-w-[1440px] flex-col gap-6">
          <section className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium text-[#71717a]">TokenLub</p>
              <h1 className="mt-1 text-[34px] font-bold leading-tight text-[#09090b]">使用统计</h1>
              <p className="mt-1 text-[14px] text-[#71717a]">查看 AI 模型用量、成本和资源包消耗</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="inline-flex h-11 items-center rounded-lg border border-[#e5e7eb] bg-white p-1 shadow-sm">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`h-9 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                      range === option.key
                        ? 'bg-[#0f6bff] text-white'
                        : 'text-[#71717a] hover:bg-[#f3f4f6] hover:text-[#09090b]'
                    }`}
                    onClick={() => {
                      setRange(option.key)
                      writeDashboardRange(window.localStorage, option.key)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white px-4 text-[13px] font-semibold text-[#09090b] shadow-sm transition-colors hover:bg-[#f3f4f6] disabled:opacity-60"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <i className={`fa-solid fa-arrows-rotate ${refreshing ? 'fa-spin' : ''}`} /> 刷新
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white px-4 text-[13px] font-semibold text-[#09090b] shadow-sm transition-colors hover:bg-[#f3f4f6]"
                onClick={() => handleExport(summary)}
              >
                <i className="fa-solid fa-arrow-up-from-bracket" /> 导出
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-lg bg-[#0f6bff]/15 text-[#1e90ff]">
                  <i className="fa-solid fa-bolt text-[26px]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[#71717a]">真实消耗 Tokens</p>
                  <div className="mt-1 flex flex-wrap items-end gap-3">
                    <div className="max-w-full break-words text-[44px] font-bold leading-none tracking-normal text-[#09090b]">
                      {heroNumber !== null ? (
                        <AnimatedNumber value={heroNumber} format={fmtCount} durationMs={520} />
                      ) : (
                        '—'
                      )}
                    </div>
                    {heroNumber && heroNumber >= 1e8 ? (
                      <span className="mb-1 rounded-md bg-[#f3f4f6] px-2 py-1 text-[12px] font-semibold text-[#71717a]">
                        ≈ {(heroNumber / 1e8).toFixed(2)} 亿
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-[12.5px] text-[#71717a]">
                    {totalTokens > 0
                      ? `${activeRangeLabel}内记录的请求与本地 CLI 会话消耗`
                      : totalBalanceTokens > 0
                        ? `来自 Provider 余额快照，共 ${fmtCount(totalBalanceTokens)} Tokens`
                        : '尚未记录任何 Token 消耗'}
                  </p>
                </div>
              </div>

              <div className="grid min-w-[280px] grid-cols-2 gap-3 rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm max-sm:min-w-0 max-sm:w-full">
                <div>
                  <p className="text-[12px] font-semibold text-[#71717a]">总请求数</p>
                  <p className="mt-1 font-mono text-[20px] font-bold text-[#09090b]">
                    <AnimatedNumber
                      value={summary?.totalRequests ?? 0}
                      format={(value) => Math.round(value).toLocaleString('en-US')}
                      durationMs={480}
                    />
                  </p>
                </div>
                <div className="border-l border-[#e5e7eb] pl-4">
                  <p className="text-[12px] font-semibold text-[#71717a]">总成本</p>
                  <p className="mt-1 font-mono text-[20px] font-bold text-[#12c99b]">
                    <AnimatedNumber
                      value={estimatedCostValue}
                      format={(value) => (hasCnySpend ? fmtMoney(value, 'CNY') : fmtMoney(value))}
                      durationMs={520}
                    />
                  </p>
                </div>
              </div>
            </div>

            <MotionGroup className="mt-6 grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
              <MetricBox
                icon="fa-arrow-down"
                iconClass="text-[#60a5fa]"
                label="新增输入"
                value={summary?.totalInputTokens ?? 0}
                format={fmtCount}
              />
              <MetricBox
                icon="fa-arrow-up"
                iconClass="text-[#c084fc]"
                label="Output"
                value={summary?.totalOutputTokens ?? 0}
                format={fmtCount}
              />
              <MetricBox
                icon="fa-database"
                iconClass="text-[#71717a]"
                label="缓存命中"
                value={summary?.totalCacheReadTokens ?? 0}
                format={fmtCount}
              />
              <MetricBox
                icon="fa-chart-line"
                iconClass="text-[#12c99b]"
                label="缓存命中率"
                value={cacheHitRate * 100}
                format={(value) => `${value.toFixed(1)}%`}
                progress={cacheHitRate}
              />
            </MotionGroup>

            {topProviders.length > 0 ? (
              <div className="mt-5 flex flex-wrap items-center gap-2 text-[12px] text-[#71717a]">
                <span className="font-semibold text-[#71717a]">主要来源</span>
                {topProviders.map((p) => (
                  <span
                    key={p.providerId}
                    className="rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1 font-mono"
                  >
                    {p.providerId} · {fmtCount(p.tokens)}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-bold text-[#09090b]">使用趋势</h2>
                <p className="mt-1 text-[13px] text-[#71717a]">
                  按模型分组显示，悬停曲线查看具体用量
                </p>
              </div>
              <span className="text-[14px] font-medium text-[#71717a]">{activeRangeLabel}</span>
            </div>
            {modelSeries.points.length > 0 ? (
              <ModelUsageLineChart series={modelSeries} />
            ) : (
              <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-[#d1d5db] text-[13px] text-[#9ca3af]">
                暂无当前时间段用量记录
              </div>
            )}
          </section>

          <section className="grid grid-cols-[minmax(0,1fr)_minmax(360px,0.6fr)] gap-6 max-xl:grid-cols-1">
            <div className="rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-bold text-[#09090b]">消费统计</h2>
                  <p className="mt-1 text-[13px] text-[#71717a]">
                    统一折算人民币，保留未计价请求提示
                  </p>
                </div>
                <i className="fa-solid fa-coins text-[#f59e0b]" />
              </div>
              {spend && spend.totalRequests > 0 ? (
                <div className="space-y-4">
                  <div>
                    <div className="font-mono text-[34px] font-bold leading-none text-[#09090b]">
                      <AnimatedNumber
                        value={spend.cnyTotal}
                        format={(value) => fmtMoney(value, 'CNY')}
                        durationMs={520}
                      />
                    </div>
                    <p className="mt-2 text-[12.5px] text-[#71717a]">
                      按请求日志 × 价格配置估算（{activeRangeLabel}，已折算人民币）
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                    <InfoPill
                      label="已计价"
                      value={`${spend.pricedRequests.toLocaleString('en-US')} 次`}
                    />
                    <InfoPill
                      label="未计价"
                      value={`${spend.unpricedRequests.toLocaleString('en-US')} 次`}
                    />
                  </div>
                  {spend.byCurrency.length > 1 ? (
                    <p className="font-mono text-[12px] text-[#71717a]">
                      原始币种{' '}
                      {spend.byCurrency.map((c) => fmtMoney(c.amount, c.currency)).join(' · ')}
                    </p>
                  ) : null}
                  <p className="text-[12px] text-[#71717a]">
                    汇率来源：
                    {spend.exchangeRateSource === 'api'
                      ? `实时接口${spend.exchangeRateUpdatedAt ? ` · ${spend.exchangeRateUpdatedAt}` : ''}`
                      : spend.exchangeRateSource === 'mixed'
                        ? '实时接口 + 备用汇率'
                        : '备用汇率'}
                    {spend.unconvertedCurrencies.length > 0
                      ? ` · 未折算 ${spend.unconvertedCurrencies.join(', ')}`
                      : ''}
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-[#9ca3af]">暂无可计价的请求（检查价格配置）</p>
              )}
            </div>

            <div className="rounded-lg border border-[#e5e7eb] bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-bold text-[#09090b]">余额快照</h2>
                  <p className="mt-1 text-[13px] text-[#71717a]">各 Key 最近一次资源包读取结果</p>
                </div>
                <i className="fa-solid fa-wallet text-[#12c99b]" />
              </div>
              {balances.length === 0 ? (
                <p className="text-[13px] text-[#9ca3af]">
                  还没有余额记录，触发一次刷新后会自动抓取
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="text-left text-[#71717a]">
                      <tr>
                        <th className="py-2 font-medium">Provider</th>
                        <th className="py-2 text-right font-medium">剩余</th>
                        <th className="py-2 text-right font-medium">已用</th>
                        <th className="py-2 text-right font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody className="text-[#09090b]">
                      {balances.slice(0, 6).map((b) => (
                        <tr key={b.id} className="border-t border-[#e5e7eb]">
                          <td className="py-2">{b.providerId}</td>
                          <td className="py-2 text-right font-mono">
                            {b.remaining !== undefined ? fmtCount(b.remaining) : '—'}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {b.used !== undefined ? fmtCount(b.used) : '—'}
                          </td>
                          <td className="py-2 text-right text-[#71717a]">
                            {b.capturedAt.slice(0, 10)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </MotionGroup>
      )}
    </div>
  )
}

/** 概览指标小卡片:图标 + 标签 + 数值,可选进度条 */
function MetricBox({
  icon,
  iconClass,
  label,
  value,
  format,
  progress
}: {
  icon: string
  iconClass: string
  label: string
  value: number
  format: (value: number) => string
  progress?: number
}) {
  return (
    <div className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#71717a]">
        <i className={`fa-solid ${icon} ${iconClass}`} />
        <span>{label}</span>
      </div>
      <div className="mt-2 font-mono text-[22px] font-bold text-[#09090b]">
        <AnimatedNumber value={value} format={format} durationMs={480} />
      </div>
      {progress !== undefined ? (
        <ProgressBar
          value={progress}
          label={`缓存命中率 ${format(value)}`}
          className="mt-3"
          trackClassName="bg-[#e5e7eb]"
          fillClassName="bg-[#12c99b]"
        />
      ) : null}
    </div>
  )
}

/** 信息胶囊:标签 + 数值的小型展示块 */
function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3">
      <p className="text-[12px] font-semibold text-[#71717a]">{label}</p>
      <p className="mt-1 font-mono text-[17px] font-bold text-[#09090b]">{value}</p>
    </div>
  )
}
