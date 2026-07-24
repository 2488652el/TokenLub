/**
 * 仪表盘页面:展示总览统计(真实消耗 Tokens、总请求、总成本、缓存命中率)、
 * 按模型分组的用量趋势折线图、消费统计(折算人民币)与各 Key 余额快照。
 * 支持当日/7 天/30 天/全部的时间范围切换、刷新与导出 CSV。
 * (glm-5.2)
 */
import { Icon } from '../components/Icon'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import clsx from 'clsx'
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
import type {
  DashboardSummary,
  RefreshAllResult,
  TotalSpendSummary,
  UsageAnalysisFilter,
  UsageRecord
} from '../../shared/types/usage'
import type { BalanceSnapshot } from '../../shared/types/provider'
import {
  buildModelUsageSeries,
  type UsageTrendModel,
  type UsageTrendRange,
  type UsageTrendSeries
} from '../../shared/utils/usage-trend'
import { buildDashboardHealth, type DashboardHealthTone } from '../../shared/utils/dashboard-health'
import {
  readUsageAnalysisFilter,
  writeUsageAnalysisFilter,
  type PersistedUsageAnalysisFilter
} from '../../shared/utils/usage-analysis-filter'

/** 时间范围类型,复用 UsageTrendRange */
type RangeKey = UsageTrendRange

/** 时间范围选项:key、显示文案、对应天数(all 为 null) */
const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; days: number | null }> = [
  { key: 'today', label: '当日', days: 1 },
  { key: '7d', label: '7 天', days: 7 },
  { key: '30d', label: '30 天', days: 30 },
  { key: 'all', label: '全部', days: null }
]

const HEALTH_META: Record<
  DashboardHealthTone,
  { label: string; description: string; dotClass: string }
> = {
  healthy: {
    label: '数据完整',
    description: '当前范围内的请求均已匹配价格',
    dotClass: 'bg-emerald-500'
  },
  partial: {
    label: '部分待补价',
    description: '存在尚未匹配价格的请求',
    dotClass: 'bg-amber-500'
  },
  error: {
    label: '刷新有异常',
    description: '部分数据源最近一次刷新失败',
    dotClass: 'bg-red-500'
  },
  empty: {
    label: '等待数据',
    description: '刷新或解析本地会话后显示可信度',
    dotClass: 'bg-text-muted'
  }
}

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
  a.download = `moonmeter-export-${new Date().toISOString().slice(0, 10)}.csv`
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

