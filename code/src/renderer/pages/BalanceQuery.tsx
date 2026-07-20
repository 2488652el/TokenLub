/**
 * 余额查询页面：按凭据用途展示余额、套餐额度或组织用量。
 * 不同供应商沿用统一卡片骨架，但拥有独立品牌色和信息重点。
 */
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { ProviderIcon } from '../components/ProviderIcon'
import { CodexQuotaPanel } from '../components/CodexQuotaPanel'
import { AnimatedNumber, MotionGroup, ProgressBar } from '../components/motion'
import { useCodexUsage } from '../hooks/useCodexUsage'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import { getCatalogEntry } from '../../shared/provider-catalog'
import {
  getBalanceCardProfile,
  type BalanceCardProfile
} from '../../shared/utils/balance-card-profile'
import { extractCodingPlanQuotas, type CodingPlanQuota } from '../../shared/utils/minimax-quota'
import { extractKimiCodingQuotas, type KimiQuotaWindow } from '../../shared/utils/kimi-quota'
import type { ApiKeyRecord } from '../../shared/types/api-key'
import type { BalanceSnapshot } from '../../shared/types/provider'

type StoredBalance = BalanceSnapshot & { id: number; apiKeyId?: string }

type BalanceCard = {
  key: ApiKeyRecord
  balance: StoredBalance | undefined
}

type ProviderTheme = {
  accent: string
  tint: string
}

const DEFAULT_THEME: ProviderTheme = {
  accent: '#64748B',
  tint: 'rgba(100, 116, 139, 0.08)'
}

const PROVIDER_THEMES: Record<string, ProviderTheme> = {
  deepseek: { accent: '#4D6BFE', tint: 'rgba(77, 107, 254, 0.09)' },
  zhipu: { accent: '#635BFF', tint: 'rgba(99, 91, 255, 0.09)' },
  moonshot: { accent: '#111827', tint: 'rgba(17, 24, 39, 0.07)' },
  'kimi-coding': { accent: '#1783FF', tint: 'rgba(23, 131, 255, 0.09)' },
  longcat: { accent: '#22C55E', tint: 'rgba(34, 197, 94, 0.09)' },
  minimax: { accent: '#F43F5E', tint: 'rgba(244, 63, 94, 0.09)' },
  siliconflow: { accent: '#14B8A6', tint: 'rgba(20, 184, 166, 0.09)' },
  openrouter: { accent: '#111827', tint: 'rgba(17, 24, 39, 0.07)' },
  stepfun: { accent: '#8B5CF6', tint: 'rgba(139, 92, 246, 0.09)' },
  'newapi-generic': { accent: '#0EA5E9', tint: 'rgba(14, 165, 233, 0.09)' },
  'openai-admin': { accent: '#10A37F', tint: 'rgba(16, 163, 127, 0.09)' },
  'anthropic-admin': { accent: '#B2774A', tint: 'rgba(178, 119, 74, 0.09)' }
}

