/**
 * 项目用量页面：按 CLI 会话的项目名称聚合 Token、请求与费用，
 * 并用紧凑热力图和多项目趋势图展示每日变化。
 */
import { useEffect, useState } from 'react'
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
import { StatTile } from '../components/StatTile'
import { EmptyState } from '../components/EmptyState'
import { AnimatedNumber, MotionGroup } from '../components/motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import {
  buildProjectUsage,
  type ProjectUsageRangeDays,
  type ProjectUsageRow
} from '../../shared/utils/project-usage'
import type { UsageRecord } from '../../shared/types/usage'

const RANGE_OPTIONS: Array<{ days: ProjectUsageRangeDays; label: string }> = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' }
]

function RangeFilter({
  value,
  onChange
}: {
  value: ProjectUsageRangeDays
  onChange: (days: ProjectUsageRangeDays) => void
}) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-border-light text-[12.5px]">
      {RANGE_OPTIONS.map((option) => {
        const selected = option.days === value
        return (
          <button
            key={option.days}
            type="button"
            onClick={() => onChange(option.days)}
            className={
              selected
                ? 'bg-accent-dim px-3 py-1.5 font-medium text-accent-text'
                : 'px-3 py-1.5 text-text-muted hover:bg-bg-base'
            }
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function formatHeatmapDate(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date(`${date}T12:00:00`))
}

type DailyHeatmapCell = {
  date: string
  tokens: number
  requests: number
  cost: number
  topProject: ProjectUsageRow | null
}

/**
 * 用单层日期网格替代“项目 × 日期”的二维矩阵。
 * 热力图负责回答“哪几天最忙”，项目之间的差异交给下面的趋势图。
 */
function ProjectTokenHeatmap({
  projects,
  dates
}: {
  projects: ProjectUsageRow[]
  dates: string[]
}) {
  const reducedMotion = useReducedMotion()
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const daily = dates.map<DailyHeatmapCell>((date) => {
    const dayRows = projects.flatMap((project) => {
      const day = project.days.find((item) => item.date === date)
      return day ? [{ project, day }] : []
    })
    const topProject =
      dayRows.reduce<{ project: ProjectUsageRow; tokens: number } | null>(
        (best, item) =>
          !best || item.day.tokens > best.tokens
            ? { project: item.project, tokens: item.day.tokens }
            : best,
        null
      )?.project ?? null

    return {
      date,
      tokens: dayRows.reduce((sum, item) => sum + item.day.tokens, 0),
      requests: dayRows.reduce((sum, item) => sum + item.day.requests, 0),
      cost: dayRows.reduce((sum, item) => sum + item.day.cost, 0),
      topProject
    }
  })
  const maxTokens = Math.max(...daily.map((day) => day.tokens), 1)
  const activeCell = daily.find((day) => day.date === activeDate) ?? null

  return (
    <Card
      title="项目 Token 热力图"
      subtitle="按天查看总 Token 用量，颜色越深表示当天用量越高"
      icon="fa-fire"
      className="mb-5"
      bodyClassName="pt-1"
    >
      <div className="mb-3 flex min-h-10 items-center rounded-md border border-border-light bg-bg-base px-3 py-2">
        {activeCell ? (
          <div
            key={activeCell.date}
            className="motion-data-flash flex w-full flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]"
          >
            <span className="text-text-secondary">{formatHeatmapDate(activeCell.date)}</span>
            <span className="font-mono font-semibold text-text-primary">
              {fmtCount(activeCell.tokens)} Tokens
            </span>
            <span className="text-text-muted">
              {activeCell.requests.toLocaleString('en-US')} 次请求
            </span>
            <span className="font-mono text-text-muted">{fmtMoney(activeCell.cost)}</span>
            {activeCell.topProject ? (
              <span className="inline-flex items-center gap-1.5 text-text-muted">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: activeCell.topProject.color }}
                />
                主要项目：{activeCell.topProject.label}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-[12.5px] text-text-muted">
            将鼠标移到日期色块，查看当天的用量详情
          </span>
        )}
      </div>

      <div className="mb-3 flex items-center justify-end gap-2 text-[11px] text-text-muted">
        <span>少</span>
        <span className="h-2.5 w-2.5 rounded-sm bg-[rgba(15,159,110,0.12)]" />
        <span className="h-2.5 w-2.5 rounded-sm bg-[rgba(15,159,110,0.42)]" />
        <span className="h-2.5 w-2.5 rounded-sm bg-[rgba(15,159,110,0.9)]" />
        <span>多</span>
      </div>

      <MotionGroup className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {daily.map((day) => {
          const intensity =
            day.tokens === 0 ? 0.08 : 0.14 + 0.76 * Math.sqrt(day.tokens / maxTokens)
          const detail = `${formatHeatmapDate(day.date)} · ${fmtCount(day.tokens)} Tokens`
          return (
            <button
              key={day.date}
              type="button"
              aria-label={detail}
              title={detail}
              className={`group relative h-8 rounded-md border border-black/5 focus:z-10 focus:outline-none focus:ring-2 focus:ring-accent/40 sm:h-9 ${
                reducedMotion ? '' : 'transition-transform hover:-translate-y-0.5 hover:shadow-sm'
              }`}
              style={{ backgroundColor: `rgba(15, 159, 110, ${intensity})` }}
              onMouseEnter={() => setActiveDate(day.date)}
              onFocus={() => setActiveDate(day.date)}
              onTouchStart={() => setActiveDate(day.date)}
            >
              <span className="sr-only">{detail}</span>
              <span className="pointer-events-none absolute inset-x-0 bottom-1 text-[9px] text-text-secondary opacity-0 transition-opacity group-hover:opacity-100 sm:text-[10px]">
                {day.date.slice(5)}
              </span>
            </button>
          )
        })}
      </MotionGroup>
    </Card>
  )
}

function ProjectTrendTooltip({
  active,
  label,
  payload,
  projects
}: {
  active?: boolean
  label?: string
  payload?: Array<{ dataKey?: string | number; value?: number }>
  projects: ProjectUsageRow[]
}) {
  if (!active || !payload?.length) return null
  const rows = payload
    .map((item) => {
      const index = Number(String(item.dataKey ?? '').replace('project-', ''))
      const project = projects[index]
      return project ? { project, value: Number(item.value ?? 0) } : null
    })
    .filter((row): row is { project: ProjectUsageRow; value: number } => Boolean(row))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)

  return (
    <div className="min-w-[190px] rounded-md border border-border-light bg-bg-card px-3 py-2 shadow-popover">
      <div className="mb-1 text-[12px] font-medium text-text-primary">{label}</div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-text-muted">无消耗</div>
      ) : (
        <div className="space-y-1">
          {rows.map(({ project, value }) => (
            <div key={project.key} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} />
                <span className="max-w-[140px] truncate text-text-secondary" title={project.label}>
                  {project.label}
                </span>
              </span>
              <span className="font-mono text-text-primary">{fmtCount(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectTokenTrendChart({
  projects,
  dates
}: {
  projects: ProjectUsageRow[]
  dates: string[]
}) {
  const reducedMotion = useReducedMotion()
  const data = dates.map((date) => {
    const point: Record<string, string | number> = { date, label: date.slice(5) }
    projects.forEach((project, index) => {
      point[`project-${index}`] = project.days.find((day) => day.date === date)?.tokens ?? 0
    })
    return point
  })

  return (
    <Card
      title="项目 Token 趋势"
      subtitle="按天展示每个项目的用量变化，线条颜色对应项目"
      icon="fa-chart-line"
      className="mb-5"
    >
      <div className="mb-3 flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-[12px] text-text-secondary">
        {projects.map((project) => (
          <span
            key={project.key}
            className="inline-flex max-w-[220px] min-w-0 items-center gap-1.5"
          >
            <span
              className="h-2 w-2 flex-none rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <span className="truncate" title={project.label}>
              {project.label}
            </span>
          </span>
        ))}
      </div>
      <div className="h-[300px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
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
              tickFormatter={(value) => fmtCount(Number(value))}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ProjectTrendTooltip projects={projects} />} />
            {projects.map((project, index) => (
              <Line
                key={project.key}
                type="monotone"
                dataKey={`project-${index}`}
                name={project.label}
                stroke={project.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={!reducedMotion}
                animationBegin={reducedMotion ? 0 : Math.min(index * 36, 144)}
                animationDuration={560}
                animationEasing="ease-out"
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

/** 项目用量页面组件，默认查询并展示最近 30 天。 */
export default function AgentDetail() {
  const [rangeDays, setRangeDays] = useState<ProjectUsageRangeDays>(30)
  const [logs, setLogs] = useState<UsageRecord[] | null>(null)

  useEffect(() => {
    let alive = true
    setLogs(null)
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - (rangeDays - 1))

    window.api.usage
      .getLogs({
        source: 'session-log',
        fromISO: from.toISOString(),
        limit: 10000
      })
      .then((rows) => {
        if (alive) setLogs(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (alive) setLogs([])
      })
    return () => {
      alive = false
    }
  }, [rangeDays])

  const header = (
    <PageHeader
      title="项目用量"
      desc="按本地 CLI 项目聚合 Token、请求与费用"
      action={<RangeFilter value={rangeDays} onChange={setRangeDays} />}
    />
  )

  if (logs === null) {
    return (
      <div className="page-content">
        {header}
        <Card>
          <p className="py-6 text-center text-[13px] text-text-muted">加载中…</p>
        </Card>
      </div>
    )
  }

  const report = buildProjectUsage(logs, rangeDays)
  const totalCost = report.projects.reduce((sum, project) => sum + project.cost, 0)
  const totalTokens = report.projects.reduce((sum, project) => sum + project.totalTokens, 0)
  const totalRequests = report.projects.reduce((sum, project) => sum + project.requests, 0)
  const avgTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 0

  return (
    <div className="page-content">
      {header}

      <MotionGroup className="mb-5 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <StatTile
          label="项目数"
          icon="fa-folder-tree"
          value={
            <AnimatedNumber
              value={report.projects.length}
              format={(value) => Math.round(value).toLocaleString('en-US')}
            />
          }
          sub={`最近 ${rangeDays} 天 · ${totalRequests.toLocaleString('en-US')} 次请求`}
          motionOrder={0}
        />
        <StatTile
          label="总费用"
          icon="fa-coins"
          value={<AnimatedNumber value={totalCost} format={fmtMoney} />}
          sub={`覆盖 ${logs.length.toLocaleString('en-US')} 条 session-log 记录`}
          accent="amber"
          motionOrder={1}
        />
        <StatTile
          label="总 Tokens"
          icon="fa-arrow-right-to-line"
          value={<AnimatedNumber value={totalTokens} format={fmtCount} />}
          sub={`最近 ${rangeDays} 天的项目 Token 用量`}
          accent="blue"
          motionOrder={2}
        />
        <StatTile
          label="平均每次请求 Tokens"
          icon="fa-scale-balanced"
          value={<AnimatedNumber value={avgTokensPerRequest} format={fmtCount} />}
          sub={`基于 ${totalRequests.toLocaleString('en-US')} 次请求`}
          accent="purple"
          motionOrder={3}
        />
      </MotionGroup>

      {report.projects.length === 0 ? (
        <Card>
          <EmptyState
            icon="fa-folder-open"
            title="暂无项目用量"
            hint={`最近 ${rangeDays} 天尚未解析到本地 CLI 项目日志`}
          />
        </Card>
      ) : (
        <>
          <ProjectTokenHeatmap projects={report.projects} dates={report.dates} />
          <ProjectTokenTrendChart projects={report.projects} dates={report.dates} />

          <Card
            title="项目 Token 用量"
            subtitle={`最近 ${rangeDays} 天，按总 Token 用量降序`}
            icon="fa-list-ul"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-text-muted">
                  <tr>
                    <th className="py-2 font-medium">项目</th>
                    <th className="py-2 text-right font-medium">请求数</th>
                    <th className="py-2 text-right font-medium">Input Tokens</th>
                    <th className="py-2 text-right font-medium">Output Tokens</th>
                    <th className="py-2 text-right font-medium">总 Tokens</th>
                    <th className="py-2 text-right font-medium">费用</th>
                  </tr>
                </thead>
                <tbody className="motion-table-rows text-text-primary">
                  {report.projects.map((project) => (
                    <tr key={project.key} className="border-t border-border-light">
                      <td className="py-2.5">
                        <span className="flex max-w-[280px] items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 flex-none rounded-sm"
                            style={{ backgroundColor: project.color }}
                          />
                          <span className="truncate" title={project.label}>
                            {project.label}
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {project.requests.toLocaleString('en-US')}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {project.inputTokens.toLocaleString('en-US')}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        {project.outputTokens.toLocaleString('en-US')}
                      </td>
                      <td className="py-2.5 text-right font-mono font-medium">
                        {project.totalTokens.toLocaleString('en-US')}
                      </td>
                      <td className="py-2.5 text-right font-mono">{fmtMoney(project.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
