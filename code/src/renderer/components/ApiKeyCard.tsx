/**
 * 单个 API Key 的卡片组件:展示余额、用量进度条、消费估算、创建时间,
 * 以及编辑/测试/删除/刷新/用量查询开关等操作。
 * 根据 providerId 自动选择不同的余额展示形态(coding-plan / token-pack / cash-balance / admin-usage / gateway)。
 * (glm-5.2)
 */
import { Icon } from './Icon'
import { useEffect, useState } from 'react'
import { CARD_SURFACE_CLASS } from './cardStyles'
import { ProviderIcon } from './ProviderIcon'
import { ProgressBar } from './motion'
import { fmtMoney, fmtCount } from '../../shared/utils/money'
import { extractCodingPlanQuotas, type CodingPlanQuota } from '../../shared/utils/minimax-quota'
import { extractKimiCodingQuotas, type KimiQuotaWindow } from '../../shared/utils/kimi-quota'
import type { ApiKeyRecord } from '../../shared/types/api-key'
import type { KeySpendSummary } from '../../shared/types/usage'
import type { BalanceSnapshot, ProviderManifest } from '../../shared/types/provider'

/** ApiKeyCard 组件的 props 类型定义 */
type ApiKeyCardProps = {
  keyRecord: ApiKeyRecord
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
  providerDisplayName: string
  onEdit: (k: ApiKeyRecord) => void
  onTest: (id: string, alias: string) => void
  onDelete: (k: ApiKeyRecord) => void
  onRefreshOne: (k: ApiKeyRecord) => void
  onToggleUsage: (id: string, enabled: boolean) => Promise<void>
}

type ApiKeyVisual = {
  accent: string
  tint: string
}

const DEFAULT_VISUAL: ApiKeyVisual = {
  accent: '#64748B',
  tint: 'rgba(100, 116, 139, 0.08)'
}

const API_KEY_VISUALS: Record<string, ApiKeyVisual> = {
  deepseek: { accent: '#4D6BFE', tint: 'rgba(77, 107, 254, 0.09)' },
  zhipu: { accent: '#635BFF', tint: 'rgba(99, 91, 255, 0.09)' },
  'kimi-coding': { accent: '#1783FF', tint: 'rgba(23, 131, 255, 0.09)' },
  longcat: { accent: '#22C55E', tint: 'rgba(34, 197, 94, 0.09)' },
  minimax: { accent: '#F43F5E', tint: 'rgba(244, 63, 94, 0.09)' },
  openrouter: { accent: '#111827', tint: 'rgba(17, 24, 39, 0.07)' },
  'newapi-generic': { accent: '#0EA5E9', tint: 'rgba(14, 165, 233, 0.09)' },
  'openai-admin': { accent: '#10A37F', tint: 'rgba(16, 163, 127, 0.09)' },
  'anthropic-admin': { accent: '#B2774A', tint: 'rgba(178, 119, 74, 0.09)' }
}

const CARD_PROFILE_META: Record<CardProfile, { label: string; icon: string }> = {
  'cash-balance': { label: 'API 余额', icon: 'fa-cloud' },
  'token-pack': { label: 'Token 资源包', icon: 'fa-cubes-stacked' },
  'coding-plan': { label: 'Coding Plan', icon: 'fa-code' },
  'kimi-coding-plan': { label: 'Coding Plan', icon: 'fa-code' },
  'admin-usage': { label: '组织用量', icon: 'fa-building' },
  gateway: { label: '聚合网关', icon: 'fa-server' }
}

