/**
 * 请求日志页面:展示所有 API Key 与本地 CLI 会话的 Token 用量明细,
 * 支持按供应商/来源/日期/模型筛选、排序、分页与导出 CSV。
 * (glm-5.2)
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { fmtCount, fmtMoney } from '../../shared/utils/money'
import {
  buildRequestLogFilter,
  REQUEST_LOGS_EXPORT_LIMIT
} from '../../shared/utils/request-log-filter'
import type { UsageRecord, UsageSource } from '../../shared/types/usage'
import type { ProviderManifest } from '../../shared/types/provider'

/** 排序字段类型:按时间或按费用 */
type SortKey = 'time' | 'cost'

/** 每页条数 */
const PAGE_SIZE = 100
/** 搜索防抖时长(毫秒) */
const SEARCH_DEBOUNCE_MS = 400

/** ponytail: YYYY-MM-DD for <input type="date">. Avoids timezone drift by
 *  using local-date arithmetic in `toLocalISO`/`fromLocalISO` below.
 *
 *  将 Date 转为本地 YYYY-MM-DD 字符串,避免时区漂移。 (glm-5.2) */
function toLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 返回默认日期范围:近 30 天 */
function defaultDates(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 30)
  return { from: toLocalISO(from), to: toLocalISO(now) }
}

/** ponytail: hand-rolled CSV — escape quotes/commas/newlines, prepend BOM so
 *  Excel on Windows opens UTF-8 cleanly. No csv lib needed. */
