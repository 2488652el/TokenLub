/**
 * 价格配置页面:管理各模型每百万 Token 的 Prompt/Completion/Cache 价格,
 * 支持添加、编辑、删除与恢复官方价,以及按供应商和币种筛选。
 * (glm-5.2)
 */
import { Icon } from '../components/Icon'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { AnimatedNumber, MotionGroup } from '../components/motion'
import { ProviderIcon } from '../components/ProviderIcon'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { convertPriceCurrency, fmtMoney, normalizeCurrency } from '../../shared/utils/money'
import {
  dedupePricingToOfficial,
  filterPricingEntries,
  paginatePricingEntries,
  summarizePricingEntries,
  type PricingViewFilter,
  type PricingViewSummary
} from '../../shared/utils/pricing-view'
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
const PAGE_SIZE = 50
type Currency = (typeof CURRENCIES)[number]
type DisplayCurrency = 'CNY' | 'USD'

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
  const [filter, setFilter] = useState<PricingViewFilter>({
    providerId: null,
    currency: null,
    billingScope: null,
    source: null,
    query: ''
  })
  const [page, setPage] = useState(1)
  const [catalogStatus, setCatalogStatus] = useState<PricingCatalogStatus | null>(null)
  const [history, setHistory] = useState<PricingHistoryEntry[]>([])
  const [exchangePolicy, setExchangePolicy] = useState<PricingExchangePolicyConfig>({
    policy: 'realtime',
    fixedRates: {}
  })
  const [cnyRates, setCnyRates] = useState<Record<string, CnyRateQuote>>({})
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('CNY')
  const [syncingCatalog, setSyncingCatalog] = useState(false)
  const reducedMotion = useReducedMotion()

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
  const filteredRaw = useMemo(() => filterPricingEntries(sorted, filter), [sorted, filter])
  /** 每个模型只保留官方价(官方目录没有时保留聚合商独有行);用户自定义行不动 */
  const filtered = useMemo(() => dedupePricingToOfficial(filteredRaw), [filteredRaw])
  const summary = useMemo(() => summarizePricingEntries(entries), [entries])
  const paginated = useMemo(
    () => paginatePricingEntries(filtered, page, PAGE_SIZE),
    [filtered, page]
  )
  const providerNames = useMemo(
    () => Object.fromEntries(providers.map((provider) => [provider.id, provider.displayName])),
    [providers]
  )

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
    setFilter({
      providerId: null,
      currency: null,
      billingScope: null,
      source: null,
      query: ''
    })
    setPage(1)
  }

  function updateFilter(nextFilter: PricingViewFilter) {
    setFilter(nextFilter)
    setPage(1)
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
    <div className="page-content" data-motion-group>
      <PageHeader
        title="价格配置"
        desc="查看模型单价、管理自定义价格，官方目录会自动保持更新"
        action={
          <button className="btn btn-primary" onClick={openCreate}>
            <Icon name="fa-plus" /> 添加价格
          </button>
        }
      />

      <CatalogStatusCard
        status={catalogStatus}
        summary={summary}
        cnyRate={cnyRates.USD ?? null}
        displayCurrency={displayCurrency}
        onDisplayCurrencyChange={setDisplayCurrency}
        syncing={syncingCatalog}
        reducedMotion={reducedMotion}
        onSync={() => void handleCatalogSync()}
        onRestoreAll={() => void handleRestoreAll()}
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
                <Icon name="fa-plus" /> 添加第一条价格
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
              onChange={updateFilter}
              onReset={resetFilter}
              resultCount={filtered.length}
              totalCount={entries.length}
            />
          </Card>
          <PricingTable
            entries={paginated.entries}
            providerNames={providerNames}
            displayCurrency={displayCurrency}
            ratesToCny={ratesToCny}
            onEdit={openEdit}
            onRestore={(entry) => void handleDelete(entry)}
          />
          {filtered.length > 0 && (
            <Pagination
              page={paginated.page}
              totalPages={paginated.totalPages}
              pageSize={PAGE_SIZE}
              totalCount={filtered.length}
              onChange={setPage}
            />
          )}
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
  summary,
  cnyRate,
  displayCurrency,
  onDisplayCurrencyChange,
  syncing,
  reducedMotion,
  onSync,
  onRestoreAll,
  onAutoUpdate,
  onApprovalRequired,
  onApplyPreview,
  exchangePolicy,
  onExchangePolicyChange
}: {
  status: PricingCatalogStatus | null
  summary: PricingViewSummary
  cnyRate: CnyRateQuote | null
  displayCurrency: DisplayCurrency
  onDisplayCurrencyChange: (currency: DisplayCurrency) => void
  syncing: boolean
  reducedMotion: boolean
  onSync: () => void
  onRestoreAll: () => void
  onAutoUpdate: (enabled: boolean) => void
  onApprovalRequired: (enabled: boolean) => void
  onApplyPreview: () => void
  exchangePolicy: PricingExchangePolicyConfig
  onExchangePolicyChange: (config: PricingExchangePolicyConfig) => void
}) {
  const result = status?.lastResult
  const isError = status?.state === 'error'
  const isSyncing = status?.state === 'syncing' || syncing
  const statusLabel = isSyncing ? '同步中' : isError ? '同步异常' : '目录正常'
  return (
    <Card
      className={`mb-4 ${isSyncing ? 'motion-data-flash' : ''}`}
      bodyClassName="p-0"
      motion="status"
    >
      <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`w-10 h-10 rounded-lg inline-flex items-center justify-center ${
              isError
                ? 'bg-red-50 text-red'
                : isSyncing
                  ? 'bg-blue-50 text-status-blue'
                  : 'bg-emerald-50 text-accent'
            }`}
          >
            <Icon name={isSyncing ? 'fa-arrows-rotate' : 'fa-tags'} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[14px] text-text-primary">
                Models.dev 官方目录
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium ${
                  isError
                    ? 'bg-red-50 text-red'
                    : isSyncing
                      ? 'bg-blue-50 text-status-blue'
                      : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {statusLabel}
              </span>
            </div>
            <div className="text-[12.5px] text-text-muted mt-1 truncate">
              {isSyncing
                ? '正在获取最新模型价格…'
                : isError
                  ? `最近同步失败：${status?.lastError ?? '未知错误'}`
                  : status?.lastSuccessAt
                    ? `更新于 ${formatDateTime(status.lastSuccessAt)}${
                        result?.notModified ? ' · 已是最新版本' : ''
                      }`
                    : '应用启动后会自动获取官方价格'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center p-1 rounded-md bg-bg-hover"
            role="group"
            aria-label="价格显示币种"
          >
            {(['CNY', 'USD'] as const).map((currency) => (
              <button
                key={currency}
                type="button"
                className={`px-3 py-1.5 rounded text-[12px] font-medium transition-colors ${
                  displayCurrency === currency
                    ? 'bg-bg-card text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                }`}
                onClick={() => onDisplayCurrencyChange(currency)}
              >
                {currency === 'CNY' ? '¥ 人民币' : '$ 美元'}
              </button>
            ))}
          </div>
          <button className="btn btn-outline btn-sm" onClick={onSync} disabled={syncing}>
            <Icon
              name="fa-arrows-rotate"
              className={syncing && !reducedMotion ? 'icon-spin' : ''}
            />
            {syncing ? '同步中…' : '立即同步'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 border-t border-border-light bg-bg-base/60">
        <CatalogMetric label="价格条目" value={summary.total} />
        <CatalogMetric label="Provider" value={summary.providerCount} />
        <CatalogMetric label="自定义价格" value={summary.customCount} />
        <CatalogMetric
          label="参考汇率"
          value={cnyRate ? `¥${cnyRate.rateToCny.toFixed(2)}` : '—'}
          hint={cnyRate?.source === 'api' ? '实时' : cnyRate ? '离线' : '加载中'}
        />
      </div>

      {status?.pendingPreview && (
        <div className="px-5 py-3 border-t border-border-light bg-amber-50 flex items-center justify-between gap-3 text-[12.5px] text-amber-700">
          <span>
            <Icon name="fa-triangle-exclamation" className="mr-2" />
            {status.pendingPreview.blocked} 个异常变动等待确认
          </span>
          <button className="btn btn-outline btn-xs" onClick={onApplyPreview}>
            审阅并应用
          </button>
        </div>
      )}

      <details className="border-t border-border-light" data-pricing-settings>
        <summary className="px-5 py-3 cursor-pointer text-[12.5px] text-text-secondary hover:bg-bg-hover transition-colors">
          <span className="inline-flex items-center gap-2">
            <Icon name="fa-sliders" className="text-text-muted" />
            同步与汇率设置
            <span className="text-text-muted">
              · {(status?.autoUpdate ?? true) ? '自动更新' : '手动更新'} ·{' '}
              {exchangePolicy.policy === 'realtime'
                ? '实时汇率'
                : exchangePolicy.policy === 'fixed'
                  ? '固定汇率'
                  : '离线汇率'}
            </span>
          </span>
        </summary>
        <div className="px-5 py-4 border-t border-border-light bg-bg-base/40 flex items-center gap-5 flex-wrap text-[12.5px]">
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
            异常变动需确认
          </label>
          <label className="flex items-center gap-2">
            汇率
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
          <button className="btn btn-ghost btn-xs ml-auto" onClick={onRestoreAll}>
            <Icon name="fa-rotate-left" /> 恢复全部官方价
          </button>
        </div>
      </details>
    </Card>
  )
}

function CatalogMetric({
  label,
  value,
  hint
}: {
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div className="px-5 py-3 border-r border-border-light last:border-r-0">
      <div className="text-[11.5px] text-text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[17px] font-semibold text-text-primary">
          {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        </span>
        {hint && <span className="text-[10.5px] text-text-muted">{hint}</span>}
      </div>
    </div>
  )
}

function PricingHistoryCard({ history }: { history: PricingHistoryEntry[] }) {
  if (history.length === 0) return null
  const added = history.filter((item) => item.kind === 'added').length
  const changed = history.filter((item) => item.kind === 'changed').length
  const removed = history.filter((item) => item.kind === 'removed').length
  return (
    <Card className="mb-4" bodyClassName="p-0">
      <details>
        <summary className="px-5 py-3.5 cursor-pointer hover:bg-bg-hover transition-colors">
          <span className="inline-flex items-center gap-2 text-[12.5px]">
            <Icon name="fa-clock-rotate-left" className="text-text-muted" />
            <span className="font-medium text-text-primary">最近价格变更</span>
            <span className="text-text-muted">
              新增 {added} · 变更 {changed} · 下架 {removed}
            </span>
          </span>
        </summary>
        <MotionGroup className="border-t border-border-light divide-y divide-border-light text-[12px]">
          {history.map((item) => (
            <div key={item.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
              <span className="mono truncate">
                {item.providerId}/{item.billingScope}/{item.model}
              </span>
              <span className="text-text-muted whitespace-nowrap">
                {item.kind === 'added' ? '新增' : item.kind === 'changed' ? '变更' : '下架'} ·{' '}
                {item.status === 'blocked' ? '待确认' : '已应用'} ·{' '}
                {formatDateTime(item.detectedAt)}
              </span>
            </div>
          ))}
        </MotionGroup>
      </details>
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
    <span title={title}>
      {converted === null ? (
        <span className="text-text-muted">汇率不可用</span>
      ) : (
        fmtMoney(converted, displayCurrency)
      )}
    </span>
  )
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

/** 价格目录筛选工具栏:搜索优先,结构化筛选作为补充。 */
function FilterBar({
  providers,
  filter,
  onChange,
  onReset,
  resultCount,
  totalCount
}: {
  providers: ProviderManifest[]
  filter: PricingViewFilter
  onChange: (filter: PricingViewFilter) => void
  onReset: () => void
  resultCount: number
  totalCount: number
}) {
  const anyFilter =
    !!filter.providerId ||
    !!filter.currency ||
    !!filter.billingScope ||
    !!filter.source ||
    !!filter.query.trim()
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[260px]">
          <Icon
            name="fa-magnifying-glass"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-text-muted pointer-events-none"
          />
          <input
            className="input w-full pl-9"
            value={filter.query}
            onChange={(event) => onChange({ ...filter, query: event.target.value })}
            placeholder="搜索模型或 Provider"
            aria-label="搜索模型或 Provider"
          />
        </label>
        <select
          className="select min-w-[150px]"
          value={filter.providerId ?? ''}
          onChange={(event) => onChange({ ...filter, providerId: event.target.value || null })}
          aria-label="筛选 Provider"
        >
          <option value="">全部 Provider</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.displayName}
            </option>
          ))}
        </select>
        <select
          className="select min-w-[116px]"
          value={filter.source ?? ''}
          onChange={(event) =>
            onChange({
              ...filter,
              source: (event.target.value || null) as PricingEntry['source'] | null
            })
          }
          aria-label="筛选价格来源"
        >
          <option value="">全部来源</option>
          <option value="catalog">官方价格</option>
          <option value="user">自定义价格</option>
        </select>
        <select
          className="select min-w-[104px]"
          value={filter.currency ?? ''}
          onChange={(event) => onChange({ ...filter, currency: event.target.value || null })}
          aria-label="筛选原始币种"
        >
          <option value="">全部币种</option>
          {CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
        <select
          className="select min-w-[108px]"
          value={filter.billingScope ?? ''}
          onChange={(event) => onChange({ ...filter, billingScope: event.target.value || null })}
          aria-label="筛选计费区域"
        >
          <option value="">全部区域</option>
          {BILLING_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {scope}
            </option>
          ))}
        </select>
        {anyFilter && (
          <button className="btn btn-ghost btn-sm" onClick={onReset} title="清空筛选">
            <Icon name="fa-xmark" /> 清空
          </button>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-text-muted">
        <span>
          {anyFilter ? '已筛选' : '全部价格'} · 每页最多 {PAGE_SIZE} 条
        </span>
        <span className="font-mono" aria-live="polite">
          <AnimatedNumber value={resultCount} /> / <AnimatedNumber value={totalCount} /> 条
        </span>
      </div>
    </div>
  )
}

function PricingTable({
  entries,
  providerNames,
  displayCurrency,
  ratesToCny,
  onEdit,
  onRestore
}: {
  entries: PricingEntry[]
  providerNames: Record<string, string | undefined>
  displayCurrency: DisplayCurrency
  ratesToCny: Record<string, number | undefined>
  onEdit: (entry: PricingEntry) => void
  onRestore: (entry: PricingEntry) => void
}) {
  return (
    <Card bodyClassName="p-0">
      <div className="px-5 py-3.5 border-b border-border-light flex items-center justify-between">
        <div>
          <div className="text-[13.5px] font-semibold text-text-primary">模型价格</div>
          <div className="text-[11.5px] text-text-muted mt-0.5">单价均按每百万 Token 展示</div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-bg-hover text-[11.5px] text-text-secondary font-medium">
          {displayCurrency === 'CNY' ? '人民币 CNY' : '美元 USD'}
        </span>
      </div>
      <div className="table-wrapper" data-pricing-table>
        <table>
          <thead>
            <tr>
              <th>模型</th>
              <th className="text-right">输入</th>
              <th className="text-right">输出</th>
              <th>缓存价格</th>
              <th>来源与状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody className="motion-table-rows">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-text-muted py-10 text-[13px]">
                  <Icon name="fa-magnifying-glass" className="mr-2" />
                  没有符合当前筛选的价格
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.id ?? `${entry.providerId}:${entry.model}`}
                  data-pricing-row={entry.model}
                >
                  <td>
                    <div className="flex items-center gap-3 min-w-[260px]">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-light bg-bg-card">
                        <ProviderIcon
                          providerId={entry.providerId}
                          title={providerNames[entry.providerId] ?? entry.providerId}
                          size={19}
                        />
                      </span>
                      <div className="min-w-0">
                        <div
                          className="text-[13px] font-medium text-text-primary truncate max-w-[340px]"
                          title={entry.model}
                        >
                          {entry.model}
                        </div>
                        <div className="text-[11px] text-text-muted mt-0.5">
                          {providerNames[entry.providerId] ?? entry.providerId}
                          <span className="mx-1.5">·</span>
                          <span className="font-mono">{entry.billingScope ?? 'default'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right mono text-[12.5px] font-medium">
                    <PriceCell
                      value={entry.promptPricePerMtok}
                      currency={entry.currency}
                      displayCurrency={displayCurrency}
                      ratesToCny={ratesToCny}
                    />
                  </td>
                  <td className="text-right mono text-[12.5px] font-medium">
                    <PriceCell
                      value={entry.completionPricePerMtok}
                      currency={entry.currency}
                      displayCurrency={displayCurrency}
                      ratesToCny={ratesToCny}
                    />
                  </td>
                  <td>
                    <div className="space-y-1 text-[11.5px]">
                      <PriceDetail
                        label="读取"
                        value={entry.cacheReadPricePerMtok}
                        currency={entry.currency}
                        displayCurrency={displayCurrency}
                        ratesToCny={ratesToCny}
                      />
                      <PriceDetail
                        label="写入"
                        value={entry.cacheCreationPricePerMtok}
                        currency={entry.currency}
                        displayCurrency={displayCurrency}
                        ratesToCny={ratesToCny}
                      />
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <SourceBadge source={entry.source} />
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] ${
                          entry.catalogActive === false ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {entry.catalogActive === false ? '已下架' : '有效'}
                      </span>
                    </div>
                    <div
                      className="text-[10.5px] text-text-muted mt-1"
                      title={entry.updatedAt ? formatDateTime(entry.updatedAt) : undefined}
                    >
                      {entry.currency} 原价
                      {entry.updatedAt
                        ? ` · ${entry.updatedAt.slice(0, 10).replaceAll('-', '/')}`
                        : ''}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => onEdit(entry)}
                        title="编辑价格"
                        aria-label={`编辑 ${entry.model}`}
                      >
                        <Icon name="fa-pen" />
                      </button>
                      {entry.source === 'user' && (
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => onRestore(entry)}
                          title="恢复官方价格"
                          aria-label={`恢复 ${entry.model} 的官方价格`}
                        >
                          <Icon name="fa-rotate-left" />
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
  )
}

function PriceDetail({
  label,
  value,
  currency,
  displayCurrency,
  ratesToCny
}: {
  label: string
  value: number | undefined
  currency: string
  displayCurrency: DisplayCurrency
  ratesToCny: Record<string, number | undefined>
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-[130px]">
      <span className="text-text-muted">{label}</span>
      <span className="mono text-text-secondary">
        {value == null ? (
          '—'
        ) : (
          <PriceCell
            value={value}
            currency={currency}
            displayCurrency={displayCurrency}
            ratesToCny={ratesToCny}
          />
        )}
      </span>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  pageSize,
  totalCount,
  onChange
}: {
  page: number
  totalPages: number
  pageSize: number
  totalCount: number
  onChange: (page: number) => void
}) {
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, totalCount)
  return (
    <div className="mt-3 flex items-center justify-between text-[11.5px] text-text-muted">
      <span>
        显示 {first}–{last}，共 {totalCount} 条
      </span>
      <div className="flex items-center gap-2">
        <button
          className="btn btn-outline btn-xs"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <Icon name="fa-chevron-left" /> 上一页
        </button>
        <span className="font-mono px-1">
          {page} / {totalPages}
        </span>
        <button
          className="btn btn-outline btn-xs"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          下一页 <Icon name="fa-chevron-right" />
        </button>
      </div>
    </div>
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
      {isUser ? '自定义' : '官方'}
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
