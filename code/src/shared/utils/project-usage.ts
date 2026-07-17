import type { UsageRecord } from '../types/usage'

export type ProjectUsageRangeDays = 7 | 30 | 90

export interface ProjectUsageDay {
  date: string
  tokens: number
  requests: number
  cost: number
}

export interface ProjectUsageRow {
  key: string
  label: string
  color: string
  cost: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  requests: number
  days: ProjectUsageDay[]
}

export interface ProjectUsageReport {
  dates: string[]
  projects: ProjectUsageRow[]
}

const PROJECT_COLORS = [
  '#0F9F6E',
  '#2563EB',
  '#F59E0B',
  '#8B5CF6',
  '#E11D48',
  '#0891B2',
  '#EA580C',
  '#4F46E5',
  '#65A30D',
  '#DB2777'
]

type MutableProject = Omit<ProjectUsageRow, 'color' | 'days'> & {
  days: Map<string, ProjectUsageDay>
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildDateKeys(days: ProjectUsageRangeDays, now: Date): string[] {
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end)
    date.setDate(end.getDate() - (days - 1 - index))
    return toLocalDateKey(date)
  })
}

function tokensFor(record: UsageRecord): number {
  return (
    record.totalTokens ??
    (record.promptTokens ?? 0) +
      (record.completionTokens ?? 0) +
      (record.cacheCreationTokens ?? 0) +
      (record.cacheReadTokens ?? 0)
  )
}

/** 按项目与本地日期聚合 session-log，并补齐所选周期内的空日期。 */
export function buildProjectUsage(
  logs: UsageRecord[],
  rangeDays: ProjectUsageRangeDays,
  now = new Date()
): ProjectUsageReport {
  const dates = buildDateKeys(rangeDays, now)
  const visibleDates = new Set(dates)
  const projects = new Map<string, MutableProject>()

  for (const record of logs) {
    const capturedAt = new Date(record.capturedAt)
    if (Number.isNaN(capturedAt.getTime())) continue
    const date = toLocalDateKey(capturedAt)
    if (!visibleDates.has(date)) continue

    const projectName = record.agentLabel?.trim()
    const key = projectName || record.sessionId || '(unknown)'
    const label =
      projectName || (record.sessionId ? `${record.sessionId.slice(0, 8)}…` : '未识别项目')
    const project = projects.get(key) ?? {
      key,
      label,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      requests: 0,
      days: new Map<string, ProjectUsageDay>()
    }
    const tokens = tokensFor(record)
    const day = project.days.get(date) ?? { date, tokens: 0, requests: 0, cost: 0 }

    project.cost += record.cost ?? 0
    project.inputTokens += record.promptTokens ?? 0
    project.outputTokens += record.completionTokens ?? 0
    project.cacheReadTokens += record.cacheReadTokens ?? 0
    project.totalTokens += tokens
    project.requests += 1
    day.tokens += tokens
    day.requests += 1
    day.cost += record.cost ?? 0
    project.days.set(date, day)
    projects.set(key, project)
  }

  return {
    dates,
    projects: [...projects.values()]
      .sort((a, b) => b.totalTokens - a.totalTokens)
      .map((project, index) => ({
        ...project,
        color: PROJECT_COLORS[index % PROJECT_COLORS.length]!,
        days: dates.map(
          (date) => project.days.get(date) ?? { date, tokens: 0, requests: 0, cost: 0 }
        )
      }))
  }
}
