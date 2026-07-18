/**
 * 价格配置页面:管理各模型每百万 Token 的 Prompt/Completion/Cache 价格,
 * 支持添加、编辑、删除与恢复官方价,以及按供应商和币种筛选。
 * (glm-5.2)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { convertPriceCurrency, fmtMoney, normalizeCurrency } from '../../shared/utils/money'
import type {
  CnyRateQuote,
  PricingCatalogStatus,
  PricingExchangePolicyConfig,
  PricingEntry,
  PricingHistoryEntry
} from '../../shared/types/pricing'
import type { ProviderManifest } from '../../shared/types/provider'

/** 支持的币种列表 */
const CURRENCIES = ['USD', 'CNY', 'EUR'] as const
const BILLING_SCOPES = ['default', 'cn', 'global'] as const
type Currency = (typeof CURRENCIES)[number]
type DisplayCurrency = 'CNY' | 'USD'

/** 筛选状态:按供应商与币种过滤 */
type FilterState = {
  providerId: string | null
  currency: Currency | null
  billingScope: string | null
  query: string
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
  const [filter, setFilter] = useState<FilterState>({
    providerId: null,
    currency: null,
    billingScope: null,
    query: ''
  })
  const [catalogStatus, setCatalogStatus] = useState<PricingCatalogStatus | null>(null)
  const [history, setHistory] = useState<PricingHistoryEntry[]>([])
  const [exchangePolicy, setExchangePolicy] = useState<PricingExchangePolicyConfig>({
    policy: 'realtime',
    fixedRates: {}
  })
  const [cnyRates, setCnyRates] = useState<Record<string, CnyRateQuote>>({})
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('CNY')
  const [syncingCatalog, setSyncingCatalog] = useState(false)

  /** 加载价格表中所有非人民币币种的 CNY 汇率。 */
  const refreshCnyRates = useCallback(async (list: PricingEntry[]) => {
    const currencies = [
      ...new Set(
        ['USD', ...list.map((entry) => normalizeCurrency(entry.currency))].filter(
          (currency) => currency !== 'CNY' && currency !== 'RMB'
        )
      )
    ]
    const quotes = await Promise.all(
      currencies.map(async (currency) => {
        try {
          return await window.api.pricing.cnyRate(currency)
        } catch {
          return null
        }
      })
    )
    setCnyRates(
      Object.fromEntries(
        quotes
          .filter((quote): quote is CnyRateQuote => quote !== null)
          .map((quote) => [normalizeCurrency(quote.currency), quote])
      )
    )
  }, [])

  /** 刷新价格条目与供应商列表 */
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, p, status, recentHistory, policy] = await Promise.all([
        window.api.pricing.list(),
        window.api.providers.list(),
        window.api.pricing.catalogStatus(),
        window.api.pricing.history(8),
        window.api.pricing.exchangePolicy()
      ])
      setEntries(list)
      await refreshCnyRates(list)
      setProviders(p)
      setCatalogStatus(status)
      setHistory(recentHistory)
      setExchangePolicy(policy)
    } finally {
      setLoading(false)
    }
  }, [refreshCnyRates])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void Promise.all([
        window.api.pricing.catalogStatus(),
        window.api.pricing.list(),
        window.api.pricing.history(8)
      ])
        .then(([status, list, recentHistory]) => {
          setCatalogStatus(status)
          setEntries(list)
          setHistory(recentHistory)
          void refreshCnyRates(list)
        })
        .catch(() => undefined)
    }, 3_000)
    return () => window.clearInterval(timer)
  }, [refresh, refreshCnyRates])

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
      if (filter.billingScope && (e.billingScope ?? 'default') !== filter.billingScope) return false
      const query = filter.query.trim().toLocaleLowerCase()
      if (query && !`${e.providerId} ${e.model}`.toLocaleLowerCase().includes(query)) return false
      return true
    })
  }, [sorted, filter])

  const ratesToCny = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(cnyRates).map(([currency, quote]) => [currency, quote.rateToCny])
      ),
    [cnyRates]
  )

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

  /** 删除用户覆盖后重新同步目录，以恢复 models.dev 官方价。 */
  async function handleDelete(entry: PricingEntry) {
    if (!window.confirm(`删除 ${entry.model} 的自定义价格并恢复官方价？`)) return
    if (entry.id == null) return
    try {
      await window.api.pricing.restore(entry.id)
      await window.api.pricing.syncCatalog()
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
    try {
      await window.api.pricing.syncCatalog()
    } catch {
      // User rows were removed successfully; the status card will show the
      // catalog refresh error and the next automatic sync can restore them.
    }
    await refresh()
    window.alert(`已恢复官方价：删除了 ${ok} 条用户自定义条目。`)
  }

  /** 重置筛选条件 */
  function resetFilter() {
    setFilter({ providerId: null, currency: null, billingScope: null, query: '' })
  }

  async function handleCatalogSync() {
    setSyncingCatalog(true)
    try {
      if (catalogStatus?.approvalRequired === false) {
        const result = await window.api.pricing.syncCatalog()
        if (result.notModified) window.alert('models.dev 价格目录已是最新版本。')
        await refresh()
        return
      }
      const preview = await window.api.pricing.catalogPreview()
      if (!preview) {
        window.alert('models.dev 价格目录已是最新版本。')
      } else {
        const summary = preview.changes.reduce(
          (result, change) => {
            result[change.kind]++
            if (change.blocked) result.blocked++
            return result
          },
          { added: 0, changed: 0, removed: 0, blocked: 0 }
        )
        const confirmed = window.confirm(
          `目录差异：新增 ${summary.added}、变更 ${summary.changed}、下架 ${summary.removed}，异常变动 ${summary.blocked}。确认应用？`
        )
        if (confirmed) await window.api.pricing.applyCatalogPreview(preview.id)
      }
      await refresh()
    } catch (error) {
      await refresh()
      window.alert(`同步失败：${(error as Error).message}`)
    } finally {
      setSyncingCatalog(false)
    }
  }

  async function handleAutoUpdate(enabled: boolean) {
    const status = await window.api.pricing.setCatalogAutoUpdate(enabled)
    setCatalogStatus(status)
  }

  async function handleApprovalRequired(enabled: boolean) {
    const status = await window.api.pricing.setCatalogApprovalRequired(enabled)
    setCatalogStatus(status)
    await refresh()
  }

  async function handleExchangePolicyChange(config: PricingExchangePolicyConfig) {
    const saved = await window.api.pricing.setExchangePolicy(config)
    setExchangePolicy(saved)
    await refreshCnyRates(entries)
  }

  async function handleApplyPreview() {
    const pending = catalogStatus?.pendingPreview
    if (!pending) return
    const confirmed = window.confirm(
      `检测到 ${pending.blocked} 个异常价格变动，另有新增 ${pending.added}、变更 ${pending.changed}、下架 ${pending.removed} 条。确认应用这批目录更新吗？`
    )
    if (!confirmed) return
    try {
      await window.api.pricing.applyCatalogPreview(pending.id)
      await refresh()
    } catch (error) {
      window.alert(`应用目录预览失败：${(error as Error).message}`)
    }
  }

  return (
    <div className="page-content animate-in">
      <PageHeader
        title="价格配置"
        desc="同步 models.dev 官方价格并统一折算为人民币展示；编辑时仍保留原始计价币种"
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" role="group" aria-label="价格显示币种">
              <button
                type="button"
                className={`btn btn-sm ${displayCurrency === 'CNY' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setDisplayCurrency('CNY')}
              >
                ¥ 人民币
              </button>
              <button
                type="button"
                className={`btn btn-sm ${displayCurrency === 'USD' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setDisplayCurrency('USD')}
              >
                $ 美元
              </button>
            </div>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => void handleCatalogSync()}
              disabled={syncingCatalog}
            >
              <i className={`fa-solid fa-arrows-rotate ${syncingCatalog ? 'fa-spin' : ''}`} />
              {syncingCatalog ? '同步中…' : '同步官方价格'}
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleRestoreAll}>
              <i className="fa-solid fa-rotate-left" /> 恢复官方价
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              <i className="fa-solid fa-plus" /> 添加价格
            </button>
          </div>
        }
      />

      <CatalogStatusCard
        status={catalogStatus}
        cnyRate={cnyRates.USD ?? null}
        onAutoUpdate={(enabled) => void handleAutoUpdate(enabled)}
        onApprovalRequired={(enabled) => void handleApprovalRequired(enabled)}
        onApplyPreview={() => void handleApplyPreview()}
        exchangePolicy={exchangePolicy}
        onExchangePolicyChange={(config) => void handleExchangePolicyChange(config)}
      />

      <PricingHistoryCard history={history} />

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
                    <th>Scope</th>
                    <th className="text-right">Prompt ({displayCurrency}/Mtok)</th>
                    <th className="text-right">Completion ({displayCurrency}/Mtok)</th>
                    <th className="text-right">Cache Read ({displayCurrency}/Mtok)</th>
                    <th className="text-right">Cache Creation ({displayCurrency}/Mtok)</th>
                    <th>原始币种</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center text-text-muted py-8 text-[13px]">
                        当前筛选下没有条目。
                      </td>
                    </tr>
                  ) : (
                    filtered.map((e) => (
                      <tr key={e.id ?? `${e.providerId}:${e.model}`}>
                        <td className="mono text-[12.5px]">{e.providerId}</td>
                        <td className="fw-500">{e.model}</td>
                        <td className="mono text-[12px]">{e.billingScope ?? 'default'}</td>
                        <td className="text-right mono">
                          <PriceCell
                            value={e.promptPricePerMtok}
                            currency={e.currency}
                            displayCurrency={displayCurrency}
                            ratesToCny={ratesToCny}
                          />
                        </td>
                        <td className="text-right mono">
                          <PriceCell
                            value={e.completionPricePerMtok}
                            currency={e.currency}
                            displayCurrency={displayCurrency}
                            ratesToCny={ratesToCny}
                          />
                        </td>
                        <td className="text-right mono text-secondary">
                          {e.cacheReadPricePerMtok != null ? (
                            <PriceCell
                              value={e.cacheReadPricePerMtok}
                              currency={e.currency}
                              displayCurrency={displayCurrency}
                              ratesToCny={ratesToCny}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="text-right mono text-secondary">
                          {e.cacheCreationPricePerMtok != null ? (
                            <PriceCell
                              value={e.cacheCreationPricePerMtok}
                              currency={e.currency}
                              displayCurrency={displayCurrency}
                              ratesToCny={ratesToCny}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="text-secondary text-[12.5px]">{e.currency}</td>
                        <td>
                          <SourceBadge source={e.source} />
                        </td>
                        <td>
                          {e.catalogActive === false ? (
                            <span className="text-[11.5px] text-amber-700">上游已移除</span>
                          ) : (
                            <span className="text-[11.5px] text-emerald-700">有效</span>
                          )}
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
                            {e.source === 'user' && (
                              <button
                                className="btn btn-ghost btn-xs"
                                onClick={() => handleDelete(e)}
                                title="删除自定义价格并恢复官方价"
                              >
                                <i className="fa-solid fa-rotate-left" />
                              </button>
                            )}
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

function CatalogStatusCard({
  status,
  cnyRate,
  onAutoUpdate,
  onApprovalRequired,
  onApplyPreview,
  exchangePolicy,
  onExchangePolicyChange
}: {
  status: PricingCatalogStatus | null
  cnyRate: CnyRateQuote | null
  onAutoUpdate: (enabled: boolean) => void
  onApprovalRequired: (enabled: boolean) => void
  onApplyPreview: () => void
  exchangePolicy: PricingExchangePolicyConfig
  onExchangePolicyChange: (config: PricingExchangePolicyConfig) => void
}) {
  const result = status?.lastResult
  return (
    <Card className="mb-4" bodyClassName="py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap text-[12.5px]">
        <div>
          <div className="fw-600">Models.dev 官方价格</div>
          <div className="text-text-muted mt-1">
            {status?.state === 'syncing'
              ? '正在从 models.dev 同步官方价格…'
              : status?.state === 'error'
                ? `最近同步失败：${status.lastError ?? '未知错误'}`
                : status?.lastSuccessAt
                  ? `上次同步：${formatDateTime(status.lastSuccessAt)}`
                  : '尚未同步，应用启动后会在后台获取官方价格。'}
            {result && !result.notModified
              ? ` · 更新 ${result.synced} 条 · 新增 ${result.added ?? 0} · 变更 ${result.changed ?? 0} · 下架 ${result.removed ?? 0} · 保护自定义 ${result.protected}`
              : result?.notModified
                ? ' · 已是最新版本'
                : ''}
          </div>
          {status?.pendingPreview && (
            <div className="mt-2 flex items-center gap-2 text-amber-700">
              <span>
                有 {status.pendingPreview.blocked} 个异常价格变动待确认（检测于{' '}
                {formatDateTime(status.pendingPreview.checkedAt)}）。
              </span>
              <button className="btn btn-outline btn-xs" onClick={onApplyPreview}>
                审阅并应用
              </button>
            </div>
          )}
          <div className="text-text-muted mt-1">
            {cnyRate
              ? `人民币参考：1 USD ≈ ${cnyRate.rateToCny.toFixed(4)} CNY · ${
                  cnyRate.source === 'api' ? '实时汇率' : '离线参考汇率'
                }${cnyRate.updatedAt ? ` · ${cnyRate.updatedAt}` : ''}`
              : '人民币参考汇率加载中…'}
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={status?.autoUpdate ?? true}
            onChange={(event) => onAutoUpdate(event.target.checked)}
          />
          每 24 小时自动检查
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={status?.approvalRequired ?? true}
            onChange={(event) => onApprovalRequired(event.target.checked)}
          />
          异常价格变动需审批
        </label>
        <label className="flex items-center gap-2">
          汇率策略
          <select
            className="select select-sm"
            value={exchangePolicy.policy}
            onChange={(event) =>
              onExchangePolicyChange({
                ...exchangePolicy,
                policy: event.target.value as PricingExchangePolicyConfig['policy']
              })
            }
          >
            <option value="realtime">实时汇率</option>
            <option value="fallback">离线参考</option>
            <option value="fixed">固定汇率</option>
          </select>
        </label>
        {exchangePolicy.policy === 'fixed' && (
          <label className="flex items-center gap-2">
            1 USD =
            <input
              className="input input-sm w-24 mono"
              type="number"
              min="0.0001"
              step="0.0001"
              value={exchangePolicy.fixedRates.USD ?? ''}
              onChange={(event) =>
                Number(event.target.value) > 0 &&
                onExchangePolicyChange({
                  ...exchangePolicy,
                  fixedRates: { ...exchangePolicy.fixedRates, USD: Number(event.target.value) }
                })
              }
            />
            CNY
          </label>
        )}
      </div>
    </Card>
  )
}

function PricingHistoryCard({ history }: { history: PricingHistoryEntry[] }) {
  if (history.length === 0) return null
  return (
    <Card className="mb-4" bodyClassName="py-3">
      <div className="fw-600 text-[13px] mb-2">最近价格变更</div>
      <div className="space-y-1 text-[12px]">
        {history.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3">
            <span className="mono">
              {item.providerId}/{item.billingScope}/{item.model}
            </span>
            <span className="text-text-muted">
              {item.kind === 'added' ? '新增' : item.kind === 'changed' ? '变更' : '下架'} ·{' '}
              {item.status === 'blocked' ? '待确认' : '已应用'} · {formatDateTime(item.detectedAt)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function PriceCell({
  value,
  currency,
  displayCurrency,
  ratesToCny
}: {
  value: number
  currency: string
  displayCurrency: DisplayCurrency
  ratesToCny: Record<string, number | undefined>
}) {
  const normalizedCurrency = normalizeCurrency(currency)
  const converted = convertPriceCurrency(value, normalizedCurrency, displayCurrency, ratesToCny)
  const title =
    converted !== null && normalizedCurrency !== displayCurrency
      ? `原价 ${fmtMoney(value, normalizedCurrency)}`
      : undefined
  return (
    <div title={title}>
      {converted === null ? (
        <span className="text-text-muted">汇率不可用</span>
      ) : (
        fmtMoney(converted, displayCurrency)
      )}
    </div>
  )
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
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
  const anyFilter =
    !!filter.providerId || !!filter.currency || !!filter.billingScope || !!filter.query.trim()
  return (
    <div className="flex items-center gap-4 flex-wrap text-[12.5px]">
      <input
        className="input min-w-[220px]"
        value={filter.query}
        onChange={(event) => onChange({ ...filter, query: event.target.value })}
        placeholder="搜索 Provider 或模型"
      />
      <div className="flex flex-wrap items-center gap-2 min-w-0">
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
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="text-text-muted">原始币种</span>
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
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="text-text-muted">Scope</span>
        <Chip
          active={!filter.billingScope}
          onClick={() => onChange({ ...filter, billingScope: null })}
        >
          全部
        </Chip>
        {BILLING_SCOPES.map((scope) => (
          <Chip
            key={scope}
            active={filter.billingScope === scope}
            onClick={() => onChange({ ...filter, billingScope: scope })}
          >
            {scope}
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
  const [billingScope, setBillingScope] = useState(editing?.billingScope ?? 'default')
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
        billingScope,
        source: 'user'
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
        <div className="form-group">
          <label className="form-label">Billing Scope</label>
          <select
            className="select w-full"
            value={billingScope}
            onChange={(event) => setBillingScope(event.target.value)}
          >
            {BILLING_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
          <p className="form-hint">cn/global 用于区分中国站与国际站；普通价格使用 default。</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="form-group">
            <label className="form-label">Prompt 价格 ({currency}/Mtok)</label>
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
            <label className="form-label">Completion 价格 ({currency}/Mtok)</label>
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
