import type { UsageTrendRange } from './usage-trend'

export const DASHBOARD_RANGE_STORAGE_KEY = 'dashboard_usage_range'

const DEFAULT_DASHBOARD_RANGE: UsageTrendRange = '30d'
const DASHBOARD_RANGES: ReadonlySet<string> = new Set(['today', '7d', '30d', 'all'])

type DashboardRangeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 读取上次选择的用量周期；存储不可用或值无效时回退到 30 天。 */
export function readDashboardRange(storage: DashboardRangeStorage): UsageTrendRange {
  try {
    const stored = storage.getItem(DASHBOARD_RANGE_STORAGE_KEY)
    return stored && DASHBOARD_RANGES.has(stored)
      ? (stored as UsageTrendRange)
      : DEFAULT_DASHBOARD_RANGE
  } catch {
    return DEFAULT_DASHBOARD_RANGE
  }
}

/** 保存用户选择的用量周期；持久化失败不应阻止当前页面切换。 */
export function writeDashboardRange(storage: DashboardRangeStorage, range: UsageTrendRange): void {
  try {
    storage.setItem(DASHBOARD_RANGE_STORAGE_KEY, range)
  } catch {
    // localStorage 可能被系统策略禁用，页面内状态仍可正常使用。
  }
}
