/**
 * 供应商汇总页面:按供应商维度聚合费用与用量,提供三种视图(按供应商/按模型/按费用趋势),
 * 含费用占比环形图、Top 5 排行、明细表格与每日费用趋势折线图。
 * (glm-5.2)
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Tabs, type TabDef } from '../components/Tabs'
import { fmtCount, fmtMoney, formatPct } from '../../shared/utils/money'
import {
  computeTrend,
  buildDailyCostSeries,
  providerWeekWindows,
  topModelsForProvider
} from '../../shared/utils/provider-aggregation'
import type { DashboardSummary, ModelSpendAggregate, UsageRecord } from '../../shared/types/usage'

/** ponytail: 8-color palette — derived from tailwind status colors. */
// 供应商配色:8 色调色板,源自 tailwind 状态色。 (glm-5.2)
const PROVIDER_PALETTE = [
  '#10B981',
  '#3B82F6',
  '#8B5CF6',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#F97316',
  '#6366F1'
]

/** 标签页类型:按供应商 / 按模型 / 按费用趋势 */
type TabKey = 'provider' | 'model' | 'trend'
/** 时间范围类型 */
type RangeKey = 'month' | 'week' | 'today'

/** 时间范围选项:key、显示文案、对应天数(today 为特殊值) */
const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | 'today' }[] = [
  { key: 'month', label: '本月', days: 30 },
  { key: 'week', label: '本周', days: 7 },
  { key: 'today', label: '今日', days: 'today' }
]

/** 标签页定义列表 */
const TAB_DEFS: TabDef<TabKey>[] = [
  { key: 'provider', label: 'By Provider', icon: 'fa-server' },
  { key: 'model', label: 'By Model', icon: 'fa-cubes' },
  { key: 'trend', label: 'By Cost Trend', icon: 'fa-arrow-trend-up' }
]

/**
 * ponytail: trend -> CSS class. +tint red for growth, amber for drop.
 * We use colorblind-safe status tokens already defined in tailwind.css.
 *
 * (The trend itself is computed by `computeTrend` from
 * `shared/utils/provider-aggregation` - extracted so it's unit-testable
 * without mounting React.)
 *
 * 趋势值映射为 CSS 类:增长偏红、下降偏琥珀。 (glm-5.2)
 */
function trendClass(t: number | null): string {
  if (t === null) return 'text-text-muted'
  if (t > 0.5) return 'text-status-red'
  if (t < -0.5) return 'text-status-amber'
  return 'text-text-muted'
}

/** ponytail: conic-gradient donut without any chart library.
 *
 * 供应商费用占比环形图:纯 CSS conic-gradient 实现,无需图表库。 (glm-5.2) */