// ponytail: single-key card. Mirrors BalanceQuery's grid card layout but adds
// the source pill in the Card `action` slot, the usage bar, and a per-row
// pill toggle for `usageQueryEnabled`. queryMode drives which manual controls
// are visible: `auto` hides test + manual-refresh, `manual` shows both.
//
// 单个 Key 卡片:复用余额查询的卡片布局,额外加入来源徽标、用量进度条与
// 每行的用量查询开关。queryMode 决定手动控制项的显隐(auto 隐藏测试与刷新,manual 显示)。 (glm-5.2)
export function ApiKeyCard({
  keyRecord,
  balance,
  providerDisplayName,
  onEdit,
  onTest,
  onDelete,
  onRefreshOne,
  onToggleUsage
}: ApiKeyCardProps) {
  const [toggling, setToggling] = useState(false)
  const usageEnabled = keyRecord.usageQueryEnabled !== false
  const isManual = keyRecord.queryMode === 'manual'
  const profile = getCardProfile(keyRecord, balance)
  const profileMeta = CARD_PROFILE_META[profile]
  const visual = API_KEY_VISUALS[keyRecord.providerId] ?? DEFAULT_VISUAL

  return (
    <article
      className={`${CARD_SURFACE_CLASS} motion-card motion-card-interactive group relative flex min-h-[320px] flex-col ${
        toggling ? 'motion-data-flash' : ''
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: visual.accent }} />
      <header className="relative bg-bg-base/30 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-border-light bg-bg-card/70">
              <ProviderIcon
                providerId={keyRecord.providerId}
                title={providerDisplayName}
                size={23}
                className="shrink-0"
              />
            </span>
            <div className="min-w-0">
              <h2
                className="truncate text-[14px] font-semibold text-text-primary"
                title={keyRecord.alias}
              >
                {keyRecord.alias}
              </h2>
              <p
                className="mt-0.5 truncate text-[12px] text-text-secondary"
                title={providerDisplayName}
              >
                {providerDisplayName}
                <span className="mx-1 text-text-muted">·</span>
                {keyRecord.providerId}
              </p>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => onEdit(keyRecord)}
            title="编辑 Key"
            aria-label={`编辑 ${keyRecord.alias}`}
          >
            <Icon name="fa-pen-to-square" />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
            style={{ color: visual.accent, backgroundColor: visual.tint, borderColor: visual.tint }}
          >
            <Icon name={profileMeta.icon} className="text-[10px]" />
            {profileMeta.label}
          </span>
          <SourceBadge source={keyRecord.source} />
          <span className="inline-flex items-center gap-1 rounded-full border border-border-light bg-bg-card/70 px-2.5 py-1 font-mono text-[11px] text-text-muted">
            <Icon name="fa-key" className="text-[9px]" />…{keyRecord.keyTail}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              usageEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-neutral-200 bg-neutral-100 text-neutral-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${usageEnabled ? 'bg-emerald-500' : 'bg-neutral-400'}`}
            />
            用量查询 {usageEnabled ? '开启' : '关闭'}
          </span>
        </div>
      </header>

      <div className="flex flex-1 flex-col px-5 pb-5">
        <div className="flex-1 space-y-2 pt-1 text-[13px]">
          {profile === 'coding-plan' && <CodingPlanQuotaBlock balance={balance} />}
          {profile === 'kimi-coding-plan' && <KimiCodingPlanQuotaBlock balance={balance} />}
          {profile === 'token-pack' && <TokenPackBalanceBlock balance={balance} />}
          {profile === 'cash-balance' && <CashBalanceBlock balance={balance} />}
          {profile === 'admin-usage' && <AdminUsageBlock balance={balance} keyRecord={keyRecord} />}
          {profile === 'gateway' && <GatewayBalanceBlock balance={balance} keyRecord={keyRecord} />}

          <KeySpendLine keyRecord={keyRecord} compact={profile === 'cash-balance'} />

          <CreatedAtLine createdAt={keyRecord.createdAt} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border-light pt-3">
          <UsageToggle
            enabled={usageEnabled}
            disabled={toggling}
            onToggle={async (next) => {
              setToggling(true)
              try {
                await onToggleUsage(keyRecord.id, next)
              } finally {
                setToggling(false)
              }
            }}
          />
          <div className="flex items-center gap-1">
            {isManual && (
              <>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => onRefreshOne(keyRecord)}
                  title="手动刷新余额"
                >
                  <Icon name="fa-arrows-rotate" />
                </button>
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => onTest(keyRecord.id, keyRecord.alias)}
                  title="测试连接"
                >
                  <Icon name="fa-plug" />
                </button>
              </>
            )}
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => onDelete(keyRecord)}
              title="删除"
            >
              <Icon name="fa-trash-can" className="text-red" />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

/** 卡片展示形态:决定渲染哪一种余额块 */
type CardProfile =
  'cash-balance' | 'token-pack' | 'coding-plan' | 'kimi-coding-plan' | 'admin-usage' | 'gateway'

/**
 * 根据 providerId 与余额信息推断卡片应使用的展示形态。
 * @param keyRecord 当前 Key 记录
 * @param balance 余额快照
 * @returns 卡片形态类型
 */
function getCardProfile(
  keyRecord: ApiKeyRecord,
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
): CardProfile {
  if (keyRecord.providerId === 'minimax') return 'coding-plan'
  if (keyRecord.providerId === 'kimi-coding') return 'kimi-coding-plan'
  if (keyRecord.providerId === 'longcat' && balance?.currency === 'TOKENS') return 'token-pack'
  if (keyRecord.providerId === 'openai-admin' || keyRecord.providerId === 'anthropic-admin') {
    return 'admin-usage'
  }
  if (keyRecord.providerId === 'newapi-generic' || keyRecord.providerId === 'openrouter') {
    return 'gateway'
  }
  return 'cash-balance'
}

