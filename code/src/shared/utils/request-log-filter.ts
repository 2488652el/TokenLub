/**
 * 请求日志筛选工具:把渲染层的筛选表单状态转换为 IPC 层的 UsageFilter 对象,
 * 含日期边界(本地时区起止)、模型与项目搜索关键字处理。
 */
import type { UsageLogFilter, UsageSource } from '../types/usage'

/** 请求日志导出的最大行数。 */
export const REQUEST_LOGS_EXPORT_LIMIT = 10000

/** 本地时区当日 00:00:00 -> ISO 字符串(作为筛选下界)。 */
function fromLocalISO(s: string): string {
  return new Date(`${s}T00:00:00`).toISOString()
}

/** 本地时区当日 23:59:59.999 -> ISO 字符串(作为筛选上界,含当日)。 */
function toLocalEndISO(s: string): string {
  return new Date(`${s}T23:59:59.999`).toISOString()
}

/**
 * 把渲染层筛选表单状态构建为 IPC 用的 UsageFilter。
 * @param input 表单各字段(供应商/来源/日期/搜索/分页)
 * @returns UsageFilter 对象
 */
export function buildRequestLogFilter(input: {
  providerFilter: string
  sourceFilter: UsageSource | 'all'
  fromDate: string
  toDate: string
  search: string
  projectSearch?: string
  limit: number
  offset?: number
}): UsageLogFilter {
  const filter: UsageLogFilter = { limit: input.limit }
  if (input.offset !== undefined) filter.offset = input.offset
  if (input.providerFilter !== 'all') filter.providerId = input.providerFilter
  if (input.sourceFilter !== 'all') filter.source = input.sourceFilter
  if (input.fromDate) filter.fromISO = fromLocalISO(input.fromDate)
  if (input.toDate) filter.toISO = toLocalEndISO(input.toDate)
  const q = input.search.trim()
  if (q) filter.modelContains = q
  const project = input.projectSearch?.trim()
  if (project) filter.projectContains = project
  return filter
}
