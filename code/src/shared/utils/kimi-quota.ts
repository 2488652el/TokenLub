/** Normalize the Kimi Code `/coding/v1/usages` response for the API key card. */
export type KimiQuotaWindow = {
  label: string
  usedPercent?: number
  remainingText?: string
  resetText?: string
}

type Usage = {
  limit?: string | number
  used?: string | number
  remaining?: string | number
  resetTime?: string
  reset_at?: string
}

type Response = {
  usage?: Usage
  limits?: Array<{
    window?: { duration?: number; timeUnit?: string }
    detail?: Usage
  }>
}

export function extractKimiCodingQuotas(raw: unknown): {
  weeklyWindow: KimiQuotaWindow | null
  rateWindow: KimiQuotaWindow | null
} {
  if (!raw || typeof raw !== 'object') return { weeklyWindow: null, rateWindow: null }
  const body = raw as Response
  return {
    weeklyWindow: normalizeWindow('7d', body.usage),
    rateWindow: normalizeWindow(windowLabel(body.limits?.[0]?.window), body.limits?.[0]?.detail)
  }
}

function normalizeWindow(label: string, usage: Usage | undefined): KimiQuotaWindow | null {
  if (!usage) return null
  const limit = toNumber(usage.limit)
  const used = toNumber(usage.used)
  const remaining = toNumber(usage.remaining)
  if (limit === undefined || limit <= 0) return null
  const rawUsedPercent =
    used !== undefined
      ? (used / limit) * 100
      : remaining !== undefined
        ? ((limit - remaining) / limit) * 100
        : NaN
  const usedPercent = clamp(rawUsedPercent)
  if (usedPercent === undefined) return null
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent))
  const reset = usage.resetTime ?? usage.reset_at
  return {
    label,
    usedPercent,
    remainingText: `剩余 ${remainingPercent.toFixed(0)}%`,
    ...(reset ? { resetText: `重置 ${reset}` } : {})
  }
}

function windowLabel(window: { duration?: number; timeUnit?: string } | undefined): string {
  const duration = window?.duration
  const unit = window?.timeUnit?.toUpperCase()
  if (!duration || !unit) return '短周期'
  if (unit.includes('MINUTE')) return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`
  if (unit.includes('HOUR')) return `${duration}h`
  if (unit.includes('DAY')) return `${duration}d`
  return `${duration}`
}

function toNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

function clamp(value: number): number | undefined {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined
}
