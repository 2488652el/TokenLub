/**
 * 用量告警页面:管理告警规则的增删改查与启停,
 * 支持按全局或指定供应商、按剩余金额或剩余百分比设置阈值。
 * (glm-5.2)
 */
import { Icon } from '../components/Icon'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { AnimatedNumber, ProgressBar } from '../components/motion'
import { fmtMoney } from '../../shared/utils/money'
import type { AlertRule, AlertMetric, AlertScope } from '../../shared/types/alert'
import type { ProviderManifest, BalanceSnapshot } from '../../shared/types/provider'
import { alertAddInputSchema } from '../../shared/ipc-schemas'
import { useReducedMotion } from '../hooks/useReducedMotion'

/** 告警指标到中文标签的映射 */
const METRIC_LABEL: Record<AlertMetric, string> = {
  remaining_amount: '剩余金额',
  remaining_pct: '剩余百分比'
}

// ponytail: inline relative-time helper. Keeps a stable interface so we can
// extract to money.ts later if more settings or alert views need it. Format is
// zh-CN friendly but ASCII-safe (no full-width chars) for tabular layouts.
//
// 相对时间格式化:将 ISO 时间转为"刚刚/N 分钟前/N 小时前"等中文友好文本。 (glm-5.2)
function formatRelative(iso: string | undefined): string {
  if (!iso) return '从未'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return iso.slice(0, 10)
}

/**
 * 用量告警页面组件。
 * 拉取告警规则、供应商与余额,渲染规则表格与新建规则弹窗。
 */