function DonutChart({ providers }: { providers: DashboardSummary['providers'] }) {
  const stops: string[] = []
  let cursor = 0
  providers.forEach((p, i) => {
    const color = PROVIDER_PALETTE[i % PROVIDER_PALETTE.length] ?? '#10B981'
    stops.push(`${color} ${cursor}%`, `${color} ${cursor + p.pct * 100}%`)
    cursor += p.pct * 100
  })
  const gradient = `conic-gradient(${stops.join(', ')})`
  return (
    <div className="flex items-center gap-6">
      <div
        className="w-[140px] h-[140px] rounded-full relative flex-shrink-0"
        style={{ background: gradient }}
      >
        <div className="absolute inset-[18px] bg-bg-card rounded-full flex items-center justify-center">
          <span className="text-[18px] font-semibold text-text-primary">{providers.length}</span>
        </div>
      </div>
      <ul className="flex-1 space-y-1.5 min-w-0">
        {providers.slice(0, 6).map((p, i) => (
          <li key={p.providerId} className="flex items-center gap-2 text-[12.5px]">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: PROVIDER_PALETTE[i % PROVIDER_PALETTE.length] }}
            />
            <span className="text-text-primary truncate">{p.providerId}</span>
            <span className="ml-auto text-text-muted font-mono">{(p.pct * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** 每日费用趋势折线图:展示最高/最低点标注 */
function DailyCostLineChart({
  daily,
  days,
  now
}: {
  daily: DashboardSummary['daily']
  days: number
  now: Date
}) {
  const points = buildDailyCostSeries(daily, days, now)
  if (!points.length) return null

  const highest = points.reduce(
    (best, point) => (point.cost > best.cost ? point : best),
    points[0]!
  )
  const nonZero = points.filter((point) => point.cost > 0)
  const lowest = nonZero.length
    ? nonZero.reduce((best, point) => (point.cost < best.cost ? point : best), nonZero[0]!)
    : null

  return (
    <div>
      <div className="h-[240px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
            <CartesianGrid stroke="#E8E8E8" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              width={64}
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              tickFormatter={(v) => fmtMoney(Number(v))}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(value) => (typeof value === 'number' ? fmtMoney(value) : '—')}
              labelFormatter={(label, payload) => {
                const point = payload?.[0]?.payload as { date?: string } | undefined
                return point?.date ?? String(label)
              }}
            />
            <Line
              type="monotone"
              dataKey="cost"
              stroke="#10B981"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[11.5px] text-text-muted">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-status-red rounded-full inline-block" />
          最高 {highest ? `${highest.date} ${fmtMoney(highest.cost)}` : '—'}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-status-amber rounded-full inline-block" />
          最低 {lowest ? `${lowest.date} ${fmtMoney(lowest.cost)}` : '—'}
        </span>
      </div>
    </div>
  )
}

/** ponytail: date-range radio filter — defaults to "本月". */
// 时间范围单选筛选器:本月/本周/今日。 (glm-5.2)
function RangeFilter({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return (
    <div className="inline-flex items-center border border-border-light rounded-md overflow-hidden text-[12.5px]">
      {RANGE_OPTIONS.map((opt) => {
        const selected = value === opt.key
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={
              selected
                ? 'px-3 py-1.5 bg-accent-dim text-accent-text font-medium'
                : 'px-3 py-1.5 text-text-muted hover:bg-bg-base'
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 供应商汇总页面组件。
 * 根据时间范围拉取仪表盘、日志与模型消费数据,按标签页渲染不同视图。
 */
export default function ProviderSummary() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('provider')
  const [range, setRange] = useState<RangeKey>('month')

  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [logs, setLogs] = useState<UsageRecord[]>([])
  const [modelSpend, setModelSpend] = useState<ModelSpendAggregate[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // ponytail: range → IPC args. today uses 1-day window so the dashboard
  // call stays cheap; the logs call uses explicit fromISO/toISO bounds to
  // keep the per-model aggregation honest about "today".
  const days = useMemo(() => {
    const opt = RANGE_OPTIONS.find((o) => o.key === range)!
    return opt.days === 'today' ? 1 : opt.days
  }, [range])

  const now = useMemo(() => new Date(), [])

  useEffect(() => {
    let alive = true
    setLoading(true)

    const toISO = now.toISOString()
    const fromMs = now.getTime() - days * 86_400_000
    const fromDate = new Date(fromMs)
    const filter: Parameters<typeof window.api.usage.getLogs>[0] =
      range === 'today'
        ? { fromISO: fromDate.toISOString(), toISO }
        : { fromISO: fromDate.toISOString(), toISO, limit: 5000 }

    Promise.all([
      window.api.usage.getDashboard(days),
      window.api.usage.getLogs(filter),
      window.api.usage.getModelSpend({ fromISO: filter.fromISO, toISO: filter.toISO })
    ])
      .then(([d, l, m]) => {
        if (!alive) return
        setSummary(d)
        setLogs(l ?? [])
        setModelSpend(m ?? [])
      })
      .catch(() => {
        if (!alive) return
        setSummary(null)
        setLogs([])
        setModelSpend([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [days, range, now, reloadKey])

  /** 刷新:同步 CLI 日志、刷新用量后触发重新加载 */
  async function handleRefresh() {
    setRefreshing(true)
    try {
      await Promise.all([
        window.api.log.sync('claude-code').catch(() => ({ started: false })),
        window.api.log.sync('codex').catch(() => ({ started: false }))
      ])
      await window.api.usage.refreshAll()
      // ponytail: bump a counter so the load effect re-runs without the
      // user having to flip range back and forth.
      setReloadKey((k) => k + 1)
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <div className="page-content animate-in">
        <PageHeader title="Provider 汇总" desc="按供应商维度聚合费用与用量数据" />
        <Card>
          <p className="text-text-muted text-[13px] py-6 text-center">加载中…</p>
        </Card>
      </div>
    )
  }

  const providers = summary?.providers ?? []
  const empty = providers.length === 0 && logs.length === 0

  // Top-5 ranking kept from Phase E
  const topProviders = [...providers].sort((a, b) => b.cost - a.cost).slice(0, 5)

  const subtitleFor = (k: RangeKey) =>
    k === 'month' ? '最近 30 天' : k === 'week' ? '最近 7 天' : '今日'
  const trendDays = range === 'month' ? 30 : range === 'week' ? 7 : 1

  return (
    <div className="page-content animate-in">
      <PageHeader
        title="Provider 汇总"
        desc="按供应商维度聚合费用与用量数据"
        action={
          <div className="flex items-center gap-2">
            <RangeFilter value={range} onChange={setRange} />
            <button
              className="btn btn-outline btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <i className="fa-solid fa-arrows-rotate" /> 刷新
            </button>
          </div>
        }
      />

      <Tabs tabs={TAB_DEFS} active={tab} onChange={setTab} />

      {empty ? (
        <Card>
          <EmptyState
            icon="fa-chart-pie"
            title="暂无 Provider 数据"
            hint="先去 API Keys 解析本机会话，或刷新一次余额"
            action={
              <div className="flex gap-2 mt-2">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <i className="fa-solid fa-arrows-rotate" /> 刷新用量
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => navigate('/apikeys')}>
                  <i className="fa-solid fa-arrow-right" /> 前往 API Keys
                </button>
              </div>
            }
          />
        </Card>
      ) : tab === 'provider' ? (
        <>
          <div className="grid grid-cols-[2fr_1fr] gap-4 mb-4 max-md:grid-cols-1">
            <Card
              title="费用占比"
              icon="fa-chart-pie"
              subtitle={`${subtitleFor(range)}各 Provider 费用占比`}
            >
              <DonutChart providers={providers} />
            </Card>
            <Card title="费用 Top 5" icon="fa-fire" subtitle={`${subtitleFor(range)} — 按费用降序`}>
              <ul className="space-y-2">
                {topProviders.map((p, i) => (
                  <li key={p.providerId} className="flex items-center gap-3 text-[13px]">
                    <span className="w-5 h-5 rounded-full bg-accent-dim text-accent-text text-[11px] font-semibold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="text-text-primary flex-1 truncate">{p.providerId}</span>
                    <span className="text-text-secondary font-mono">{fmtMoney(p.cost)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card
            title="Provider 明细"
            icon="fa-server"
            subtitle={`${subtitleFor(range)} — 趋势按最近 7 天 vs 上 7 天对比`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-text-muted text-left">
                  <tr>
                    <th className="py-2 font-medium">Provider</th>
                    <th className="py-2 font-medium text-right">费用</th>
                    <th className="py-2 font-medium text-right">Tokens</th>
                    <th className="py-2 font-medium text-right">占比</th>
                    <th className="py-2 font-medium text-left">主要模型 Top 3</th>
                    <th className="py-2 font-medium text-right">趋势</th>
                  </tr>
                </thead>
                <tbody className="text-text-primary">
                  {providers.map((p) => {
                    const top = topModelsForProvider(logs, p.providerId, 3)
                    const pw = providerWeekWindows(now, logs, p.providerId)
                    const trend = computeTrend(pw.currentWeek, pw.previousWeek)
                    const arrow =
                      trend === null ? '—' : trend > 0.5 ? '▲' : trend < -0.5 ? '▼' : '·'
                    return (
                      <tr key={p.providerId} className="border-t border-border-light align-top">
                        <td className="py-2">{p.providerId}</td>
                        <td className="py-2 text-right font-mono">{fmtMoney(p.cost)}</td>
                        <td className="py-2 text-right font-mono">
                          {p.tokens.toLocaleString('en-US')}
                        </td>
                        <td className="py-2 text-right font-mono">{(p.pct * 100).toFixed(1)}%</td>
                        <td className="py-2">
                          {top.length === 0 ? (
                            <span className="text-text-muted">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {top.map((m) => (
                                <li key={m.model} className="flex items-center gap-2">
                                  <span
                                    className="text-text-primary truncate max-w-[180px]"
                                    title={m.model}
                                  >
                                    {m.model}
                                  </span>
                                  <span className="ml-auto text-text-muted font-mono">
                                    {fmtMoney(m.cost)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className={`py-2 text-right font-mono ${trendClass(trend)}`}>
                          {arrow} {formatPct(trend)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : tab === 'model' ? (
        <Card
          title="模型聚合"
          icon="fa-cubes"
          subtitle={`${subtitleFor(range)} — 跨 Provider 按 model 聚合`}
        >
          {modelSpend.length === 0 ? (
            <EmptyState icon="fa-cubes" title="暂无可用模型记录" hint="等数据回流后会自动出现" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-text-muted text-left">
                  <tr>
                    <th className="py-2 font-medium">Model</th>
                    <th className="py-2 font-medium text-left">Provider(s)</th>
                    <th className="py-2 font-medium text-right">费用</th>
                    <th className="py-2 font-medium text-right">Tokens</th>
                    <th className="py-2 font-medium text-right">请求数</th>
                  </tr>
                </thead>
                <tbody className="text-text-primary">
                  {modelSpend.map((m) => (
                    <tr key={m.model} className="border-t border-border-light">
                      <td className="py-2 font-mono" title={m.model}>
                        {m.model}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {m.providers.map((p) => (
                            <span
                              key={p}
                              className="px-1.5 py-[1px] rounded text-[11px] bg-bg-base border border-border-light text-text-secondary"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-right font-mono">{fmtMoney(m.total, m.currency)}</td>
                      <td className="py-2 text-right font-mono">{fmtCount(m.tokens)}</td>
                      <td className="py-2 text-right font-mono">
                        {m.requests.toLocaleString('en-US')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        // tab === 'trend'
        <Card
          title="每日费用趋势"
          icon="fa-arrow-trend-up"
          subtitle={`${subtitleFor(range)} 每日成本 — 红色为最高 / 琥珀为最低`}
        >
          {summary && summary.daily.length > 0 ? (
            <DailyCostLineChart daily={summary.daily} days={trendDays} now={now} />
          ) : (
            <EmptyState icon="fa-arrow-trend-up" title="暂无每日数据" hint="缩短时间窗口后再看" />
          )}
        </Card>
      )}
    </div>
  )
}
