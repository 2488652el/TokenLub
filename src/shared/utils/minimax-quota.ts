/**
 * MiniMax Coding Plan 配额解析工具:从供应商返回的多种可能字段结构中,
 * 归一化提取 5 小时窗口 / 周窗口的已用百分比、剩余额度与重置文案。
 * 兼容驼峰 / 下划线 / 嵌套 model_remains 等多种返回形态。
 * (glm-5.2)
 */

/** Coding Plan 配额信息:已用百分比与人类可读的已用/剩余/重置文案。 */
export type CodingPlanQuota = {
  usedPercent?: number
  usedText?: string
  remainingText?: string
  resetText?: string
}

/**
 * 从原始响应中提取短窗口(5 小时)与周窗口配额。
 * @param raw 供应商返回的原始 JSON
 * @returns { shortWindow, weeklyWindow } 两个窗口的配额(无数据时为 null)
 */
export function extractCodingPlanQuotas(raw: unknown): {
  shortWindow: CodingPlanQuota | null
  weeklyWindow: CodingPlanQuota | null
} {
  if (!raw || typeof raw !== 'object') return { shortWindow: null, weeklyWindow: null }
  const root = raw as Record<string, unknown>
  const data = asObject(root.data) ?? root
  const modelRemains = normalizeModelRemains(data)
  return {
    shortWindow:
      modelRemains.shortWindow ??
      normalizeQuota(
        data.fiveHourWindow ??
          data.five_hour_window ??
          data.fiveHourLimit ??
          data.five_hour_limit ??
          data.shortWindow ??
          data.short_window ??
          data.oneHalfHour ??
          data.one_half_hour ??
          data.hourLimit
      ) ??
      normalizeFlatQuota(data, 'five-hour'),
    weeklyWindow:
      modelRemains.weeklyWindow ??
      normalizeQuota(
        data.weeklyWindow ??
          data.weekly_window ??
          data.weeklyLimit ??
          data.weekly_limit ??
          data.weekLimit
      ) ??
      normalizeFlatQuota(data, 'weekly')
  }
}

function normalizeModelRemains(data: Record<string, unknown>): {
  shortWindow: CodingPlanQuota | null
  weeklyWindow: CodingPlanQuota | null
} {
  const rows = Array.isArray(data.model_remains)
    ? data.model_remains
    : Array.isArray(data.modelRemains)
      ? data.modelRemains
      : null
  if (!rows || rows.length === 0) return { shortWindow: null, weeklyWindow: null }

  const preferred =
    rows.find(
      (row) =>
        row &&
        typeof row === 'object' &&
        ((row as Record<string, unknown>).model_name === 'general' ||
          (row as Record<string, unknown>).modelName === 'general')
    ) ?? rows[0]
  const quotaRow = asObject(preferred)
  if (!quotaRow) return { shortWindow: null, weeklyWindow: null }

  return {
    shortWindow: normalizeModelRemainQuota(quotaRow, 'interval'),
    weeklyWindow: normalizeModelRemainQuota(quotaRow, 'weekly')
  }
}

function normalizeModelRemainQuota(
  row: Record<string, unknown>,
  window: 'interval' | 'weekly'
): CodingPlanQuota | null {
  const remainingPercent =
    window === 'interval'
      ? firstFinite(row.current_interval_remaining_percent, row.currentIntervalRemainingPercent)
      : firstFinite(row.current_weekly_remaining_percent, row.currentWeeklyRemainingPercent)
  if (remainingPercent === undefined) return null

  const usedPercent = Math.max(0, Math.min(100, 100 - remainingPercent))
  return {
    usedPercent,
    remainingText: `剩余 ${remainingPercent}%`
  }
}

function normalizeQuota(value: unknown): CodingPlanQuota | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const remainingPercent = toFiniteNumber(
    row.remainingPercent ??
      row.remaining_percent ??
      row.currentRemainingPercent ??
      row.current_remaining_percent
  )
  const usedPercent =
    toFiniteNumber(
      row.usedPercent ??
        row.used_percent ??
        row.percent ??
        row.currentUsedPercent ??
        row.current_used_percent
    ) ??
    (remainingPercent !== undefined
      ? Math.max(0, Math.min(100, 100 - remainingPercent))
      : undefined)
  const usedText =
    toOptionalString(row.usedText ?? row.used_text ?? row.used) ?? describeQuotaAmount(row, 'used')
  const remainingText =
    toOptionalString(row.remainingText ?? row.remaining_text ?? row.remaining) ??
    describeQuotaAmount(row, 'remaining')
  const resetText =
    toOptionalString(
      row.resetText ??
        row.reset_text ??
        row.resetAt ??
        row.reset_at ??
        row.nextResetAt ??
        row.next_reset_at
    ) ?? describeReset(row)
  const normalized = {
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(usedText !== undefined ? { usedText } : {}),
    ...(remainingText !== undefined ? { remainingText } : {}),
    ...(resetText !== undefined ? { resetText } : {})
  }
  return Object.keys(normalized).length ? normalized : null
}