/** 现金余额展示块:仅展示剩余余额 */
function CashBalanceBlock({
  balance
}: {
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
}) {
  return (
    <div className="space-y-1 rounded-md border border-border-light bg-bg-base/40 px-2.5 py-2">
      <InfoRow
        label="余额"
        value={
          balance?.remaining !== undefined
            ? fmtMoney(balance.remaining, balance.currency ?? 'CNY')
            : '—'
        }
        strong
      />
    </div>
  )
}

/** Admin Usage 展示块:展示 OpenAI/Anthropic Admin API 的本期已用与 Key 末位 */
function AdminUsageBlock({
  balance,
  keyRecord
}: {
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
  keyRecord: ApiKeyRecord
}) {
  return (
    <div className="space-y-1 rounded-md border border-border-light bg-bg-base/40 px-2.5 py-2">
      <InfoRow label="获取方式" value="Admin Usage API" />
      <InfoRow
        label="本期已用"
        value={
          balance?.used !== undefined ? fmtMoney(balance.used, balance.currency ?? 'USD') : '—'
        }
        strong
      />
      <InfoRow label="Key 末位" value={`…${keyRecord.keyTail}`} mono />
      {keyRecord.baseUrlOverride && (
        <InfoRow label="Base URL" value={keyRecord.baseUrlOverride} mono />
      )}
    </div>
  )
}

/** 网关余额展示块:展示 NewAPI/OpenRouter 等网关的余额、已用与使用率进度条 */
function GatewayBalanceBlock({
  balance,
  keyRecord
}: {
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
  keyRecord: ApiKeyRecord
}) {
  return (
    <div className="space-y-1 rounded-md border border-border-light bg-bg-base/40 px-2.5 py-2">
      <InfoRow
        label={keyRecord.providerId === 'newapi-generic' ? '网关余额' : '额度余额'}
        value={
          balance?.remaining !== undefined
            ? fmtMoney(balance.remaining, balance.currency ?? 'USD')
            : '—'
        }
        strong
      />
      <InfoRow
        label="已用"
        value={
          balance?.used !== undefined ? fmtMoney(balance.used, balance.currency ?? 'USD') : '—'
        }
      />
      {keyRecord.baseUrlOverride && (
        <InfoRow label="Base URL" value={keyRecord.baseUrlOverride} mono />
      )}
      <UsageBar remaining={balance?.remaining} total={balance?.total} />
    </div>
  )
}

/** Token 资源包展示块:展示 LongCat Cookie 模式的 Token 剩余/已用/总量及进度条 */
function TokenPackBalanceBlock({
  balance
}: {
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
}) {
  return (
    <>
      <div className="flex justify-between">
        <span className="text-text-muted">Token 剩余</span>
        <span className="font-mono font-medium">
          {balance?.remaining !== undefined ? fmtCount(balance.remaining) : '—'}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-text-muted">Token 已用</span>
        <span className="font-mono">
          {balance?.used !== undefined ? fmtCount(balance.used) : '—'}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-text-muted">Token 总量</span>
        <span className="font-mono">
          {balance?.total !== undefined ? fmtCount(balance.total) : '—'}
        </span>
      </div>
      <UsageBar remaining={balance?.remaining} total={balance?.total} />
      <p className="text-[11px] text-text-muted leading-snug">
        来自 LongCat 平台 Cookie 模式的 Token 资源包快照
      </p>
    </>
  )
}

/** MiniMax Coding Plan 配额展示块:展示 5h 与周限额的已用百分比与剩余/重置信息 */
function CodingPlanQuotaBlock({
  balance
}: {
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
}) {
  const quotas = extractCodingPlanQuotas(balance?.raw)

  return (
    <div className="space-y-2">
      <CodingPlanQuotaRow label="5h 限额" quota={quotas.shortWindow} />
      <CodingPlanQuotaRow label="周限额" quota={quotas.weeklyWindow} />
    </div>
  )
}

function KimiCodingPlanQuotaBlock({
  balance
}: {
  balance: (BalanceSnapshot & { id: number; apiKeyId?: string }) | undefined
}) {
  const quotas = extractKimiCodingQuotas(balance?.raw)
  return (
    <div className="space-y-2">
      <KimiCodingQuotaRow label="7 天套餐" quota={quotas.weeklyWindow} />
      <KimiCodingQuotaRow label={quotas.rateWindow?.label ?? '短周期'} quota={quotas.rateWindow} />
    </div>
  )
}

