/**
 * 项目用量页面:按 CLI 会话的项目名称聚合 Token、请求与费用，
 * 并按日期展示项目 Token 热力图。
 */
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { StatTile } from '../components/StatTile'
import { EmptyState } from '../components/EmptyState'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import {
  buildProjectUsage,
  type ProjectUsageDay,
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
    <div className="inline-flex items-center border border-border-light rounded-md overflow-hidden text-[12.5px]">
      {RANGE_OPTIONS.map((option) => {
        const selected = option.days === value
        return (
          <button
            key={option.days}
            type="button"
            onClick={() => onChange(option.days)}
            className={
              selected
                ? 'px-3 py-1.5 bg-accent-dim text-accent-text font-medium'
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

function colorWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function formatHeatmapDate(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date(`${date}T12:00:00`))
}

type ActiveCell = {
  project: ProjectUsageRow
  day: ProjectUsageDay
}

function ProjectTokenHeatmap({
  projects,
  dates
}: {
  projects: ProjectUsageRow[]
  dates: string[]
}) {
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null)
  const cellWidth = dates.length <= 7 ? 64 : dates.length <= 30 ? 22 : 18
  const gridTemplateColumns = `144px repeat(${dates.length}, ${cellWidth}px)`

  return (
    <Card
      title="项目 Token 热力图"
      subtitle="颜色区分项目，色块越深表示当天 Token 用量越高"
      icon="fa-fire"
      className="mb-5"
      bodyClassName="pt-1"
    >
      <div className="mb-3 flex min-h-10 items-center rounded-md border border-border-light bg-bg-base px-3 py-2">
        {activeCell ? (
          <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
            <span className="flex items-center gap-2 font-medium text-text-primary">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: activeCell.project.color }}
              />
              {activeCell.project.label}
            </span>
            <span className="text-text-secondary">{formatHeatmapDate(activeCell.day.date)}</span>
            <span className="font-mono font-semibold text-text-primary">
              {fmtCount(activeCell.day.tokens)} Tokens
            </span>
            <span className="text-text-muted">
              {activeCell.day.requests.toLocaleString('en-US')} 次请求
            </span>
            <span className="font-mono text-text-muted">{fmtMoney(activeCell.day.cost)}</span>
          </div>
        ) : (
          <span className="text-[12.5px] text-text-muted">
            将鼠标移到或触摸色块，查看当天的项目 Token 用量
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
        {projects.map((project) => (
          <span
            key={project.key}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-text-secondary"
          >
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: project.color }} />
            {project.label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid gap-1" style={{ gridTemplateColumns }}>
          <div />
          {dates.map((date, index) => {
            const showLabel = index === 0 || index === dates.length - 1 || index % 5 === 0
            return (
              <div
                key={date}
                className="h-5 whitespace-nowrap text-center text-[9.5px] leading-5 text-text-muted"
                title={formatHeatmapDate(date)}
              >
                {showLabel ? date.slice(5) : ''}
              </div>
            )
          })}

          {projects.flatMap((project) => {
            const maxTokens = Math.max(...project.days.map((day) => day.tokens), 1)
            return [
              <div
                key={`${project.key}-label`}
                className="flex min-w-0 items-center gap-2 pr-2 text-[12px] text-text-primary"
              >
                <span
                  className="h-2.5 w-2.5 flex-none rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate" title={project.label}>
                  {project.label}
                </span>
              </div>,
              ...project.days.map((day) => {
                const intensity =
                  day.tokens === 0 ? 0.07 : 0.22 + 0.78 * Math.sqrt(day.tokens / maxTokens)
                const detail = `${project.label} · ${formatHeatmapDate(day.date)} · ${fmtCount(day.tokens)} Tokens`
                return (
                  <button
                    key={`${project.key}-${day.date}`}
                    type="button"
                    aria-label={detail}
                    title={detail}
                    className="h-6 rounded-[4px] border border-black/5 transition-transform hover:scale-110 focus:z-10 focus:scale-110 focus:outline-none focus:ring-2 focus:ring-accent/40"
                    style={{ backgroundColor: colorWithAlpha(project.color, intensity) }}
                    onMouseEnter={() => setActiveCell({ project, day })}
                    onFocus={() => setActiveCell({ project, day })}
                    onTouchStart={() => setActiveCell({ project, day })}
                  />
                )
              })
            ]
          })}
        </div>
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
      <div className="page-content animate-in">
        {header}
        <Card>
          <p className="text-text-muted text-[13px] py-6 text-center">加载中…</p>
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
    <div className="page-content animate-in">
      {header}

      <div className="grid grid-cols-4 gap-4 mb-5 max-md:grid-cols-2">
        <StatTile
          label="项目数"
          icon="fa-folder-tree"
          value={report.projects.length}
          sub={`最近 ${rangeDays} 天 · ${totalRequests.toLocaleString('en-US')} 次请求`}
        />
        <StatTile
          label="总费用"
          icon="fa-coins"
          value={fmtMoney(totalCost)}
          sub={`覆盖 ${logs.length.toLocaleString('en-US')} 条 session-log 记录`}
          accent="amber"
        />
        <StatTile
          label="总 Tokens"
          icon="fa-arrow-right-to-line"
          value={fmtCount(totalTokens)}
          sub={`最近 ${rangeDays} 天的项目 Token 用量`}
          accent="blue"
        />
        <StatTile
          label="平均每次请求 Tokens"
          icon="fa-scale-balanced"
          value={fmtCount(Math.round(avgTokensPerRequest))}
          sub={`基于 ${totalRequests.toLocaleString('en-US')} 次请求`}
          accent="purple"
        />
      </div>

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

          <Card
            title="项目 Token 用量"
            subtitle={`最近 ${rangeDays} 天，按总 Token 用量降序`}
            icon="fa-list-ul"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-text-muted text-left">
                  <tr>
                    <th className="py-2 font-medium">项目</th>
                    <th className="py-2 font-medium text-right">请求数</th>
                    <th className="py-2 font-medium text-right">Input Tokens</th>
                    <th className="py-2 font-medium text-right">Output Tokens</th>
                    <th className="py-2 font-medium text-right">总 Tokens</th>
                    <th className="py-2 font-medium text-right">费用</th>
                  </tr>
                </thead>
                <tbody className="text-text-primary">
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