const PROFILE_META: Record<BalanceCardProfile, { label: string; icon: string }> = {
  'api-balance': { label: 'API 余额', icon: 'fa-cloud' },
  'coding-plan': { label: 'Coding Plan', icon: 'fa-code' },
  'token-pack': { label: 'Token 资源包', icon: 'fa-cubes-stacked' },
  'admin-usage': { label: '组织用量', icon: 'fa-building' },
  gateway: { label: '聚合网关', icon: 'fa-server' },
  manual: { label: '手动额度', icon: 'fa-pen-to-square' }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatBalanceAmount(
  value: number | undefined,
  currency: string | undefined,
  fallback = '—'
): string {
  if (!isFiniteNumber(value)) return fallback
  if (currency === 'TOKENS') return fmtCount(value)
  if (currency === 'PERCENT') return `${Math.round(value)}%`
  return fmtMoney(value, currency ?? 'CNY')
}

function formatSnapshotTime(value: string | undefined): string {
  if (!value) return '尚未同步'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace('T', ' ')
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function percentage(remaining: number | undefined, total: number | undefined): number | null {
  if (!isFiniteNumber(remaining) || !isFiniteNumber(total) || total <= 0) return null
  return Math.max(0, Math.min(100, (remaining / total) * 100))
}

export default function BalanceQuery() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [balances, setBalances] = useState<StoredBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const codex = useCodexUsage()
  const reducedMotion = useReducedMotion()

  async function load() {
    setLoading(true)
    try {
      const [keyRows, balanceRows] = await Promise.all([
        window.api.keys.list(),
        window.api.balance.latest().catch(() => [])
      ])
      setKeys(keyRows)
      setBalances(balanceRows)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleRefreshAll() {
    setRefreshing(true)
    try {
      const result = await window.api.usage.refreshAll()
      const failures = Array.isArray(result.failures) ? result.failures : []
      if (result.failed === 0) {
        window.alert(`刷新完成：成功 ${result.refreshed} 个 Key`)
      } else {
        const lines = failures
          .slice(0, 20)
          .map(
            (failure) =>
              `  • ${failure.alias} (${failure.providerId}): ${
                failure.error.length > 100 ? `${failure.error.slice(0, 100)}…` : failure.error
              }`
          )
        if (failures.length > 20) lines.push(`  …（还有 ${failures.length - 20} 条未显示）`)
        window.alert(
          `刷新完成：\n✓ 成功 ${result.refreshed} 个\n✕ 失败 ${result.failed} 个\n${lines.join('\n')}`
        )
      }
      await load()
      await codex.refresh()
    } catch (error) {
      window.alert(`刷新失败：${(error as Error).message}`)
    } finally {
      setRefreshing(false)
    }
  }

  const cards = useMemo<BalanceCard[]>(() => {
    const latestByKey = new Map<string, StoredBalance>()
    for (const balance of balances) {
      if (!balance.apiKeyId) continue
      const previous = latestByKey.get(balance.apiKeyId)
      if (!previous || Date.parse(balance.capturedAt) > Date.parse(previous.capturedAt)) {
        latestByKey.set(balance.apiKeyId, balance)
      }
    }
    return keys.map((key) => ({ key, balance: latestByKey.get(key.id) }))
  }, [keys, balances])

  return (
    <div className="page-content">
      <PageHeader
        title="余额查询"
        desc="区分 API 余额、Coding Plan 与 Token 套餐，按供应商展示关键额度"
        action={
          <button
            className="btn btn-outline btn-sm"
            onClick={handleRefreshAll}
            disabled={refreshing}
          >
            <i
              className={`fa-solid fa-arrows-rotate ${
                refreshing && !reducedMotion ? 'animate-spin' : ''
              }`}
            />
            {refreshing ? '刷新中' : '全部刷新'}
          </button>
        }
      />

      <MotionGroup className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <article
          className={`motion-card-interactive group relative flex min-h-[280px] flex-col overflow-hidden rounded-xl border border-border-light bg-bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
            codex.loading && !reducedMotion ? 'motion-data-flash' : ''
          }`}
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-[#10A37F]" />
          <header className="flex items-start justify-between gap-4 bg-[linear-gradient(135deg,rgba(16,163,127,0.1),transparent_62%)] px-5 pb-4 pt-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-[rgba(16,163,127,0.1)]">
                <ProviderIcon providerId="openai-admin" title="ChatGPT" size={23} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold text-text-primary">ChatGPT</h2>
                <p className="mt-0.5 text-[12px] text-text-secondary">Codex 订阅额度</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <i className="fa-solid fa-bolt text-[9px]" />
                订阅计划
              </span>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => void codex.refresh()}
                disabled={codex.loading}
                title="刷新 ChatGPT 额度"
              >
                <i
                  className={`fa-solid fa-arrows-rotate ${
                    codex.loading && !reducedMotion ? 'animate-spin' : ''
                  }`}
                />
              </button>
            </div>
          </header>
          <div className="flex flex-1 flex-col px-5 pb-5">
            <CodexQuotaPanel usage={codex.usage} loading={codex.loading} error={codex.error} />
          </div>
        </article>

        {loading ? (
          <Card>
            <EmptyState icon="fa-spinner" title="加载中…" hint="读取本地加密数据库" />
          </Card>
        ) : keys.length === 0 ? (
          <Card>
            <EmptyState icon="fa-wallet" title="尚未添加任何 Key" hint="前往 API Keys 添加" />
          </Card>
        ) : (
          cards.map(({ key, balance }) => (
            <ProviderBalanceCard key={key.id} keyRecord={key} balance={balance} />
          ))
        )}
      </MotionGroup>
    </div>
  )
}

function ProviderBalanceCard({
  keyRecord,
  balance
}: {
  keyRecord: ApiKeyRecord
  balance: StoredBalance | undefined
}) {
  const profile = getBalanceCardProfile(keyRecord)
  const profileMeta = PROFILE_META[profile]
  const catalog = getCatalogEntry(keyRecord.providerId)
  const theme = PROVIDER_THEMES[keyRecord.providerId] ?? DEFAULT_THEME
  const providerName = catalog?.displayName ?? keyRecord.providerId

  return (
    <article className="motion-card-interactive group relative flex min-h-[280px] flex-col overflow-hidden rounded-xl border border-border-light bg-bg-card">
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: theme.accent }} />
      <header
        className="flex items-start justify-between gap-4 px-5 pb-4 pt-5"
        style={{ background: `linear-gradient(135deg, ${theme.tint}, transparent 58%)` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
            style={{ backgroundColor: theme.tint }}
          >
            <ProviderIcon
              providerId={keyRecord.providerId}
              title={providerName}
              size={22}
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
            <p className="mt-0.5 truncate text-[12px] text-text-secondary" title={providerName}>
              {providerName}
            </p>
          </div>
        </div>
        <span
          className="inline-flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
          style={{
            color: theme.accent,
            backgroundColor: theme.tint,
            borderColor: theme.tint
          }}
        >
          <i className={`fa-solid ${profileMeta.icon} text-[10px]`} />
          {profileMeta.label}
        </span>
      </header>

      <div className="flex flex-1 flex-col px-5 pb-4">
        <div className="flex-1">
          <BalancePanel profile={profile} keyRecord={keyRecord} balance={balance} theme={theme} />
        </div>
        <footer className="mt-4 flex items-center justify-between gap-3 border-t border-border-light pt-3 text-[11.5px] text-text-muted">
          <span className="inline-flex items-center gap-1.5 font-mono">
            <i className="fa-solid fa-key text-[10px]" />
            ••••{keyRecord.keyTail}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="fa-regular fa-clock text-[10px]" />
            {formatSnapshotTime(balance?.capturedAt)}
          </span>
        </footer>
      </div>
    </article>
  )
}

function BalancePanel({
  profile,
  keyRecord,
  balance,
  theme
}: {
  profile: BalanceCardProfile
  keyRecord: ApiKeyRecord
  balance: StoredBalance | undefined
  theme: ProviderTheme
}) {
  switch (profile) {
    case 'coding-plan':
      return <CodingPlanPanel keyRecord={keyRecord} balance={balance} theme={theme} />
    case 'token-pack':
      return <TokenPackPanel balance={balance} theme={theme} />
    case 'admin-usage':
      return <AdminUsagePanel balance={balance} theme={theme} />
    case 'gateway':
      return <ApiBalancePanel balance={balance} theme={theme} gateway />
    case 'manual':
      return <ManualBalancePanel balance={balance} theme={theme} />
    default:
      return <ApiBalancePanel balance={balance} theme={theme} />
  }
}

function ApiBalancePanel({
  balance,
  theme,
  gateway = false
}: {
  balance: StoredBalance | undefined
  theme: ProviderTheme
  gateway?: boolean
}) {
  if (!balance || !isFiniteNumber(balance.remaining)) {
    const probeOnly = asRecord(balance?.raw)?._probeOnly === true
    return (
      <BalanceUnavailable
        icon={probeOnly ? 'fa-circle-check' : 'fa-wallet'}
        title={probeOnly ? 'Key 已验证' : '暂无余额数据'}
        detail={
          probeOnly ? '供应商余额接口暂不可用，连接验证正常' : '点击“全部刷新”获取最新 API 账户余额'
        }
        theme={theme}
      />
    )
  }

  const total = isFiniteNumber(balance.total) ? balance.total : undefined
  const used = isFiniteNumber(balance.used)
    ? balance.used
    : total !== undefined
      ? Math.max(0, total - balance.remaining)
      : undefined
  const remainingPercent = percentage(balance.remaining, total)

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center gap-2 text-[12px] text-text-muted">
          <span>{gateway ? '网关可用额度' : '账户可用余额'}</span>
          {balance.currency ? (
            <span className="rounded bg-bg-hover px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
              {balance.currency}
            </span>
          ) : null}
        </div>
        <div className="font-mono text-[26px] font-semibold tracking-tight text-text-primary">
          {formatBalanceAmount(balance.remaining, balance.currency)}
        </div>
      </div>

      {remainingPercent !== null ? (
        <UsageProgress
          value={remainingPercent}
          label="余额占比"
          valueLabel={`剩余 ${remainingPercent.toFixed(0)}%`}
          color={theme.accent}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <MetricTile
          label="已使用"
          value={formatBalanceAmount(used, balance.currency)}
          icon="fa-arrow-trend-up"
        />
        <MetricTile
          label="账户总额"
          value={formatBalanceAmount(total, balance.currency)}
          icon="fa-chart-pie"
        />
      </div>
    </div>
  )
}

function CodingPlanPanel({
  keyRecord,
  balance,
  theme
}: {
  keyRecord: ApiKeyRecord
  balance: StoredBalance | undefined
  theme: ProviderTheme
}) {
  if (keyRecord.providerId === 'kimi-coding') {
    const quotas = extractKimiCodingQuotas(balance?.raw)
    const fallbackUsed = isFiniteNumber(balance?.used)
      ? balance.used
      : isFiniteNumber(balance?.remaining)
        ? 100 - balance.remaining
        : undefined
    return (
      <div className="space-y-3">
        <QuotaMeter
          label="7 天套餐"
          quota={quotas.weeklyWindow}
          fallbackUsedPercent={fallbackUsed}
          color={theme.accent}
        />
        <QuotaMeter
          label={quotas.rateWindow?.label ?? '短周期限额'}
          quota={quotas.rateWindow}
          color={theme.accent}
        />
      </div>
    )
  }

  if (keyRecord.providerId === 'minimax') {
    const quotas = extractCodingPlanQuotas(balance?.raw)
    return (
      <div className="space-y-3">
        <CodingQuotaMeter label="5 小时限额" quota={quotas.shortWindow} color={theme.accent} />
        <CodingQuotaMeter label="周限额" quota={quotas.weeklyWindow} color={theme.accent} />
      </div>
    )
  }

  return (
    <BalanceUnavailable
      icon="fa-code"
      title="Coding Plan Key"
      detail="已识别为套餐凭据；当前供应商未提供稳定的套餐额度接口"
      theme={theme}
    />
  )
}

function TokenPackPanel({
  balance,
  theme
}: {
  balance: StoredBalance | undefined
  theme: ProviderTheme
}) {
  if (!balance || !isFiniteNumber(balance.remaining)) {
    return (
      <BalanceUnavailable
        icon="fa-cookie-bite"
        title="暂无资源包快照"
        detail="配置平台 Cookie 后，可读取 Token 资源包余额"
        theme={theme}
      />
    )
  }

  const remainingPercent = percentage(balance.remaining, balance.total)
  const raw = asRecord(balance.raw)
  const estimate = asRecord(raw?.estimate)
  const exhaustedAfterDays = estimate?.exhaustedAfterDays
  const dailyAverageToken = estimate?.dailyAverageToken

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[12px] text-text-muted">可用 Token</div>
        <div className="font-mono text-[26px] font-semibold tracking-tight text-text-primary">
          {fmtCount(balance.remaining)}
        </div>
      </div>
      {remainingPercent !== null ? (
        <UsageProgress
          value={remainingPercent}
          label="资源包余额"
          valueLabel={`剩余 ${remainingPercent.toFixed(0)}%`}
          color={theme.accent}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile
          label="已消耗"
          value={formatBalanceAmount(balance.used, 'TOKENS')}
          icon="fa-bolt"
        />
        <MetricTile
          label="总量"
          value={formatBalanceAmount(balance.total, 'TOKENS')}
          icon="fa-box"
        />
      </div>
      {isFiniteNumber(exhaustedAfterDays) || isFiniteNumber(dailyAverageToken) ? (
        <div
          className="rounded-md px-3 py-2 text-[11.5px] text-text-secondary"
          style={{ backgroundColor: theme.tint }}
        >
          {isFiniteNumber(exhaustedAfterDays) ? `预计可用 ${exhaustedAfterDays.toFixed(1)} 天` : ''}
          {isFiniteNumber(exhaustedAfterDays) && isFiniteNumber(dailyAverageToken) ? ' · ' : ''}
          {isFiniteNumber(dailyAverageToken) ? `日均 ${fmtCount(dailyAverageToken)} Tokens` : ''}
        </div>
      ) : null}
    </div>
  )
}

function AdminUsagePanel({
  balance,
  theme
}: {
  balance: StoredBalance | undefined
  theme: ProviderTheme
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-[12px] text-text-muted">组织本期消费</div>
        <div className="font-mono text-[26px] font-semibold tracking-tight text-text-primary">
          {formatBalanceAmount(balance?.used, balance?.currency ?? 'USD')}
        </div>
      </div>
      <div
        className="flex items-start gap-2 rounded-md px-3 py-2.5"
        style={{ backgroundColor: theme.tint }}
      >
        <i
          className="fa-solid fa-shield-halved mt-0.5 text-[12px]"
          style={{ color: theme.accent }}
        />
        <div>
          <div className="text-[12px] font-medium text-text-primary">Admin Usage API</div>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">
            使用组织管理员权限汇总消费，不等同于普通 API Key 余额
          </p>
        </div>
      </div>
    </div>
  )
}

function ManualBalancePanel({
  balance,
  theme
}: {
  balance: StoredBalance | undefined
  theme: ProviderTheme
}) {
  if (!balance || !isFiniteNumber(balance.remaining)) {
    return (
      <BalanceUnavailable
        icon="fa-pen-to-square"
        title="需要手动维护"
        detail="该供应商没有公开余额接口，可在 API Keys 中录入额度"
        theme={theme}
      />
    )
  }
  return (
    <div className="space-y-3">
      <div className="text-[12px] text-text-muted">手动记录余额</div>
      <div className="font-mono text-[26px] font-semibold text-text-primary">
        {formatBalanceAmount(balance.remaining, balance.currency)}
      </div>
      <p
        className="rounded-md px-3 py-2 text-[11.5px] text-text-secondary"
        style={{ backgroundColor: theme.tint }}
      >
        此数值不会自动同步，请按实际账户情况更新
      </p>
    </div>
  )
}

function QuotaMeter({
  label,
  quota,
  fallbackUsedPercent,
  color
}: {
  label: string
  quota: KimiQuotaWindow | null
  fallbackUsedPercent?: number | undefined
  color: string
}) {
  const usedPercent = quota?.usedPercent ?? fallbackUsedPercent
  return (
    <PlanQuotaRow
      label={label}
      usedPercent={usedPercent}
      remainingText={
        quota?.remainingText ??
        (isFiniteNumber(usedPercent)
          ? `剩余 ${Math.max(0, 100 - usedPercent).toFixed(0)}%`
          : '暂无数据')
      }
      resetText={quota?.resetText}
      color={color}
    />
  )
}

function CodingQuotaMeter({
  label,
  quota,
  color
}: {
  label: string
  quota: CodingPlanQuota | null
  color: string
}) {
  return (
    <PlanQuotaRow
      label={label}
      usedPercent={quota?.usedPercent}
      remainingText={quota?.remainingText ?? quota?.usedText ?? '暂无数据'}
      resetText={quota?.resetText}
      color={color}
    />
  )
}

function PlanQuotaRow({
  label,
  usedPercent,
  remainingText,
  resetText,
  color
}: {
  label: string
  usedPercent: number | undefined
  remainingText: string
  resetText?: string | undefined
  color: string
}) {
  const safeUsed = isFiniteNumber(usedPercent) ? Math.max(0, Math.min(100, usedPercent)) : null
  const tone = safeUsed !== null && safeUsed >= 90 ? 'red' : 'blue'
  return (
    <div className="rounded-lg border border-border-light bg-bg-base/50 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-text-secondary">{label}</span>
        <span className="font-mono text-[12px] font-medium text-text-primary">{remainingText}</span>
      </div>
      <ProgressBar
        value={(safeUsed ?? 0) / 100}
        label={`${label}已用比例`}
        tone={tone}
        trackClassName="h-2 bg-bg-hover"
        color={safeUsed !== null && safeUsed < 90 ? color : undefined}
      />
      <div className="mt-1.5 flex justify-between gap-3 text-[10.5px] text-text-muted">
        <span>{resetText ?? '按供应商周期自动重置'}</span>
        <span className="font-mono">
          {safeUsed === null ? (
            '—'
          ) : (
            <>
              已用 <AnimatedNumber value={safeUsed} format={(value) => `${value.toFixed(0)}%`} />
            </>
          )}
        </span>
      </div>
    </div>
  )
}

function UsageProgress({
  value,
  label,
  valueLabel,
  color
}: {
  value: number
  label: string
  valueLabel: string
  color: string
}) {
  const safeValue = Math.max(0, Math.min(100, value))
  const tone = safeValue <= 15 ? 'red' : safeValue <= 35 ? 'amber' : 'accent'
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
        <span className="text-text-muted">{label}</span>
        <span className="font-mono text-text-secondary">{valueLabel}</span>
      </div>
      <ProgressBar
        value={safeValue / 100}
        label={label}
        tone={tone}
        trackClassName="h-2 bg-bg-hover"
        color={safeValue > 35 ? color : undefined}
      />
    </div>
  )
}

function MetricTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-bg-base/50 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-text-muted">
        <i className={`fa-solid ${icon} text-[9px]`} />
        {label}
      </div>
      <div className="truncate font-mono text-[12.5px] font-medium text-text-primary" title={value}>
        {value}
      </div>
    </div>
  )
}

function BalanceUnavailable({
  icon,
  title,
  detail,
  theme
}: {
  icon: string
  title: string
  detail: string
  theme: ProviderTheme
}) {
  return (
    <div className="flex min-h-[138px] items-center gap-3 rounded-lg border border-dashed border-border px-4 py-4">
      <span
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
        style={{ backgroundColor: theme.tint, color: theme.accent }}
      >
        <i className={`fa-solid ${icon}`} />
      </span>
      <div>
        <div className="text-[13px] font-medium text-text-primary">{title}</div>
        <p className="mt-1 max-w-[320px] text-[11.5px] leading-relaxed text-text-muted">{detail}</p>
      </div>
    </div>
  )
}
