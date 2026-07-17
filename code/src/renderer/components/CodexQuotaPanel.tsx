import type { CodexUsageSnapshot, CodexUsageWindow } from '../../shared/types/codex-usage'

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function formatResetAt(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function nextResetAt(usage: CodexUsageSnapshot | null): string | null {
  const timestamps = [usage?.fiveHour?.resetAt, usage?.oneWeek?.resetAt]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
  return timestamps.length > 0 ? new Date(Math.min(...timestamps)).toISOString() : null
}

function QuotaRow({ label, window }: { label: string; window: CodexUsageWindow | null }) {
  const remaining = window?.remainingPercent
  const barColor =
    remaining === undefined
      ? 'bg-neutral-200'
      : remaining <= 10
        ? 'bg-red-500'
        : remaining <= 30
          ? 'bg-amber-400'
          : 'bg-emerald-500'
  const width = remaining === undefined ? 0 : Math.max(0, Math.min(100, remaining))

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-text-muted">{label}</span>
        <span className="font-mono font-medium text-text-primary">
          {remaining === undefined ? '—' : `剩余 ${formatPercent(remaining)}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-text-muted">
        <span>周期重置</span>
        <span>{formatResetAt(window?.resetAt ?? null)}</span>
      </div>
    </div>
  )
}

/** ChatGPT/Codex 共用额度面板。 */
export function CodexQuotaPanel({
  usage,
  loading,
  error
}: {
  usage: CodexUsageSnapshot | null
  loading: boolean
  error: string | null
}) {
  return (
    <div className="space-y-3 text-[13px]">
      <QuotaRow label="5 小时额度" window={usage?.fiveHour ?? null} />
      <QuotaRow label="周额度" window={usage?.oneWeek ?? null} />
      <div className="rounded border border-border-light bg-bg-base/40 px-2 py-1.5 flex justify-between gap-3">
        <span className="text-text-muted">下一个周期刷新时间</span>
        <span className="font-mono text-text-secondary text-right">
          {formatResetAt(nextResetAt(usage))}
        </span>
      </div>
      {loading && !usage && <p className="text-[12px] text-text-muted">正在读取 Codex 登录额度…</p>}
      {error && <p className="text-[12px] text-status-red break-words">{error}</p>}
      {!loading && !error && usage && (
        <p className="text-[11px] text-text-muted">
          {usage.planType ? `${usage.planType} 计划 · ` : ''}内部接口数据，每 30 秒自动刷新
        </p>
      )}
    </div>
  )
}
