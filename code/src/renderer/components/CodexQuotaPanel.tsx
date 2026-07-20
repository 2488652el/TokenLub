import type { CodexUsageSnapshot, CodexUsageWindow } from '../../shared/types/codex-usage'
import { AnimatedNumber, ProgressBar } from './motion'

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

function QuotaRow({
  label,
  description,
  icon,
  window
}: {
  label: string
  description: string
  icon: string
  window: CodexUsageWindow | null
}) {
  const remaining = window?.remainingPercent
  const width = remaining === undefined ? 0 : Math.max(0, Math.min(100, remaining))
  const tone =
    remaining !== undefined && remaining <= 10
      ? 'red'
      : remaining !== undefined && remaining <= 30
        ? 'amber'
        : 'accent'

  return (
    <div className="rounded-xl border border-border-light bg-bg-base/40 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <i className={`fa-solid ${icon} text-[11px]`} />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-text-primary">{label}</div>
            <div className="mt-0.5 truncate text-[10.5px] text-text-muted">{description}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[15px] font-semibold text-text-primary">
            {remaining === undefined ? (
              '—'
            ) : (
              <AnimatedNumber value={remaining} format={formatPercent} />
            )}
          </div>
          <div className="text-[10px] text-text-muted">剩余</div>
        </div>
      </div>
      <ProgressBar
        value={width / 100}
        label={`${label}剩余额度`}
        tone={tone}
        trackClassName="mt-3 h-2 bg-bg-hover"
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-[10.5px] text-text-muted">
        <span>
          已使用{' '}
          {remaining === undefined ? (
            '—'
          ) : (
            <AnimatedNumber value={100 - remaining} format={formatPercent} />
          )}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-text-secondary">
          <i className="fa-regular fa-clock text-[9px]" />
          {formatResetAt(window?.resetAt ?? null)}
        </span>
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
  const resetAt = formatResetAt(nextResetAt(usage))

  return (
    <div className="flex flex-1 flex-col pt-1 text-[13px]">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <div className="text-[11px] text-text-muted">当前计划</div>
          <div className="mt-0.5 text-[15px] font-semibold text-text-primary">
            {usage?.planType || (loading ? '正在读取…' : 'ChatGPT')}
          </div>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-right">
          <div className="text-[10px] text-emerald-700/70">下次重置</div>
          <div className="mt-0.5 font-mono text-[11px] font-medium text-emerald-800">{resetAt}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 max-xl:grid-cols-1">
        <QuotaRow
          label="5 小时额度"
          description="短周期交互与编程任务"
          icon="fa-gauge-high"
          window={usage?.fiveHour ?? null}
        />
        <QuotaRow
          label="周额度"
          description="本周累计订阅配额"
          icon="fa-calendar-week"
          window={usage?.oneWeek ?? null}
        />
      </div>

      {loading && !usage && (
        <p className="mt-3 text-[11.5px] text-text-muted">正在读取 Codex 登录额度…</p>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11.5px] text-status-red">
          <i className="fa-solid fa-circle-exclamation mt-0.5" />
          <p className="break-words">{error}</p>
        </div>
      )}
      {!loading && !error && usage && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-light pt-3 text-[10.5px] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Codex 登录状态正常
          </span>
          <span>每 30 秒自动刷新</span>
        </div>
      )}
    </div>
  )
}
