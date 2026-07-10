/**
 * 价格配置页面:管理各模型每百万 Token 的 Prompt/Completion/Cache 价格,
 * 支持添加、编辑、删除与恢复官方价,以及按供应商和币种筛选。
 * (glm-5.2)
 */
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { fmtMoney } from '../../shared/utils/money'
import type { PricingEntry } from '../../shared/types/pricing'
import type { ProviderManifest } from '../../shared/types/provider'

/** 支持的币种列表 */
const CURRENCIES = ['USD', 'CNY', 'EUR'] as const
type Currency = (typeof CURRENCIES)[number]

/** 筛选状态:按供应商与币种过滤 */
type FilterState = {
  providerId: string | null
  currency: Currency | null
}

/**
 * 价格配置页面组件。
 * 拉取价格条目与供应商列表,提供筛选、增删改与恢复官方价功能。
 */
export default function PricingConfig() {
  const [entries, setEntries] = useState<PricingEntry[]>([])
  const [providers, setProviders] = useState<ProviderManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PricingEntry | null>(null)
  const [filter, setFilter] = useState<FilterState>({ providerId: null, currency: null })

  /** 刷新价格条目与供应商列表 */
  async function refresh() {
    setLoading(true)
    try {
      const [list, p] = await Promise.all([window.api.pricing.list(), window.api.providers.list()])
      setEntries(list)
      setProviders(p)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  /** 按供应商与模型名排序后的条目 */
  const sorted = useMemo(
    () =>
      [...entries].sort((a, b) =>
        a.providerId === b.providerId
          ? a.model.localeCompare(b.model)
          : a.providerId.localeCompare(b.providerId)
      ),
    [entries]
  )

  /** 按筛选条件过滤后的条目 */
  const filtered = useMemo(() => {
    return sorted.filter((e) => {
      if (filter.providerId && e.providerId !== filter.providerId) return false
      if (filter.currency && e.currency !== filter.currency) return false
      return true
    })
  }, [sorted, filter])

  /** 打开新增价格弹窗 */
  function openCreate() {
    setEditing(null)
    setModalOpen(true)
  }

  /** 打开编辑价格弹窗 */
  function openEdit(entry: PricingEntry) {
    setEditing(entry)
    setModalOpen(true)
  }

  /** 删除单条价格条目(恢复官方价) */
  async function handleDelete(entry: PricingEntry) {
    if (!window.confirm(`删除 ${entry.model} 的价格条目？`)) return
    if (entry.id == null) return
    try {
      await window.api.pricing.restore(entry.id)
      await refresh()
    } catch (e) {
      window.alert(`删除失败：${(e as Error).message}`)
    }
  }

  /** 恢复全部官方价:删除所有用户自定义条目 */
  async function handleRestoreAll() {
    if (!window.confirm('确定要删除所有用户自定义价格条目吗？')) return
    const userEntries = entries.filter((e) => e.source === 'user' && e.id != null)
    if (userEntries.length === 0) {
      window.alert('当前没有用户自定义条目，无需恢复。')
      return
    }
    // ponytail: sequential awaits; small N, parallel would risk partial-failure races.
    let ok = 0
    for (const e of userEntries) {
      try {
        await window.api.pricing.restore(e.id!)
        ok++
      } catch {
        // ignore individual failures, keep going
      }
    }
    await refresh()
    window.alert(`已恢复官方价：删除了 ${ok} 条用户自定义条目。`)
  }

  /** 重置筛选条件 */
  function resetFilter() {
    setFilter({ providerId: null, currency: null })
  }

  return (
    <div className="page-content animate-in">
      <PageHeader
        title="价格配置"
        desc="覆盖各模型每百万 token 价格,支持添加、编辑、删除与恢复官方价"
        action={
          <div className="flex items-center gap-2">
            <button className="btn btn-outline btn-sm" onClick={handleRestoreAll}>
              <i className="fa-solid fa-rotate-left" /> 恢复官方价
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              <i className="fa-solid fa-plus" /> 添加价格
            </button>
          </div>
        }
      />

      {loading ? (
        <Card>
          <EmptyState icon="fa-spinner" title="加载中…" hint="读取本地价格表" />
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon="fa-tag"
            title="尚无价格条目"
            hint="第一次扫描时自动填充常见模型基线价,也可手动添加自定义条目"
            action={
              <button className="btn btn-primary btn-sm mt-2" onClick={openCreate}>
                <i className="fa-solid fa-plus" /> 添加第一条价格
              </button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="mb-4" bodyClassName="py-3">
            <FilterBar
              providers={providers}
              filter={filter}
              onChange={setFilter}
              onReset={resetFilter}
            />
          </Card>
          <Card>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th className="text-right">Prompt ($/Mtok)</th>
                    <th className="text-right">Completion ($/Mtok)</th>
                    <th className="text-right">Cache Read</th>
                    <th className="text-right">Cache Creation</th>
                    <th>Currency</th>
                    <th>Source</th>
                    <th>Updated</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="text-center text-text-muted py-8 text-[13px]">
                        当前筛选下没有条目。
                      </td>
                    </tr>
                  ) : (
                    filtered.map((e) => (
                      <tr key={e.id ?? `${e.providerId}:${e.model}`}>
                        <td className="mono text-[12.5px]">{e.providerId}</td>
                        <td className="fw-500">{e.model}</td>
                        <td className="text-right mono">
                          {fmtMoney(e.promptPricePerMtok, e.currency)}
                        </td>
                        <td className="text-right mono">
                          {fmtMoney(e.completionPricePerMtok, e.currency)}
                        </td>
                        <td className="text-right mono text-secondary">
                          {e.cacheReadPricePerMtok != null
                            ? fmtMoney(e.cacheReadPricePerMtok, e.currency)
                            : '—'}
                        </td>
                        <td className="text-right mono text-secondary">
                          {e.cacheCreationPricePerMtok != null
                            ? fmtMoney(e.cacheCreationPricePerMtok, e.currency)
                            : '—'}
                        </td>
                        <td className="text-secondary text-[12.5px]">{e.currency}</td>
                        <td>
                          <SourceBadge source={e.source} />
                        </td>
                        <td className="text-secondary text-[12px]">
                          {e.updatedAt ? e.updatedAt.slice(0, 16).replace('T', ' ') : '—'}
                        </td>
                        <td>
                          <div className="flex gap-2">
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => openEdit(e)}
                              title="编辑"
                            >
                              <i className="fa-solid fa-pen" />
                            </button>
                            <button
                              className="btn btn-ghost btn-xs"
                              onClick={() => handleDelete(e)}
                              title="删除"
                            >
                              <i className="fa-solid fa-trash-can text-red" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {modalOpen && (
        <PricingEntryModal
          providers={providers}
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            setModalOpen(false)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

/** 筛选工具栏:按供应商与币种过滤 */
function FilterBar({
  providers,
  filter,
  onChange,
  onReset
}: {
  providers: ProviderManifest[]
  filter: FilterState
  onChange: (f: FilterState) => void
  onReset: () => void
}) {
  const anyFilter = !!filter.providerId || !!filter.currency
  return (
    <div className="flex items-center gap-4 flex-wrap text-[12.5px]">
      <div className="flex items-center gap-2">
        <span className="text-text-muted">Provider</span>
        <Chip active={!filter.providerId} onClick={() => onChange({ ...filter, providerId: null })}>
          全部
        </Chip>
        {providers.map((p) => (
          <Chip
            key={p.id}
            active={filter.providerId === p.id}
            onClick={() => onChange({ ...filter, providerId: p.id })}
          >
            {p.displayName}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-text-muted">Currency</span>
        <Chip active={!filter.currency} onClick={() => onChange({ ...filter, currency: null })}>
          全部
        </Chip>
        {CURRENCIES.map((c) => (
          <Chip
            key={c}
            active={filter.currency === c}
            onClick={() => onChange({ ...filter, currency: c })}
          >
            {c}
          </Chip>
        ))}
      </div>
      {anyFilter && (
        <button className="btn btn-outline btn-xs" onClick={onReset}>
          <i className="fa-solid fa-xmark" /> 清空筛选
        </button>
      )}
    </div>
  )
}

/** 筛选胶囊按钮:高亮当前选中项 */
function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[12px] border transition-colors ${
        active
          ? 'bg-accent text-white border-accent'
          : 'bg-bg-base text-text-secondary border-border-light hover:border-text-muted'
      }`}
    >
      {children}
    </button>
  )
}

/** 来源徽标:区分 catalog(官方)与 user(自定义) */
function SourceBadge({ source }: { source: 'catalog' | 'user' }) {
  const isUser = source === 'user'
  return (
    <span
      className={`inline-block px-2 py-[2px] rounded text-[11.5px] font-medium ${
        isUser ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-600'
      }`}
    >
      {isUser ? 'user' : 'catalog'}
    </span>
  )
}

/**
 * 价格条目编辑/新增弹窗。
 * @param providers 供应商列表
 * @param editing 待编辑条目(为 null 时表示新增)
 * @param onClose 关闭回调
 * @param onSaved 保存成功回调
 */
function PricingEntryModal({
  providers,
  editing,
  onClose,
  onSaved
}: {
  providers: ProviderManifest[]
  editing: PricingEntry | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [providerId, setProviderId] = useState(editing?.providerId ?? providers[0]?.id ?? '')
  const [model, setModel] = useState(editing?.model ?? '')
  const [currency, setCurrency] = useState<Currency>((editing?.currency as Currency) ?? 'USD')
  const [prompt, setPrompt] = useState<string>(editing ? String(editing.promptPricePerMtok) : '')
  const [completion, setCompletion] = useState<string>(
    editing ? String(editing.completionPricePerMtok) : ''
  )
  const [cacheRead, setCacheRead] = useState<string>(
    editing?.cacheReadPricePerMtok != null ? String(editing.cacheReadPricePerMtok) : ''
  )
  const [cacheCreation, setCacheCreation] = useState<string>(
    editing?.cacheCreationPricePerMtok != null ? String(editing.cacheCreationPricePerMtok) : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /** 解析非负数字,空串返回 null,非法或负数返回 null */
  function parseNonNegative(v: string): number | null {
    if (v.trim() === '') return null
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return null
    return n
  }

  /** 提交表单:校验后构建 payload 并调用 pricing.set 保存 */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!providerId) return setError('请选择 Provider')
    if (!model.trim()) return setError('请填写 Model')
    const p = parseNonNegative(prompt)
    if (p === null) return setError('Prompt 价格需为非负数字')
    const c = parseNonNegative(completion)
    if (c === null) return setError('Completion 价格需为非负数字')
    const cr = cacheRead.trim() === '' ? undefined : parseNonNegative(cacheRead)
    if (cacheRead.trim() !== '' && cr === null) return setError('Cache Read 价格需为非负数字')
    const cc = cacheCreation.trim() === '' ? undefined : parseNonNegative(cacheCreation)
    if (cacheCreation.trim() !== '' && cc === null)
      return setError('Cache Creation 价格需为非负数字')

    setSaving(true)
    try {
      // ponytail: build the payload object conditionally so undefined fields are
      // omitted — Zod's optional + exactOptionalPropertyTypes doesn't accept
      // explicit `undefined` on optional keys.
      const payload: Parameters<typeof window.api.pricing.set>[0] = {
        providerId,
        model: model.trim(),
        promptPricePerMtok: p!,
        completionPricePerMtok: c!,
        currency,
        source: editing?.source ?? 'user'
      }
      if (cr !== undefined && cr !== null) payload.cacheReadPricePerMtok = cr
      if (cc !== undefined && cc !== null) payload.cacheCreationPricePerMtok = cc
      await window.api.pricing.set(payload)
      await onSaved()
    } catch (err) {
      setError(`保存失败:${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={editing ? '编辑价格条目' : '添加价格条目'} onClose={onClose}>
      <form className="space-y-3" onSubmit={handleSubmit}>
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
        <div className="form-group">
          <label className="form-label">Model</label>
          <input
            className="input w-full"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="如 gpt-4o / deepseek-chat"
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Currency</label>
          <select
            className="select w-full"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label">Prompt 价格 ($/Mtok)</label>
            <input
              className="input w-full mono"
              type="number"
              min="0"
              step="0.01"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Completion 价格 ($/Mtok)</label>
            <input
              className="input w-full mono"
              type="number"
              min="0"
              step="0.01"
              value={completion}
              onChange={(e) => setCompletion(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Cache Read 价格 (可选)</label>
            <input
              className="input w-full mono"
              type="number"
              min="0"
              step="0.01"
              value={cacheRead}
              onChange={(e) => setCacheRead(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Cache Creation 价格 (可选)</label>
            <input
              className="input w-full mono"
              type="number"
              min="0"
              step="0.01"
              value={cacheCreation}
              onChange={(e) => setCacheCreation(e.target.value)}
            />
          </div>
        </div>
        <p className="form-hint">
          所有价格单位为「每百万 token」。可选 Cache 字段留空表示该模型无对应计费。
        </p>
        {error && <p className="text-[12.5px] text-red">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