// 手写 CSV 构建:转义引号/逗号/换行,并在开头加 BOM 以便 Windows Excel 正确识别 UTF-8。 (glm-5.2)
function buildCsv(rows: UsageRecord[]): string {
  const header =
    'time,provider,model,source,prompt_tokens,completion_tokens,cache_read_tokens,cache_creation_tokens,cost,currency,session_id'
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [header]
  for (const r of rows) {
    lines.push(
      [
        esc(r.capturedAt),
        esc(r.providerId),
        esc(r.model),
        esc(r.source),
        esc(r.promptTokens ?? ''),
        esc(r.completionTokens ?? ''),
        esc(r.cacheReadTokens ?? ''),
        esc(r.cacheCreationTokens ?? ''),
        esc(r.cost !== undefined ? r.cost.toFixed(6) : ''),
        esc(r.currency ?? ''),
        esc(r.sessionId ?? '')
      ].join(',')
    )
  }
  // ponytail: BOM lets Excel auto-detect UTF-8 (Windows Excel defaults to GBK).
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** 将日志导出为 CSV 文件并触发下载 */
function downloadCsv(rows: UsageRecord[]) {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tokenlub-logs-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 请求日志页面组件。
 * 拉取供应商与分页日志,提供筛选、排序、分页、导出与详情查看。
 */
export default function RequestLogs() {
  const [providers, setProviders] = useState<ProviderManifest[]>([])
  const [logs, setLogs] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [detail, setDetail] = useState<UsageRecord | null>(null)
  const [copied, setCopied] = useState(false)

  const init = useMemo(defaultDates, [])
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<UsageSource | 'all'>('all')
  const [fromDate, setFromDate] = useState<string>(init.from)
  const [toDate, setToDate] = useState<string>(init.to)
  const [search, setSearch] = useState<string>('')
  // ponytail: server-side model filter is debounced so we don't hammer the
  // main process on every keystroke. The local `search` still drives the
  // instant client-side highlight.
  const [committedSearch, setCommittedSearch] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('time')
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  /** 按筛选条件分页加载日志 */
  async function load(targetPage: number) {
    setLoading(true)
    try {
      const filter = buildRequestLogFilter({
        providerFilter,
        sourceFilter,
        fromDate,
        toDate,
        search: committedSearch,
        limit: PAGE_SIZE,
        offset: (targetPage - 1) * PAGE_SIZE
      })
      const result = await window.api.usage.getLogsPage(filter)
      setLogs(result.rows ?? [])
      setTotalCount(result.total ?? 0)
    } catch {
      setLogs([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    window.api.providers
      .list()
      .then((p) => {
        if (alive) setProviders(p ?? [])
      })
      .catch(() => {
        if (alive) setProviders([])
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    void load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerFilter, sourceFilter, fromDate, toDate, committedSearch, page])

  // ponytail: debounce the server-side model search so typing stays snappy.
  // Blur/Enter commits immediately for users who want a fast round-trip.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPage(1)
      setCommittedSearch(search)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [search])

  /** 提交搜索词(失焦或回车时立即生效) */
  function commitSearch() {
    setPage(1)
    setCommittedSearch(search)
  }

  /** 刷新已入库的用量后重新加载 */
  async function handleRefresh() {
    setRefreshing(true)
    try {
      await window.api.usage.refreshAll()
      await load(page)
    } finally {
      setRefreshing(false)
    }
  }

  /** 导出当前筛选下的日志为 CSV */
  async function handleExportCsv() {
    setExporting(true)
    try {
      const rows = await window.api.usage.getLogs(
        buildRequestLogFilter({
          providerFilter,
          sourceFilter,
          fromDate,
          toDate,
          search: search.trim() ? search : committedSearch,
          limit: REQUEST_LOGS_EXPORT_LIMIT
        })
      )
      downloadCsv(rows)
    } catch (e) {
      window.alert(`导出失败：${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  /** 重置全部筛选条件 */
  function handleReset() {
    setProviderFilter('all')
    setSourceFilter('all')
    const d = defaultDates()
    setFromDate(d.from)
    setToDate(d.to)
    setSearch('')
    setCommittedSearch('')
    setPage(1)
  }

  /** 切换排序字段与方向 */
  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc((d) => !d)
    } else {
      setSortKey(key)
      // ponytail: cost defaults desc (biggest spenders first); time always
      // defaults desc (newest first) — only flip direction on re-click.
      setSortDesc(key === 'cost')
    }
  }

  // ponytail: filter by model is purely client-side (cheap substring match).
  // The IPC-side filters already narrowed the result set by provider/source/
  // date-range, so this stays well under the 10k limit even on big installs.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q ? logs.filter((r) => r.model.toLowerCase().includes(q)) : logs
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'cost') {
        const av = a.cost ?? 0
        const bv = b.cost ?? 0
        return sortDesc ? bv - av : av - bv
      }
      // time
      const at = a.capturedAt ?? ''
      const bt = b.capturedAt ?? ''
      return sortDesc ? bt.localeCompare(at) : at.localeCompare(bt)
    })
    return sorted
  }, [logs, search, sortKey, sortDesc])

  const providerOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of providers) map.set(p.id, p.displayName || p.id)
    for (const r of logs) {
      if (!map.has(r.providerId)) map.set(r.providerId, r.providerId)
    }
    return [...map.entries()].map(([id, label]) => ({ id, label }))
  }, [logs, providers])

  const providerLabels = useMemo(
    () => new Map(providerOptions.map((provider) => [provider.id, provider.label])),
    [providerOptions]
  )

  const isEmpty = !loading && totalCount === 0
  const showing = visible.length
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const firstItem = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastItem = Math.min(page * PAGE_SIZE, totalCount)

  /** 排序方向箭头文本 */
  function arrow(key: SortKey): string {
    if (sortKey !== key) return ''
    return sortDesc ? ' ▼' : ' ▲'
  }

  /** 复制单条日志的原始 JSON 到剪贴板 */
  async function copyRaw(rec: UsageRecord) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rec, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ponytail: clipboard can be blocked in some Electron contexts; the
      // modal stays open so the user can manually copy from the textarea.
    }
  }

  return (
    <div className="page-content animate-in">
      <PageHeader
        title="请求日志"
        desc="所有 API Key / 本地 CLI 会话的 Token 用量明细"
        action={
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <i className="fa-solid fa-arrows-rotate" /> {refreshing ? '刷新中…' : '刷新'}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleExportCsv}
              disabled={totalCount === 0 || exporting}
            >
              <i className="fa-solid fa-arrow-up-from-bracket" />{' '}
              {exporting ? '导出中…' : '导出 CSV'}
            </button>
          </div>
        }
      />

      {/* Filter bar */}
      <Card
        className="mb-4"
        title="筛选条件"
        subtitle="按供应商、来源、日期或模型快速定位日志"
        action={
          <button className="btn btn-outline btn-sm" onClick={handleReset}>
            <i className="fa-solid fa-rotate-left" /> 重置
          </button>
        }
        bodyClassName="pt-1"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <FilterField label="供应商" className="lg:col-span-4">
            <select
              value={providerFilter}
              onChange={(event) => {
                setProviderFilter(event.target.value)
                setPage(1)
              }}
              className="select h-9 w-full text-text-primary [background-size:10px_6px]"
            >
              <option value="all">全部供应商</option>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="日志来源" className="lg:col-span-4">
            <div className="flex h-9 rounded-md border border-border-light bg-bg-base p-1">
              <SourceFilterButton
                label="全部"
                active={sourceFilter === 'all'}
                onClick={() => {
                  setSourceFilter('all')
                  setPage(1)
                }}
              />
              <SourceFilterButton
                label="API 调用"
                active={sourceFilter === 'vendor-api'}
                onClick={() => {
                  setSourceFilter('vendor-api')
                  setPage(1)
                }}
              />
              <SourceFilterButton
                label="CLI 会话"
                active={sourceFilter === 'session-log'}
                onClick={() => {
                  setSourceFilter('session-log')
                  setPage(1)
                }}
              />
            </div>
          </FilterField>

          <FilterField label="模型名称" className="lg:col-span-4">
            <div className="relative">
              <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted" />
              <input
                type="search"
                placeholder="搜索模型名称"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={commitSearch}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSearch()
                }}
                className="h-9 w-full rounded-md border border-border-light bg-bg-input py-1.5 pl-9 pr-3 text-[12.5px] text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent-dim"
              />
            </div>
          </FilterField>

          <FilterField label="日期范围" className="lg:col-span-8">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <input
                type="date"
                aria-label="开始日期"
                value={fromDate}
                max={toDate}
                onChange={(e) => {
                  setFromDate(e.target.value)
                  setPage(1)
                }}
                className="h-9 w-full rounded-md border border-border-light bg-bg-input px-3 py-1.5 text-[12.5px] text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent-dim"
              />
              <span className="text-[12px] text-text-muted">至</span>
              <input
                type="date"
                aria-label="结束日期"
                value={toDate}
                min={fromDate}
                onChange={(e) => {
                  setToDate(e.target.value)
                  setPage(1)
                }}
                className="h-9 w-full rounded-md border border-border-light bg-bg-input px-3 py-1.5 text-[12.5px] text-text-primary focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-accent-dim"
              />
            </div>
          </FilterField>
        </div>
      </Card>

      {/* Table or empty state */}
      {loading ? (
        <Card>
          <p className="text-text-muted text-[13px] py-6 text-center">加载中…</p>
        </Card>
      ) : isEmpty ? (
        <Card>
          <EmptyState
            icon="fa-clock-rotate-left"
            title="暂无日志"
            hint="请前往 API Keys 页面，使用“解析全部”或来源卡片上的“解析入库”按钮"
          />
        </Card>
      ) : (
        <Card
          title="日志明细"
          subtitle={`共 ${totalCount.toLocaleString('zh-CN')} 条记录`}
          bodyClassName="!p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed text-[12.5px]">
              <colgroup>
                <col className="w-[164px]" />
                <col className="w-[92px]" />
                <col className="w-[132px]" />
                <col className="w-[92px]" />
                <col className="w-[76px]" />
                <col className="w-[76px]" />
                <col className="w-[86px]" />
                <col className="w-[86px]" />
                <col className="w-[96px]" />
              </colgroup>
              <thead className="bg-bg-base text-left text-text-secondary">
                <tr>
                  <th
                    className="cursor-pointer select-none px-4 py-3 font-medium"
                    onClick={() => handleSort('time')}
                  >
                    时间{arrow('time')}
                  </th>
                  <th className="px-3 py-3 font-medium">供应商</th>
                  <th className="px-3 py-3 font-medium">模型</th>
                  <th className="px-3 py-3 font-medium">来源</th>
                  <th className="px-3 py-3 text-right font-medium">输入量</th>
                  <th className="px-3 py-3 text-right font-medium">输出量</th>
                  <th className="px-3 py-3 text-right font-medium">缓存读取</th>
                  <th className="px-3 py-3 text-right font-medium">缓存写入</th>
                  <th
                    className="cursor-pointer select-none px-4 py-3 text-right font-medium"
                    onClick={() => handleSort('cost')}
                  >
                    费用{arrow('cost')}
                  </th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                {visible.map((r, i) => (
                  <tr
                    key={r.id ?? `${r.capturedAt}-${i}`}
                    onClick={() => setDetail(r)}
                    className="cursor-pointer border-t border-border-light transition-colors hover:bg-bg-hover"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11.5px] tabular-nums text-text-secondary">
                      {r.capturedAt ? r.capturedAt.replace('T', ' ').slice(0, 19) : '—'}
                    </td>
                    <td className="truncate px-3 py-3" title={providerLabels.get(r.providerId)}>
                      {providerLabels.get(r.providerId) ?? r.providerId}
                    </td>
                    <td className="truncate px-3 py-3 font-mono" title={r.model}>
                      {r.model || '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          r.source === 'vendor-api'
                            ? 'inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] bg-status-blue-dim text-status-blue'
                            : 'inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] bg-status-amber-dim text-status-amber'
                        }
                      >
                        {sourceLabel(r.source)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {r.promptTokens !== undefined ? fmtCount(r.promptTokens) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {r.completionTokens !== undefined ? fmtCount(r.completionTokens) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {r.cacheReadTokens !== undefined ? fmtCount(r.cacheReadTokens) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {r.cacheCreationTokens !== undefined ? fmtCount(r.cacheCreationTokens) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium tabular-nums">
                      {r.cost !== undefined ? fmtMoney(r.cost, r.currency ?? 'CNY') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer */}
            <div className="flex items-center justify-between gap-4 border-t border-border-light px-5 py-4">
              <span className="text-[12px] text-text-muted">
                第 {page.toLocaleString('en-US')} / {totalPages.toLocaleString('en-US')} 页， 显示{' '}
                {firstItem.toLocaleString('en-US')}-{lastItem.toLocaleString('en-US')} /{' '}
                {totalCount.toLocaleString('en-US')} 条日志
                {showing !== logs.length
                  ? `（当前页匹配 ${showing.toLocaleString('en-US')} 条）`
                  : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <i className="fa-solid fa-chevron-left" /> 上一页
                </button>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={page}
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    if (Number.isFinite(next)) {
                      setPage(Math.min(totalPages, Math.max(1, Math.floor(next))))
                    }
                  }}
                  className="w-[72px] border border-border-light rounded px-2 py-1 text-[12.5px] text-center text-text-primary bg-bg-input focus:outline-none focus:border-border-focus"
                  aria-label="页码"
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  下一页 <i className="fa-solid fa-chevron-right" />
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {detail && (
        <Modal title="请求详情" onClose={() => setDetail(null)}>
          <div className="space-y-2 text-[12.5px]">
            <DetailRow k="ID" v={detail.id !== undefined ? String(detail.id) : '—'} mono />
            <DetailRow k="Captured" v={detail.capturedAt || '—'} mono />
            <DetailRow k="Provider" v={detail.providerId} />
            <DetailRow k="Model" v={detail.model || '—'} mono />
            <DetailRow k="Source" v={detail.source} />
            <DetailRow k="API Key" v={detail.apiKeyId ?? '—'} mono />
            <DetailRow k="Session" v={detail.sessionId ?? '—'} mono />
            <DetailRow k="Message" v={detail.messageId ?? '—'} mono />
            <DetailRow
              k="Period"
              v={`${detail.periodStart ?? '—'} → ${detail.periodEnd ?? '—'}`}
              mono
            />
            <DetailRow
              k="Prompt"
              v={detail.promptTokens !== undefined ? fmtCount(detail.promptTokens) : '—'}
            />
            <DetailRow
              k="Completion"
              v={detail.completionTokens !== undefined ? fmtCount(detail.completionTokens) : '—'}
            />
            <DetailRow
              k="Cache Read"
              v={detail.cacheReadTokens !== undefined ? fmtCount(detail.cacheReadTokens) : '—'}
            />
            <DetailRow
              k="Cache Create"
              v={
                detail.cacheCreationTokens !== undefined
                  ? fmtCount(detail.cacheCreationTokens)
                  : '—'
              }
            />
            <DetailRow
              k="Total"
              v={detail.totalTokens !== undefined ? fmtCount(detail.totalTokens) : '—'}
            />
            <DetailRow
              k="Cost"
              v={detail.cost !== undefined ? fmtMoney(detail.cost, detail.currency ?? 'CNY') : '—'}
            />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11.5px] text-text-muted">{copied ? '已复制' : 'JSON 快照'}</span>
            <button className="btn btn-outline btn-sm" onClick={() => copyRaw(detail)}>
              <i className="fa-regular fa-copy" /> 复制 raw JSON
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** 筛选字段:统一标签和控件的垂直节奏 */
function FilterField({
  label,
  className,
  children
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <span className="mb-1.5 block text-[11.5px] font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  )
}

/** 来源分段按钮:在紧凑空间内保持清晰的选中状态 */
function SourceFilterButton({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'flex-1 rounded-sm bg-bg-card px-2 text-[11.5px] font-medium text-accent-text shadow-sm'
          : 'flex-1 rounded-sm px-2 text-[11.5px] text-text-secondary transition-colors hover:text-text-primary'
      }
    >
      {label}
    </button>
  )
}

/** 将内部来源枚举转换为用户可读中文 */
function sourceLabel(source: UsageSource): string {
  return source === 'vendor-api' ? 'API 调用' : 'CLI 会话'
}

/** 详情行:标签 + 值,可选等宽字体 */
function DetailRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-text-muted w-[88px] flex-shrink-0">{k}</span>
      <span
        className={`text-text-primary flex-1 break-all ${mono ? 'font-mono text-[11.5px]' : ''}`}
      >
        {v}
      </span>
    </div>
  )
}
