import { Icon } from './Icon'
import { AnimatedNumber, ProgressBar } from './motion'
import { ModelLogo } from './ModelLogo'
import { ProviderIcon } from './ProviderIcon'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import { modelDisplayName, modelTokenSegments } from '../../shared/utils/model-compare'
import type { ModelSpendAggregate } from '../../shared/types/usage'

const TOKEN_TONES = {
  input: { bar: 'bg-accent', dot: 'bg-accent' },
  output: { bar: 'bg-status-purple', dot: 'bg-status-purple' },
  'cache-read': { bar: 'bg-status-blue', dot: 'bg-status-blue' },
  'cache-write': { bar: 'bg-status-amber', dot: 'bg-status-amber' }
} as const

const RANK_ACCENTS = ['rgb(var(--color-accent))', '#8B7B55', '#77736B'] as const

export function ModelUsageCard({ model, rank }: { model: ModelSpendAggregate; rank: number }) {
  const displayName = modelDisplayName(model.model)
  const segments = modelTokenSegments(model)
  const pricedCoverage = model.requests > 0 ? model.pricedRequests / model.requests : 0
  const averageTokens = model.requests > 0 ? model.tokens / model.requests : 0
  const accent = RANK_ACCENTS[rank - 1] ?? 'rgb(var(--color-line) / 0.18)'
  const hasModelPath = displayName !== model.model

  return (
    <article
      data-model-card={model.model}
      className="motion-card motion-card-interactive group relative flex min-h-[350px] flex-col overflow-hidden rounded-xl border border-border-light bg-bg-card/60 shadow-card"
      style={{ '--motion-order': Math.min(rank - 1, 5) } as React.CSSProperties}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />
      <header className="flex items-start justify-between gap-4 bg-[linear-gradient(135deg,rgb(var(--color-accent)/0.08),transparent_62%)] px-5 pb-4 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            data-model-logo
            role="img"
            aria-label={`${displayName} 模型 Logo`}
            className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border border-border-light bg-bg-card shadow-card"
          >
            <ModelLogo
              model={model.model}
              size={29}
              {...(model.providers[0] ? { providerId: model.providers[0] } : {})}
            />
          </span>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <span
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-semibold text-white"
                style={{ backgroundColor: accent }}
              >
                {rank}
              </span>
              <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
                Model
              </span>
            </div>
            <h2
              className="truncate text-[15px] font-semibold tracking-[-0.01em] text-text-primary"
              title={model.model}
            >
              {displayName}
            </h2>
            {hasModelPath ? (
              <p
                className="mt-0.5 truncate font-mono text-[10.5px] text-text-muted"
                title={model.model}
              >
                {model.model}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex-none text-right">
          <div className="text-[10.5px] text-text-muted">费用估算</div>
          <div className="mt-0.5 font-mono text-[18px] font-semibold text-text-primary">
            <AnimatedNumber
              value={model.total}
              format={(value) => fmtMoney(value, model.currency)}
            />
          </div>
          {model.byCurrency.length > 1 ? (
            <div className="mt-1 text-[10px] text-status-amber">包含多币种记录</div>
          ) : null}
        </div>
      </header>

      <div className="flex flex-1 flex-col px-5 pb-5">
        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {model.providers.slice(0, 4).map((provider) => (
            <span
              key={provider}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-base px-2 py-1 text-[10.5px] text-text-secondary"
            >
              <ProviderIcon providerId={provider} size={12} />
              {provider}
            </span>
          ))}
          {model.providers.length > 4 ? (
            <span className="text-[10.5px] text-text-muted">+{model.providers.length - 4}</span>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <ModelMetric label="请求数" value={model.requests} format={(value) => fmtCount(value)} />
          <ModelMetric label="总 Token" value={model.tokens} format={(value) => fmtCount(value)} />
          <ModelMetric label="单次均值" value={averageTokens} format={(value) => fmtCount(value)} />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-secondary">Token 构成</span>
            <span className="font-mono text-[10.5px] text-text-muted">{segments.length} 类</span>
          </div>
          {segments.length > 0 ? (
            <>
              <div
                role="img"
                aria-label={`${displayName} Token 构成`}
                className="flex h-2.5 overflow-hidden rounded-full bg-bg-hover"
              >
                {segments.map((segment) => (
                  <span
                    key={segment.key}
                    className={`${TOKEN_TONES[segment.key].bar} h-full border-r border-white/60 last:border-r-0`}
                    style={{ width: `${segment.share * 100}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {segments.map((segment) => (
                  <div key={segment.key} className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-[10.5px] text-text-muted">
                      <span
                        className={`${TOKEN_TONES[segment.key].dot} h-1.5 w-1.5 flex-none rounded-full`}
                      />
                      {segment.label}
                    </span>
                    <span className="font-mono text-[10.5px] text-text-secondary">
                      {fmtCount(segment.value)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border-light px-3 py-2 text-[11px] text-text-muted">
              暂无 Token 明细
            </div>
          )}
        </div>

        <div className="mt-auto border-t border-border-light pt-3">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[10.5px]">
            <span className="inline-flex items-center gap-1.5 text-text-muted">
              <Icon name="fa-tag" className="text-[9px]" />
              计价覆盖
            </span>
            <span className="font-mono text-text-secondary">
              {model.pricedRequests}/{model.requests} · {(pricedCoverage * 100).toFixed(0)}%
            </span>
          </div>
          <ProgressBar
            value={pricedCoverage}
            label={`${displayName}计价覆盖率`}
            tone={model.unpricedRequests > 0 ? 'amber' : 'accent'}
            trackClassName="h-1.5 bg-bg-hover"
          />
          {model.unpricedRequests > 0 ? (
            <p className="mt-1.5 text-[10.5px] text-status-amber">
              {model.unpricedRequests} 次请求尚未匹配价格
            </p>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function ModelMetric({
  label,
  value,
  format
}: {
  label: string
  value: number
  format: (value: number) => string
}) {
  return (
    <div className="rounded-lg border border-border-light bg-bg-base/70 px-3 py-2.5">
      <div className="text-[10.5px] text-text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-[12.5px] font-semibold text-text-primary">
        <AnimatedNumber value={value} format={format} />
      </div>
    </div>
  )
}