function normalizeFlatQuota(
  data: Record<string, unknown>,
  window: 'five-hour' | 'weekly'
): CodingPlanQuota | null {
  const prefix = window === 'five-hour' ? 'five_hour' : 'weekly'
  const camelPrefix = window === 'five-hour' ? 'fiveHour' : 'weekly'
  const remainingPercent = firstFinite(
    data[`current_${prefix}_remaining_percent`],
    data[`current_${camelPrefix}RemainingPercent`],
    data[`${prefix}_remaining_percent`],
    data[`${camelPrefix}RemainingPercent`]
  )
  const usedPercent =
    firstFinite(
      data[`current_${prefix}_used_percent`],
      data[`current_${camelPrefix}UsedPercent`],
      data[`${prefix}_used_percent`],
      data[`${camelPrefix}UsedPercent`]
    ) ??
    (remainingPercent !== undefined
      ? Math.max(0, Math.min(100, 100 - remainingPercent))
      : undefined)
  const remainingText =
    describeAmount(
      firstDefined(
        data[`current_${prefix}_remaining_times`],
        data[`current_${camelPrefix}RemainingTimes`],
        data[`${prefix}_remaining_times`],
        data[`${camelPrefix}RemainingTimes`]
      ),
      '剩余'
    ) ??
    describeAmount(
      firstDefined(
        data[`current_${prefix}_remaining_amount`],
        data[`current_${camelPrefix}RemainingAmount`],
        data[`${prefix}_remaining_amount`],
        data[`${camelPrefix}RemainingAmount`]
      ),
      '剩余'
    ) ??
    describeAmount(remainingPercent, '剩余', '%')
  const usedText =
    describeAmount(
      firstDefined(
        data[`current_${prefix}_used_times`],
        data[`current_${camelPrefix}UsedTimes`],
        data[`${prefix}_used_times`],
        data[`${camelPrefix}UsedTimes`]
      ),
      '已用'
    ) ??
    describeAmount(
      firstDefined(
        data[`current_${prefix}_used_amount`],
        data[`current_${camelPrefix}UsedAmount`],
        data[`${prefix}_used_amount`],
        data[`${camelPrefix}UsedAmount`]
      ),
      '已用'
    )
  const resetText =
    describeValue(
      firstDefined(
        data[`current_${prefix}_reset_at`],
        data[`current_${camelPrefix}ResetAt`],
        data[`${prefix}_reset_at`],
        data[`${camelPrefix}ResetAt`]
      ),
      '重置'
    ) ??
    describeValue(
      firstDefined(
        data[`current_${prefix}_window`],
        data[`current_${camelPrefix}Window`],
        data[`${prefix}_window`],
        data[`${camelPrefix}Window`]
      ),
      '窗口'
    )
  const normalized = {
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(usedText !== undefined ? { usedText } : {}),
    ...(remainingText !== undefined ? { remainingText } : {}),
    ...(resetText !== undefined ? { resetText } : {})
  }
  return Object.keys(normalized).length ? normalized : null
}

function describeQuotaAmount(
  row: Record<string, unknown>,
  kind: 'used' | 'remaining'
): string | undefined {
  const primary =
    kind === 'used'
      ? (row.usedTimes ?? row.used_times)
      : (row.remainingTimes ?? row.remaining_times)
  const secondary =
    kind === 'used'
      ? (row.usedAmount ?? row.used_amount)
      : (row.remainingAmount ?? row.remaining_amount)
  return (
    describeAmount(primary, kind === 'used' ? '已用' : '剩余') ??
    describeAmount(secondary, kind === 'used' ? '已用' : '剩余')
  )
}

function describeReset(row: Record<string, unknown>): string | undefined {
  return (
    describeValue(row.resetWindow ?? row.reset_window, '窗口') ??
    describeValue(row.nextResetWindow ?? row.next_reset_window, '窗口')
  )
}

function describeAmount(value: unknown, label: string, suffix = ' 次'): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return `${label} ${value}${suffix}`
  if (typeof value === 'string' && value.trim())
    return `${label} ${value.trim()}${suffix === '%' ? '' : suffix}`
  return undefined
}

function describeValue(value: unknown, label: string): string | undefined {
  const text = toOptionalString(value)
  return text ? `${label} ${text}` : undefined
}

function firstFinite(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = toFiniteNumber(value)
    if (n !== undefined) return n
  }
  return undefined
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}
