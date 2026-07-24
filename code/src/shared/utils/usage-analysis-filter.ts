import type { UsageSource } from '../types/usage'
import type { UsageTrendRange } from './usage-trend'
import { readDashboardRange, writeDashboardRange } from './dashboard-range'

export const USAGE_ANALYSIS_FILTER_STORAGE_KEY = 'usage_analysis_filter_v1'

export interface PersistedUsageAnalysisFilter {
  range: UsageTrendRange
  source: UsageSource | 'all'
  modelContains: string
  projectContains: string
}

type FilterStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const RANGE_VALUES = new Set<UsageTrendRange>(['today', '7d', '30d', 'all'])
const SOURCE_VALUES = new Set<UsageSource | 'all'>(['all', 'vendor-api', 'session-log'])

/** 读取 Dashboard 与请求日志共享的筛选状态；旧版仅保存时间范围时仍可平滑迁移。 */
export function readUsageAnalysisFilter(storage: FilterStorage): PersistedUsageAnalysisFilter {
  const fallback: PersistedUsageAnalysisFilter = {
    range: readDashboardRange(storage),
    source: 'all',
    modelContains: '',
    projectContains: ''
  }
  try {
    const raw = storage.getItem(USAGE_ANALYSIS_FILTER_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PersistedUsageAnalysisFilter>
    return {
      range: parsed.range && RANGE_VALUES.has(parsed.range) ? parsed.range : fallback.range,
      source: parsed.source && SOURCE_VALUES.has(parsed.source) ? parsed.source : 'all',
      modelContains:
        typeof parsed.modelContains === 'string' ? parsed.modelContains.slice(0, 200) : '',
      projectContains:
        typeof parsed.projectContains === 'string' ? parsed.projectContains.slice(0, 200) : ''
    }
  } catch {
    return fallback
  }
}

/** 保存共享筛选状态，并同步旧版 Dashboard 时间范围键以保持向后兼容。 */
export function writeUsageAnalysisFilter(
  storage: FilterStorage,
  filter: PersistedUsageAnalysisFilter
): void {
  writeDashboardRange(storage, filter.range)
  try {
    storage.setItem(USAGE_ANALYSIS_FILTER_STORAGE_KEY, JSON.stringify(filter))
  } catch {
    // localStorage 不可用时保留当前页面内状态即可。
  }
}

function localDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 把首页时间范围转换为请求日志日期输入使用的本地日期边界。 */
export function usageRangeToLocalDates(
  range: UsageTrendRange,
  now = new Date()
): { from: string; to: string } {
  const to = localDate(now)
  if (range === 'all') return { from: '', to }
  const from = new Date(now)
  from.setDate(from.getDate() - (range === 'today' ? 0 : range === '7d' ? 6 : 29))
  return { from: localDate(from), to }
}