function KimiCodingQuotaRow({ label, quota }: { label: string; quota: KimiQuotaWindow | null }) {
  const pct = quota?.usedPercent
  const hasPct = typeof pct === 'number' && Number.isFinite(pct)
  const width = hasPct ? Math.max(0, Math.min(100, pct)) : 100
  const tone = hasPct && pct >= 90 ? 'red' : 'amber'
  return (
    <div className="space-y-1 rounded-md border border-border-light bg-bg-base/40 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-text-muted text-[12px]">{label}</span>
        <span className="font-mono text-[12px] text-text-primary text-right">
          {quota?.remainingText ?? '暂无自动读取'}
        </span>
      </div>
      <ProgressBar
        value={width / 100}
        label={`${label}已用比例`}
        tone={tone}
        trackClassName="h-1.5 bg-bg-hover"
        fillClassName={!hasPct ? 'bg-neutral-200' : ''}
      />
      <div className="flex justify-between gap-3 text-[11px] text-text-muted leading-snug">
        <span>{quota?.resetText ?? 'Kimi Coding Plan 套餐限额'}</span>
        {hasPct && <span className="font-mono">已用 {pct.toFixed(0)}%</span>}
      </div>
    </div>
  )
}

/** 创建时间行 */
function CreatedAtLine({ createdAt }: { createdAt: string }) {
  return (
    <div className="flex justify-between text-[12px]">
      <span className="text-text-muted">创建时间</span>
      <span className="text-text-secondary">{createdAt.slice(0, 16).replace('T', ' ')}</span>
    </div>
  )
}