function formatCapturedAt(value: string | null): string {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/** 按模型分组的用量趋势折线图组件 */
function ModelUsageLineChart({ series }: { series: UsageTrendSeries }) {
  const reducedMotion = useReducedMotion()
  if (!series.points.length || !series.models.length) return null
  return (
    <div className="h-[360px] min-w-0">
      <div className="mb-3 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-[12px] text-text-secondary">
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
          <CartesianGrid
            stroke="rgb(var(--color-line) / 0.1)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'rgb(var(--color-muted))' }}
            tickLine={false}
            minTickGap={24}
            axisLine={{ stroke: 'rgb(var(--color-line) / 0.14)' }}
          />
          <YAxis
            width={52}
            tick={{ fontSize: 11, fill: 'rgb(var(--color-muted))' }}
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
    <div className="min-w-[180px] rounded-md border border-border-light bg-bg-card px-3 py-2 shadow-sm">
      <div className="mb-1 text-[12px] font-medium text-text-primary">{label}</div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-text-muted">无消耗</div>
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
              <span className="font-mono text-text-primary">{fmtCount(r.value)}</span>
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
  const initialFilter = useMemo(() => readUsageAnalysisFilter(window.localStorage), [])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [balances, setBalances] = useState<
    Array<BalanceSnapshot & { id: number; apiKeyId?: string }>
  >([])
  const [spend, setSpend] = useState<TotalSpendSummary | null>(null)
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [refreshResult, setRefreshResult] = useState<RefreshAllResult | null>(null)
  const [syncStatus, setSyncStatus] = useState<Awaited<
    ReturnType<typeof window.api.sync.status>
  > | null>(null)
  const [filter, setFilter] = useState<PersistedUsageAnalysisFilter>(initialFilter)
  const [filterDraft, setFilterDraft] = useState<PersistedUsageAnalysisFilter>(initialFilter)
  const [modelSeries, setModelSeries] = useState<UsageTrendSeries>({
    points: [],
    models: [],
    bucketKind: 'day'
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const range = filter.range

  /** 加载仪表盘数据(汇总、余额、消费、日志) */
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const selected = RANGE_OPTIONS.find((r) => r.key === range) ?? RANGE_OPTIONS[2]!
      const days = selected.days ?? 0
      const fromISO = rangeSince(range)
      const analysisFilter: UsageAnalysisFilter = { days }
      if (filter.source !== 'all') analysisFilter.source = filter.source
      if (filter.modelContains) analysisFilter.modelContains = filter.modelContains
      if (filter.projectContains) analysisFilter.projectContains = filter.projectContains
      const logFilter = { ...analysisFilter, ...(fromISO ? { fromISO } : {}), limit: 10000 }
      // a single dashboard call covers the chart + totals. Balance
      // snapshots are independent (per-key) so they ride along in parallel.
      // Total spend is computed from logs × pricing config over the period.
      const [d, b, s, logs, nextSyncStatus] = await Promise.all([
        window.api.usage.getDashboard(analysisFilter),
        window.api.balance.latest().catch(() => []),
        window.api.usage.getTotalSpend(analysisFilter).catch(() => null),
        window.api.usage.getLogs(logFilter).catch(() => []),
        window.api.sync.status().catch(() => null)
      ])
      setSummary(
        d ? { ...d, daily: selected.days ? fillMissingDays(d.daily, selected.days) : d.daily } : d
      )
      setBalances(b)
      setSpend(s)
      setRecords(logs)
      setSyncStatus(nextSyncStatus)
      setModelSeries(buildModelUsageSeries(logs, range))
    } catch (error) {
      setLoadError((error as Error).message || '仪表盘数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [filter, range])

  useEffect(() => {
    void load()
  }, [load])

  /** 刷新已入库的用量并重新加载 */
  async function handleRefresh() {
    setRefreshing(true)
    try {
      const result = await window.api.usage.refreshAll()
      setRefreshResult(result)
      await load()
    } catch (error) {
      setLoadError((error as Error).message || '刷新失败')
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
  const activeFilterCount =
    (filter.source !== 'all' ? 1 : 0) +
    (filter.modelContains ? 1 : 0) +
    (filter.projectContains ? 1 : 0)
  const hasCnySpend = Boolean(spend && spend.totalRequests > 0)
  const estimatedCostValue = hasCnySpend ? (spend?.cnyTotal ?? 0) : (summary?.totalCost ?? 0)
  const health = useMemo(
    () => buildDashboardHealth(spend, records, refreshResult),
    [records, refreshResult, spend]
  )
  const healthMeta = HEALTH_META[health.tone]
  const syncLabel = !syncStatus?.configured
    ? '本地模式'
    : syncStatus.state === 'syncing'
      ? '云端同步中'
      : syncStatus.state === 'error'
        ? '同步异常'
        : syncStatus.state === 'needs_login'
          ? '需要登录'
          : '云端已连接'

  function updateRange(nextRange: RangeKey) {
    const next = { ...filter, range: nextRange }
    setFilter(next)
    setFilterDraft((current) => ({ ...current, range: nextRange }))
    writeUsageAnalysisFilter(window.localStorage, next)
  }

  function applyFilters() {
    const next: PersistedUsageAnalysisFilter = {
      ...filterDraft,
      modelContains: filterDraft.modelContains.trim(),
      projectContains: filterDraft.projectContains.trim()
    }
    setFilter(next)
    setFilterDraft(next)
    writeUsageAnalysisFilter(window.localStorage, next)
  }

  function clearFilters() {
    const next: PersistedUsageAnalysisFilter = {
      range,
      source: 'all',
      modelContains: '',
      projectContains: ''
    }
    setFilter(next)
    setFilterDraft(next)
    writeUsageAnalysisFilter(window.localStorage, next)
  }

  return (
    <div className="page-content overflow-x-hidden bg-bg-base text-text-primary">
      {loadError && !summary ? (
        <Card className="border-red-200/60 bg-red-50/40 shadow-sm">
          <EmptyState
            icon="fa-triangle-exclamation"
            title="仪表盘加载失败"
            hint={loadError}
            action={
              <button className="btn btn-primary btn-sm" onClick={() => void load()}>
                <Icon name="fa-arrows-rotate" /> 重试
              </button>
            }
          />
        </Card>
      ) : isEmpty ? (
        <Card className="border-border-light bg-bg-card shadow-sm">
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
                <Icon name="fa-arrows-rotate" /> 立即刷新
              </button>
            }
          />
        </Card>
      ) : (
        <MotionGroup className="mx-auto flex min-w-0 max-w-[1440px] flex-col gap-6">
          <section className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium text-text-secondary">MoonMeter</p>
              <h1 className="mt-1 text-[34px] font-bold leading-tight text-text-primary">
                使用统计
              </h1>
              <p className="mt-1 text-[14px] text-text-secondary">
                查看 AI 模型用量、成本和资源包消耗
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="inline-flex h-11 items-center rounded-lg border border-border-light bg-bg-card p-1 shadow-sm">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`h-9 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                      range === option.key
                        ? 'bg-text-primary text-bg-base'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                    aria-pressed={range === option.key}
                    onClick={() => updateRange(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border-light bg-bg-card px-4 text-[13px] font-semibold text-text-primary shadow-sm transition-colors hover:bg-bg-hover disabled:opacity-60"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <Icon name="fa-arrows-rotate" className={refreshing ? 'icon-spin' : ''} /> 刷新
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-border-light bg-bg-card px-4 text-[13px] font-semibold text-text-primary shadow-sm transition-colors hover:bg-bg-hover"
                onClick={() => handleExport(summary)}
              >
                <Icon name="fa-arrow-up-from-bracket" /> 导出
              </button>
            </div>
          </section>

          <div data-usage-filter-bar>
            <Card
              title="统一筛选"
              subtitle="首页指标、趋势与请求日志复用同一组条件"
              action={
                <span className="rounded-full bg-bg-base px-2.5 py-1 text-[11px] font-medium text-text-secondary">
                  {activeFilterCount > 0 ? `${activeFilterCount} 项生效` : '全部数据'}
                </span>
              }
              bodyClassName="pt-1"
            >
              <form
                className="grid grid-cols-1 items-end gap-3 lg:grid-cols-12"
                onSubmit={(event) => {
                  event.preventDefault()
                  applyFilters()
                }}
              >
                <label className="lg:col-span-4">
                  <span className="mb-1.5 block text-[11.5px] font-medium text-text-secondary">
                    数据来源
                  </span>
                  <span className="flex h-9 rounded-md border border-border-light bg-bg-base p-1">
                    {[
                      ['all', '全部'],
                      ['vendor-api', 'API 调用'],
                      ['session-log', 'CLI 会话']
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={filterDraft.source === value}
                        onClick={() =>
                          setFilterDraft((current) => ({
                            ...current,
                            source: value as PersistedUsageAnalysisFilter['source']
                          }))
                        }
                        className={clsx(
                          'flex-1 rounded-sm px-2 text-[11.5px] font-medium transition-colors',
                          filterDraft.source === value
                            ? 'bg-bg-card text-accent-text shadow-sm'
                            : 'text-text-secondary hover:text-text-primary'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </label>

                <label className="lg:col-span-3">
                  <span className="mb-1.5 block text-[11.5px] font-medium text-text-secondary">
                    模型
                  </span>
                  <input
                    type="search"
                    aria-label="全局模型筛选"
                    placeholder="例如 gpt-5"
                    value={filterDraft.modelContains}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        modelContains: event.target.value
                      }))
                    }
                    className="h-9 w-full rounded-md border border-border-light bg-bg-input px-3 text-[12.5px] text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent-dim"
                  />
                </label>

                <label className="lg:col-span-3">
                  <span className="mb-1.5 block text-[11.5px] font-medium text-text-secondary">
                    项目 / Agent
                  </span>
                  <input
                    type="search"
                    aria-label="全局项目筛选"
                    placeholder="例如 tokenlub"
                    value={filterDraft.projectContains}
                    onChange={(event) =>
                      setFilterDraft((current) => ({
                        ...current,
                        projectContains: event.target.value
                      }))
                    }
                    className="h-9 w-full rounded-md border border-border-light bg-bg-input px-3 text-[12.5px] text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent-dim"
                  />
                </label>

                <div className="flex gap-2 lg:col-span-2">
                  <button
                    type="button"
                    className="btn btn-outline btn-sm flex-1"
                    onClick={clearFilters}
                  >
                    清除
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm flex-1">
                    应用
                  </button>
                </div>
              </form>
            </Card>
          </div>

          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-text-primary">核心指标</h2>
                <p className="mt-0.5 text-[12px] text-text-muted">
                  {activeRangeLabel}内的成本、用量与数据可信度
                </p>
              </div>
              <div
                className="inline-flex items-center gap-2 rounded-full border border-border-light bg-bg-card/70 px-3 py-1.5 text-[11.5px] text-text-secondary shadow-sm"
                title={healthMeta.description}
              >
                <span className={clsx('h-1.5 w-1.5 rounded-full', healthMeta.dotClass)} />
                <span className="font-semibold text-text-primary">{healthMeta.label}</span>
                <span className="text-text-muted">·</span>
                <span>{syncLabel}</span>
              </div>
            </div>

            <MotionGroup className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
              <OverviewMetricCard
                label="总成本"
                icon="fa-coins"
                tone="accent"
                value={
                  <AnimatedNumber
                    value={estimatedCostValue}
                    format={(value) => (hasCnySpend ? fmtMoney(value, 'CNY') : fmtMoney(value))}
                    durationMs={520}
                  />
                }
                sub={hasCnySpend ? '统一折算人民币' : '按原始记录汇总'}
                motionOrder={0}
              />
              <OverviewMetricCard
                label="真实消耗 Tokens"
                icon="fa-bolt"
                value={
                  heroNumber !== null ? (
                    <AnimatedNumber value={heroNumber} format={fmtCount} durationMs={520} />
                  ) : (
                    '—'
                  )
                }
                sub={
                  totalTokens > 0
                    ? 'API 请求 + 本地 CLI 会话'
                    : totalBalanceTokens > 0
                      ? `余额快照共 ${fmtCount(totalBalanceTokens)}`
                      : '尚未记录消耗'
                }
                motionOrder={1}
              />
              <OverviewMetricCard
                label="总请求数"
                icon="fa-arrow-right-arrow-left"
                tone="blue"
                value={
                  <AnimatedNumber
                    value={summary?.totalRequests ?? 0}
                    format={(value) => Math.round(value).toLocaleString('en-US')}
                    durationMs={480}
                  />
                }
                sub={`${summary?.providers.length ?? 0} 个活跃来源`}
                motionOrder={2}
              />
              <OverviewMetricCard
                label="计价覆盖"
                icon="fa-tag"
                tone={health.tone === 'error' ? 'red' : health.coverage < 1 ? 'amber' : 'accent'}
                value={
                  <AnimatedNumber
                    value={health.coverage * 100}
                    format={(value) => `${value.toFixed(0)}%`}
                    durationMs={480}
                  />
                }
                sub={
                  health.failedSources > 0
                    ? `${health.failedSources} 个来源刷新失败`
                    : `${health.pricedRequests} 已计价 · ${health.unpricedRequests} 待补价`
                }
                motionOrder={3}
              />
              <OverviewMetricCard
                label="新增输入"
                icon="fa-arrow-down"
                tone="blue"
                value={
                  <AnimatedNumber
                    value={summary?.totalInputTokens ?? 0}
                    format={fmtCount}
                    durationMs={480}
                  />
                }
                sub="Input tokens"
                motionOrder={4}
              />
              <OverviewMetricCard
                label="模型输出"
                icon="fa-arrow-up"
                tone="purple"
                value={
                  <AnimatedNumber
                    value={summary?.totalOutputTokens ?? 0}
                    format={fmtCount}
                    durationMs={480}
                  />
                }
                sub="Output tokens"
                motionOrder={5}
              />
              <OverviewMetricCard
                label="缓存命中率"
                icon="fa-database"
                value={
                  <AnimatedNumber
                    value={cacheHitRate * 100}
                    format={(value) => `${value.toFixed(1)}%`}
                    durationMs={480}
                  />
                }
                sub={`${fmtCount(summary?.totalCacheReadTokens ?? 0)} 缓存读取`}
                progress={cacheHitRate}
                motionOrder={6}
              />
              <OverviewMetricCard
                label="最近数据"
                icon="fa-clock"
                tone={health.lastCapturedAt ? 'accent' : 'amber'}
                value={formatCapturedAt(health.lastCapturedAt)}
                sub={healthMeta.description}
                motionOrder={7}
              />
            </MotionGroup>

            {topProviders.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-text-secondary">
                <span className="font-semibold">主要来源</span>
                {topProviders.map((provider) => (
                  <span
                    key={provider.providerId}
                    className="rounded-full border border-border-light bg-bg-card/55 px-2.5 py-1 font-mono"
                  >
                    {provider.providerId} · {fmtCount(provider.tokens)}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-border-light bg-bg-card/60 p-6 shadow-card backdrop-blur-[2px]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-bold text-text-primary">使用趋势</h2>
                <p className="mt-1 text-[13px] text-text-secondary">
                  按模型分组显示，悬停曲线查看具体用量
                </p>
              </div>
              <span className="text-[14px] font-medium text-text-secondary">
                {activeRangeLabel}
              </span>
            </div>
            {modelSeries.points.length > 0 ? (
              <ModelUsageLineChart series={modelSeries} />
            ) : (
              <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-border text-[13px] text-text-muted">
                暂无当前时间段用量记录
              </div>
            )}
          </section>

          <section className="grid grid-cols-[minmax(0,1fr)_minmax(360px,0.6fr)] gap-6 max-xl:grid-cols-1">
            <div className="rounded-lg border border-border-light bg-bg-card/60 p-6 shadow-card backdrop-blur-[2px]">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-bold text-text-primary">消费统计</h2>
                  <p className="mt-1 text-[13px] text-text-secondary">
                    统一折算人民币，保留未计价请求提示
                  </p>
                </div>
                <Icon name="fa-coins" className="text-accent" />
              </div>
              {spend && spend.totalRequests > 0 ? (
                <div className="space-y-4">
                  <div>
                    <div className="font-mono text-[34px] font-bold leading-none text-text-primary">
                      <AnimatedNumber
                        value={spend.cnyTotal}
                        format={(value) => fmtMoney(value, 'CNY')}
                        durationMs={520}
                      />
                    </div>
                    <p className="mt-2 text-[12.5px] text-text-secondary">
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
                    <p className="font-mono text-[12px] text-text-secondary">
                      原始币种{' '}
                      {spend.byCurrency.map((c) => fmtMoney(c.amount, c.currency)).join(' · ')}
                    </p>
                  ) : null}
                  <p className="text-[12px] text-text-secondary">
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
                <p className="text-[13px] text-text-muted">暂无可计价的请求（检查价格配置）</p>
              )}
            </div>

            <div className="rounded-lg border border-border-light bg-bg-card/60 p-6 shadow-card backdrop-blur-[2px]">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-bold text-text-primary">余额快照</h2>
                  <p className="mt-1 text-[13px] text-text-secondary">
                    各 Key 最近一次资源包读取结果
                  </p>
                </div>
                <Icon name="fa-wallet" className="text-accent-text" />
              </div>
              {balances.length === 0 ? (
                <p className="text-[13px] text-text-muted">
                  还没有余额记录，触发一次刷新后会自动抓取
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="text-left text-text-secondary">
                      <tr>
                        <th className="py-2 font-medium">Provider</th>
                        <th className="py-2 text-right font-medium">剩余</th>
                        <th className="py-2 text-right font-medium">已用</th>
                        <th className="py-2 text-right font-medium">时间</th>
                      </tr>
                    </thead>
                    <tbody className="text-text-primary">
                      {balances.slice(0, 6).map((b) => (
                        <tr key={b.id} className="border-t border-border-light">
                          <td className="py-2">{b.providerId}</td>
                          <td className="py-2 text-right font-mono">
                            {b.remaining !== undefined ? fmtCount(b.remaining) : '—'}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {b.used !== undefined ? fmtCount(b.used) : '—'}
                          </td>
                          <td className="py-2 text-right text-text-secondary">
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

/** 首页核心指标卡片：复用 MoonMeter token，并采用紧凑、可扫读的两行卡片布局。 */
function OverviewMetricCard({
  icon,
  label,
  value,
  sub,
  tone = 'neutral',
  progress,
  motionOrder
}: {
  icon: string
  label: string
  value: ReactNode
  sub: string
  tone?: 'neutral' | 'accent' | 'amber' | 'blue' | 'purple' | 'red'
  progress?: number
  motionOrder: number
}) {
  const iconClass = {
    neutral: 'text-text-secondary bg-bg-hover',
    accent: 'text-accent-text bg-accent-dim',
    amber: 'text-status-amber bg-status-amber-dim',
    blue: 'text-status-blue bg-status-blue-dim',
    purple: 'text-status-purple bg-status-purple-dim',
    red: 'text-status-red bg-status-red-dim'
  }[tone]

  return (
    <div
      data-dashboard-metric={label}
      className="motion-card flex min-h-[132px] flex-col rounded-lg border border-border-light bg-bg-card/60 p-4 shadow-card backdrop-blur-[2px] transition-colors hover:bg-bg-card/80"
      style={{ '--motion-order': motionOrder } as CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-[12px] font-semibold text-text-secondary">{label}</div>
        <span
          className={clsx(
            'flex h-7 w-7 flex-none items-center justify-center rounded-md text-[10px]',
            iconClass
          )}
        >
          <Icon name={icon} />
        </span>
      </div>
      <div className="mt-2 min-w-0 truncate font-mono text-[24px] font-bold leading-tight tracking-[-0.025em] text-text-primary">
        {value}
      </div>
      {progress !== undefined ? (
        <>
          <ProgressBar
            value={progress}
            label={`${label}进度`}
            className="mt-auto pt-3"
            trackClassName="bg-border-light"
            fillClassName="bg-accent"
          />
          <div className="mt-2 truncate text-[11px] text-text-secondary" title={sub}>
            {sub}
          </div>
        </>
      ) : (
        <div className="mt-auto truncate pt-3 text-[11px] text-text-secondary" title={sub}>
          {sub}
        </div>
      )}
    </div>
  )
}

/** 信息胶囊:标签 + 数值的小型展示块 */
function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-light bg-bg-hover/55 px-4 py-3">
      <p className="text-[12px] font-semibold text-text-secondary">{label}</p>
      <p className="mt-1 font-mono text-[17px] font-bold text-text-primary">{value}</p>
    </div>
  )
}