export default function UsageAlerts() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [providers, setProviders] = useState<ProviderManifest[]>([])
  const [balances, setBalances] = useState<
    Array<BalanceSnapshot & { id: number; apiKeyId?: string }>
  >([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const reducedMotion = useReducedMotion()

  /** 刷新告警规则、供应商与余额列表 */
  async function refresh() {
    setLoading(true)
    try {
      const [list, provs, bals] = await Promise.all([
        window.api.alerts.list(),
        window.api.providers.list(),
        window.api.balance.latest()
      ])
      setRules(list)
      setProviders(provs)
      setBalances(bals)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  /** 供应商 id 到显示名的映射 */
  const providerNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of providers) m.set(p.id, p.displayName)
    return m
  }, [providers])

  // ponytail: latest balance per providerId — for displaying "current vs threshold".
  // Multiple keys under the same provider all reference the same latest snapshot,
  // so we keep the most recent by capturedAt.
  // 按 providerId 保留最新一条余额快照,用于展示当前值与阈值对比。 (glm-5.2)
  const latestBalanceByProvider = useMemo(() => {
    const m = new Map<string, BalanceSnapshot & { id: number; apiKeyId?: string }>()
    for (const b of balances) {
      const prev = m.get(b.providerId)
      if (!prev || Date.parse(b.capturedAt) > Date.parse(prev.capturedAt)) {
        m.set(b.providerId, b)
      }
    }
    return m
  }, [balances])

  /** 获取规则对应的币种(优先取该供应商余额快照的币种,默认 USD) */
  function currencyFor(rule: AlertRule): string {
    if (rule.scope === 'provider' && rule.providerId) {
      const snap = latestBalanceByProvider.get(rule.providerId)
      if (snap?.currency) return snap.currency
    }
    return 'USD'
  }

  /** 格式化阈值:百分比指标显示 %,金额指标用 fmtMoney */
  function formatThreshold(rule: AlertRule): string {
    if (rule.metric === 'remaining_pct') return `${rule.threshold}%`
    return fmtMoney(rule.threshold, currencyFor(rule))
  }

  /** 打开新建规则弹窗 */
  function openCreate() {
    setModalOpen(true)
  }

  /** 切换规则启用状态(乐观更新,失败回滚) */
  async function handleToggle(rule: AlertRule) {
    const next = !rule.enabled
    // optimistic update; rollback on failure
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)))
    try {
      await window.api.alerts.toggle(rule.id, next)
    } catch (e) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !next } : r)))
      window.alert(`切换失败：${(e as Error).message}`)
    }
  }

  /** 删除规则(带确认弹窗) */
  async function handleDelete(rule: AlertRule) {
    const providerLabel =
      rule.scope === 'global'
        ? '全局'
        : (providerNameById.get(rule.providerId ?? '') ?? rule.providerId ?? '')
    if (
      !window.confirm(
        `确认删除 ${providerLabel} 的${METRIC_LABEL[rule.metric]}告警规则？\n此操作不可撤销。`
      )
    ) {
      return
    }
    const prev = rules
    setRules((p) => p.filter((r) => r.id !== rule.id))
    setBusy(true)
    try {
      await window.api.alerts.delete(rule.id)
    } catch (e) {
      setRules(prev)
      window.alert(`删除失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /** 保存新建规则:经 schema 校验后调用 alerts.add */
  async function handleSave(input: {
    scope: AlertScope
    providerId?: string
    metric: AlertMetric
    threshold: number
  }) {
    setBusy(true)
    try {
      const payload: {
        scope: AlertScope
        providerId?: string
        metric: AlertMetric
        threshold: number
      } = {
        scope: input.scope,
        threshold: input.threshold,
        metric: input.metric
      }
      if (input.scope === 'provider' && input.providerId) payload.providerId = input.providerId
      // ponytail: parse through the same schema the preload bridge uses, so
      // we get the same exactOptionalPropertyTypes narrowing (e.g. providerId
      // omitted when scope=global). Avoids duplicating Zod's optional-key logic.
      await window.api.alerts.add(alertAddInputSchema.parse(payload))
      setModalOpen(false)
      await refresh()
    } catch (e) {
      window.alert(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const showTable = !loading && rules.length > 0

  return (
    <div className="page-content">
      <PageHeader
        title="用量告警"
        desc="阈值规则触发时写入告警事件"
        action={
          <button
            className="btn btn-primary"
            onClick={openCreate}
            disabled={busy}
            title="新建告警规则"
          >
            <Icon name="fa-plus" /> 新建规则
          </button>
        }
      />

      {loading ? (
        <Card motion="status" className={busy ? 'motion-data-flash' : ''}>
          <EmptyState icon="fa-spinner" title="加载中…" hint="读取告警规则" />
        </Card>
      ) : !showTable ? (
        <Card>
          <EmptyState
            icon="fa-bell"
            title="尚未配置告警规则"
            hint="余额低于阈值时通过系统通知提醒"
            action={
              <button className="btn btn-primary btn-sm mt-2" onClick={openCreate} disabled={busy}>
                <Icon name="fa-plus" /> 创建第一条告警规则
              </button>
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Provider</th>
                  <th>指标</th>
                  <th>阈值</th>
                  <th>启用</th>
                  <th>最近触发</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody className="motion-table-rows">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <ScopeBadge scope={r.scope} />
                    </td>
                    <td className="text-[12.5px]">
                      {r.scope === 'provider' ? (
                        (providerNameById.get(r.providerId ?? '') ?? r.providerId ?? '—')
                      ) : (
                        <span className="text-text-muted">全部 Provider</span>
                      )}
                    </td>
                    <td className="text-[12.5px]">{METRIC_LABEL[r.metric]}</td>
                    <td className="mono text-[12.5px]">
                      <ThresholdCell rule={r} value={formatThreshold(r)} />
                    </td>
                    <td>
                      <Toggle
                        checked={r.enabled}
                        onChange={() => handleToggle(r)}
                        reducedMotion={reducedMotion}
                      />
                    </td>
                    <td className="text-secondary text-[12px]">
                      {formatRelative(r.lastTriggeredAt)}
                    </td>
                    <td className="text-secondary text-[12px]">
                      {r.createdAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => handleDelete(r)}
                        disabled={busy}
                        title="删除"
                      >
                        <Icon name="fa-trash-can" className="text-red" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pt-3 mt-2 border-t border-border-light text-[12px] text-text-muted">
            共 <AnimatedNumber value={rules.length} /> 条规则{busy && ' · 保存中…'}
          </div>
        </Card>
      )}

      {modalOpen && (
        <RuleModal providers={providers} onClose={() => setModalOpen(false)} onSave={handleSave} />
      )}
    </div>
  )
}

/** 作用域徽标:区分 global 与 provider */
function ScopeBadge({ scope }: { scope: AlertScope }) {
  const isGlobal = scope === 'global'
  const cls = isGlobal ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
  return (
    <span className={`inline-block px-2 py-[2px] rounded text-[11.5px] font-medium ${cls}`}>
      {isGlobal ? 'global' : 'provider'}
    </span>
  )
}

function ThresholdCell({ rule, value }: { rule: AlertRule; value: string }) {
  if (rule.metric !== 'remaining_pct') return <span>{value}</span>
  const threshold = Math.max(0, Math.min(100, rule.threshold))
  return (
    <div className="min-w-[78px]">
      <AnimatedNumber
        value={threshold}
        format={(next) => `${Number.isInteger(next) ? next.toFixed(0) : next.toFixed(1)}%`}
      />
      <ProgressBar
        value={threshold / 100}
        label="剩余百分比告警阈值"
        tone="amber"
        trackClassName="mt-1 h-1 w-16"
      />
    </div>
  )
}

/** 开关组件:可点击或键盘切换的 switch */
function Toggle({
  checked,
  onChange,
  reducedMotion
}: {
  checked: boolean
  onChange: () => void
  reducedMotion: boolean
}) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange()
        }
      }}
      tabIndex={0}
      className={`relative inline-block w-9 h-5 rounded-full cursor-pointer ${
        !reducedMotion ? 'transition-colors' : ''
      } ${checked ? 'bg-accent' : 'bg-border'}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-4 h-4 bg-white rounded-full shadow ${
          !reducedMotion ? 'transition-transform' : ''
        } ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </span>
  )
}

/**
 * 新建告警规则弹窗。
 * @param providers 供应商列表
 * @param onClose 关闭回调
 * @param onSave 保存回调
 */
function RuleModal({
  providers,
  onClose,
  onSave
}: {
  providers: ProviderManifest[]
  onClose: () => void
  onSave: (input: {
    scope: AlertScope
    providerId?: string
    metric: AlertMetric
    threshold: number
  }) => void | Promise<void>
}) {
  // ponytail: edit-mode is currently out of scope (alerts-repo only has `add`,
  // not upsert). Documented as carry-over. Until then, the modal is create-only.
  const [scope, setScope] = useState<AlertScope>('provider')
  const [providerId, setProviderId] = useState<string>(providers[0]?.id ?? '')
  const [metric, setMetric] = useState<AlertMetric>('remaining_amount')
  const [threshold, setThreshold] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** 提交表单:校验后组装 payload 并调用 onSave */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (scope === 'provider' && !providerId) {
      return setError('请选择 Provider')
    }
    const n = Number(threshold)
    if (!Number.isFinite(n) || n <= 0) {
      return setError('阈值需为大于 0 的数字')
    }
    if (metric === 'remaining_pct' && n > 100) {
      return setError('百分比阈值不能超过 100')
    }
    setSaving(true)
    try {
      const payload: {
        scope: AlertScope
        providerId?: string
        metric: AlertMetric
        threshold: number
      } = { scope, metric, threshold: n }
      if (scope === 'provider') payload.providerId = providerId
      await onSave(payload)
    } catch (err) {
      setError(`保存失败:${(err as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <Modal title="新建告警规则" onClose={onClose}>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Scope</label>
          <div className="flex items-center gap-4 text-[13px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="provider"
                checked={scope === 'provider'}
                onChange={() => setScope('provider')}
              />
              指定 Provider
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scope"
                value="global"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
              />
              全局（任一 Provider 触发即告警）
            </label>
          </div>
        </div>

        {scope === 'provider' && (
          <div className="form-group">
            <label className="form-label">Provider</label>
            <select
              className="select w-full"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {providers.length === 0 ? <option value="">(暂无 Provider)</option> : null}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">指标</label>
          <div className="flex items-center gap-4 text-[13px]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="metric"
                value="remaining_amount"
                checked={metric === 'remaining_amount'}
                onChange={() => setMetric('remaining_amount')}
              />
              剩余金额
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="metric"
                value="remaining_pct"
                checked={metric === 'remaining_pct'}
                onChange={() => setMetric('remaining_pct')}
              />
              剩余百分比
            </label>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">阈值 {metric === 'remaining_pct' ? '(%)' : '(金额)'}</label>
          <input
            className="input w-full mono"
            type="number"
            min={metric === 'remaining_pct' ? '0' : '0'}
            max={metric === 'remaining_pct' ? '100' : undefined}
            step={metric === 'remaining_pct' ? '0.1' : '0.01'}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder={metric === 'remaining_pct' ? '如 10' : '如 5'}
            required
          />
          <p className="form-hint">
            {metric === 'remaining_pct'
              ? '余额剩余百分比低于该值时触发（0–100）。'
              : '余额剩余金额低于该值时触发。'}
          </p>
        </div>

        {error && <p className="text-[12.5px] text-red">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="submit"
            className={`btn btn-primary ${saving ? 'motion-data-flash' : ''}`}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