/** 信息行:左右排列的标签-值组件,支持加粗与等宽字体 */
function InfoRow({
  label,
  value,
  strong,
  mono
}: {
  label: string
  value: string
  strong?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span
        className={`${mono ? 'font-mono' : ''} ${strong ? 'font-medium text-text-primary' : 'text-text-secondary'} text-right truncate`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

/** Coding Plan 单行限额展示:含数值、进度条与重置说明 */
function CodingPlanQuotaRow({ label, quota }: { label: string; quota: CodingPlanQuota | null }) {
  const pct = quota?.usedPercent
  const hasPct = typeof pct === 'number' && Number.isFinite(pct)
  const width = hasPct ? Math.max(0, Math.min(100, pct)) : 100
  const tone = hasPct && pct >= 90 ? 'red' : 'amber'
  const value = quota?.remainingText ?? quota?.usedText ?? '暂未自动读取'
  const detail = quota?.resetText ?? 'MiniMax Coding Plan 控制台限额'

  return (
    <div className="rounded border border-border-light bg-bg-base/40 px-2 py-1.5 space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-text-muted text-[12px]">{label}</span>
        <span className="font-mono text-[12px] text-text-primary text-right">{value}</span>
      </div>
      <ProgressBar
        value={width / 100}
        label={`${label}已用比例`}
        tone={tone}
        trackClassName="h-1.5 bg-bg-hover"
        fillClassName={!hasPct ? 'bg-neutral-200' : ''}
      />
      <div className="flex justify-between gap-3 text-[11px] text-text-muted leading-snug">
        <span>{detail}</span>
        {hasPct && <span className="font-mono">已用 {pct.toFixed(0)}%</span>}
      </div>
    </div>
  )
}

// ponytail: SourceBadge shape matches the legacy table pill so existing users
// don't see a new visual identity for `manual` / `api-key` / `session-log`.
//
// 来源徽标:沿用旧版表格徽标样式,按来源(manual/api-key/session-log)显示不同颜色。 (glm-5.2)
function SourceBadge({ source }: { source: ApiKeyRecord['source'] }) {
  const cls =
    source === 'manual'
      ? 'bg-blue-100 text-blue-700'
      : source === 'session-log'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-neutral-100 text-neutral-600'
  const label = source === 'api-key' ? 'manual' : source
  return (
    <span className={`inline-block px-2 py-[2px] rounded text-[11.5px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

// ponytail: 4-state bar driven by remaining/total ratio per PRD:
//   >= 90% remaining -> green (healthy)
//   70% <= ratio < 90% -> amber (running low)
//   ratio < 70% -> red (critical)
//   no total or invalid numbers -> neutral 100% placeholder
// We divide remaining by total, so a "high bar" means "lots left".
//
// 用量进度条:依据 remaining/total 比值显示四种状态(绿/琥珀/红/中性占位)。 (glm-5.2)
function UsageBar({
  remaining,
  total
}: {
  remaining: number | undefined
  total: number | undefined
}) {
  let pct: number | null = null
  if (
    typeof remaining === 'number' &&
    typeof total === 'number' &&
    total > 0 &&
    Number.isFinite(remaining) &&
    Number.isFinite(total)
  ) {
    pct = Math.max(0, Math.min(100, (remaining / total) * 100))
  }
  const showPlaceholder = pct === null
  const width = showPlaceholder ? 100 : pct!
  const tone = pct !== null && pct >= 90 ? 'accent' : pct !== null && pct >= 70 ? 'amber' : 'red'
  return (
    <div className="pt-1" title={showPlaceholder ? '暂无总额数据' : `剩余 ${pct!.toFixed(1)}%`}>
      <ProgressBar
        value={width / 100}
        label={showPlaceholder ? '暂无总额数据' : `剩余额度 ${pct!.toFixed(1)}%`}
        tone={tone}
        trackClassName="h-1.5 bg-bg-hover"
        fillClassName={showPlaceholder ? 'bg-neutral-200' : ''}
      />
    </div>
  )
}

// ponytail: pill-shaped inline switch. No new component lib — Tailwind
// classes only. Active = green, inactive = neutral; disabled shows busy state.
//
// 用量查询开关:胶囊式开关,启用为绿色、关闭为中性色,禁用时表示切换中。 (glm-5.2)
function UsageToggle({
  enabled,
  disabled,
  onToggle
}: {
  enabled: boolean
  disabled: boolean
  onToggle: (next: boolean) => void | Promise<void>
}) {
  return (
    <button
      type="button"
      onClick={() => void onToggle(!enabled)}
      disabled={disabled}
      title={enabled ? '点击关闭用量查询' : '点击开启用量查询'}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
        enabled
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
          : 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
      }`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          enabled ? 'bg-emerald-500' : 'bg-neutral-400'
        }`}
      />
      用量查询:{enabled ? ' 开' : ' 关'}
    </button>
  )
}

// ponytail: tiny helper to look up displayName with a safe fallback.
//
// 辅助函数:在 manifest 列表中查找 provider 的展示名,未找到时回退为 providerId。 (glm-5.2)
export function providerLabel(providerId: string, manifests: ProviderManifest[]): string {
  const m = manifests.find((p) => p.id === providerId)
  return m?.displayName ?? providerId
}

/**
 * "消费估算" line that sits between the balance rows and the "创建时间" row
 * on each key card. Fetches `usage.getKeySpend` once on mount and whenever
 * `keyRecord` changes; renders the rolled-up cost in the primary currency
 * plus a small diagnostic line ("12 条已计费 · 2 条未定价") so the user can
 * tell at a glance whether their pricing config is missing rows.
 *
 * Three states: loading (-), priced (¥xx.xx), no usage (¥0.00).
 *
 * 消费估算行:挂载或 keyRecord 变化时拉取近 30 天消费汇总并展示金额与诊断信息。
 * 包含加载中、已计价、无用量三种状态。 (glm-5.2)
 */
function KeySpendLine({
  keyRecord,
  compact = false
}: {
  keyRecord: ApiKeyRecord
  compact?: boolean
}) {
  const [spend, setSpend] = useState<KeySpendSummary | null>(null)

  useEffect(() => {
    let alive = true
    setSpend(null)
    window.api.usage
      .getKeySpend(keyRecord.id, 30)
      .then((r) => {
        if (alive) setSpend(r)
      })
      .catch(() => {
        // Silent — the rest of the card still works. Diagnostics show in dev.
      })
    return () => {
      alive = false
    }
  }, [keyRecord.id])

  if (!spend) {
    return (
      <div className="flex justify-between">
        <span className="text-text-muted">{compact ? '消费' : '消费估算 (30 天)'}</span>
        <span className="font-mono text-text-muted">—</span>
      </div>
    )
  }

  const amount = fmtMoney(spend.total, spend.currency)
  const sub =
    spend.totalRequests === 0
      ? '近 30 天无用量记录'
      : `${fmtCount(spend.pricedRequests)} 条已计费 · ${fmtCount(spend.unpricedRequests)} 条未定价`

  return (
    <div className="space-y-0.5 rounded-md border border-border-light bg-bg-base/40 px-2.5 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-text-muted text-[12px]">{compact ? '消费' : '消费估算 (30 天)'}</span>
        <span className="font-mono font-medium text-text-primary">{amount}</span>
      </div>
      <p className="text-[11px] text-text-muted leading-snug">{sub}</p>
    </div>
  )
}
