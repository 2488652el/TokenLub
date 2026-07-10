/**
 * 请求日志页面:展示所有 API Key 与本地 CLI 会话的 Token 用量明细,
 * 支持按供应商/来源/日期/模型筛选、排序、分页、跳转日期与导出 CSV。
 * (glm-5.2)
 */
import { useEffect, useMemo, useState } from 'react'
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
 * 拉取供应商与分页日志,提供筛选、排序、分页、跳转、导出与详情查看。
 */
export default function RequestLogs() {
  const [providers, setProviders] = useState<ProviderManifest[]>([])
  const [logs, setLogs] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [detail, setDetail] = useState<UsageRecord | null>(null)
  const [copied, setCopied] = useState(false)

  const init = useMemo(defaultDates, [])
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<UsageSource | 'all'>('all')
  const [fromDate, setFromDate] = useState<string>(init.from)
  const [toDate, setToDate] = useState<string>(init.to)
  const [jumpDate, setJumpDate] = useState<string>(init.to)
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

  /** 同步 CLI 日志并刷新用量后重新加载 */
  async function handleRefresh() {
    setRefreshing(true)
    try {
      await window.api.log.sync('claude-code').catch(() => ({ started: false }))
      await window.api.log.sync('codex').catch(() => ({ started: false }))
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
    setJumpDate(d.to)
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

  /** 同步本机 Claude/Codex 会话日志后重新加载 */
  async function handleSyncBoth() {
    setSyncing(true)
    try {
      await window.api.log.sync('claude-code').catch(() => ({ started: false }))
      await window.api.log.sync('codex').catch(() => ({ started: false }))
      await load(page)
    } finally {
      setSyncing(false)
    }
  }

  /** 跳转到指定日期 */
  function handleJumpToDate() {
    if (!jumpDate) return
    setFromDate(jumpDate)
    setToDate(jumpDate)
    setSortKey('time')
    setSortDesc(true)
    setPage(1)
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
              <i className="fa-solid fa-arrows-rotate" /> {refreshing ? '同步中…' : '同步刷新'}
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
      <Card className="mb-4" bodyClassName="">
        <div className="px-5 py-4 space-y-3">
          {/* Provider chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-text-muted mr-1">Provider:</span>
            <FilterChip
              label="全部"
              active={providerFilter === 'all'}
              onClick={() => {
                setProviderFilter('all')
                setPage(1)
              }}
            />
            {providerOptions.map((p) => (
              <FilterChip
                key={p.id}
                label={p.label}
                active={providerFilter === p.id}
                onClick={() => {
                  setProviderFilter(p.id)
                  setPage(1)
                }}
              />
            ))}
          </div>

          {/* Source chips + dates + search */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-text-muted">来源:</span>
              <FilterChip
                label="全部"
                active={sourceFilter === 'all'}
                onClick={() => {
                  setSourceFilter('all')
                  setPage(1)
                }}
              />
              <FilterChip
                label="vendor-api"
                active={sourceFilter === 'vendor-api'}
                onClick={() => {
                  setSourceFilter('vendor-api')
                  setPage(1)
                }}
              />
              <FilterChip
                label="session-log"
                active={sourceFilter === 'session-log'}
                onClick={() => {
                  setSourceFilter('session-log')
                  setPage(1)
                }}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-text-muted">从</span>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => {
                  setFromDate(e.target.value)
                  setPage(1)
                }}
                className="border border-border-light rounded px-2 py-1 text-[12.5px] text-text-primary bg-bg-input focus:outline-none focus:border-border-focus"
              />
              <span className="text-[12px] text-text-muted">到</span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => {
                  setToDate(e.target.value)
                  setPage(1)
                }}
                className="border border-border-light rounded px-2 py-1 text-[12.5px] text-text-primary bg-bg-input focus:outline-none focus:border-border-focus"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-text-muted">跳转日期</span>
              <input
                type="date"
                value={jumpDate}
                onChange={(e) => setJumpDate(e.target.value)}
                className="border border-border-light rounded px-2 py-1 text-[12.5px] text-text-primary bg-bg-input focus:outline-none focus:border-border-focus"
              />
              <button className="btn btn-outline btn-sm" onClick={handleJumpToDate}>
                <i className="fa-regular fa-calendar-check" /> 跳转
              </button>
            </div>

            <div className="flex-1 min-w-[160px] max-w-[280px]">
              <input
                type="search"
                placeholder="搜索 Model…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={commitSearch}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSearch()
                }}
                className="w-full border border-border-light rounded px-3 py-1.5 text-[12.5px] text-text-primary bg-bg-input focus:outline-none focus:border-border-focus"
              />
            </div>

            <button className="btn btn-outline btn-sm" onClick={handleReset}>
              <i className="fa-solid fa-rotate-left" /> 清空筛选
            </button>
          </div>
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
            hint="可在 API Keys 统一管理本机会话解析，也可以直接扫描本机日志"
            action={
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSyncBoth}
                disabled={syncing}
              >
                <i className="fa-solid fa-arrows-rotate" />{' '}
                {syncing ? '扫描中…' : '扫描本机 Session 日志'}
              </button>
            }
          />
        </Card>
      ) : (
        <Card bodyClassName="">
          <div className="px-5 py-4 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="text-text-muted text-left">
                <tr>
                  <th
                    className="py-2 font-medium cursor-pointer select-none"
                    onClick={() => handleSort('time')}
                  >
                    Time{arrow('time')}
                  </th>
                  <th className="py-2 font-medium">Provider</th>
                  <th className="py-2 font-medium">Model</th>
                  <th className="py-2 font-medium">Source</th>
                  <th className="py-2 font-medium text-right">Prompt</th>
                  <th className="py-2 font-medium text-right">Completion</th>
                  <th className="py-2 font-medium text-right">Cache Read</th>
                  <th className="py-2 font-medium text-right">Cache Create</th>
                  <th
                    className="py-2 font-medium text-right cursor-pointer select-none"
                    onClick={() => handleSort('cost')}
                  >
                    Cost{arrow('cost')}
                  </th>
                  <th className="py-2 font-medium">Currency</th>
                </tr>
              </thead>
              <tbody className="text-text-primary">
                {visible.map((r, i) => (
                  <tr
                    key={r.id ?? `${r.capturedAt}-${i}`}
                    onClick={() => setDetail(r)}
                    className="border-t border-border-light cursor-pointer hover:bg-bg-hover transition-colors"
                  >
                    <td className="py-2 whitespace-nowrap text-text-secondary font-mono text-[11.5px]">
                      {r.capturedAt ? r.capturedAt.replace('T', ' ').slice(0, 19) : '—'}
                    </td>
                    <td className="py-2">{r.providerId}</td>
                    <td className="py-2 font-mono max-w-[220px] truncate" title={r.model}>
                      {r.model || '—'}
                    </td>
                    <td className="py-2">
                      <span
                        className={
                          r.source === 'vendor-api'
                            ? 'px-1.5 py-[1px] rounded text-[11px] bg-status-blue-dim text-status-blue'
                            : 'px-1.5 py-[1px] rounded text-[11px] bg-status-amber-dim text-status-amber'
                        }
                      >
                        {r.source}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">
                      {r.promptTokens !== undefined ? fmtCount(r.promptTokens) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {r.completionTokens !== undefined ? fmtCount(r.completionTokens) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {r.cacheReadTokens !== undefined ? fmtCount(r.cacheReadTokens) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {r.cacheCreationTokens !== undefined ? fmtCount(r.cacheCreationTokens) : '—'}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {r.cost !== undefined ? fmtMoney(r.cost, r.currency ?? 'CNY') : '—'}
                    </td>
                    <td className="py-2 text-text-muted">{r.currency ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-light">
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

/** 筛选胶囊按钮:高亮当前选中项 */
function FilterChip({
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
      className={
        active
          ? 'px-2.5 py-[3px] rounded-full text-[11.5px] font-medium bg-accent-dim text-accent-text border border-accent-border'
          : 'px-2.5 py-[3px] rounded-full text-[11.5px] text-text-secondary bg-bg-base border border-border-light hover:border-border-default'
      }
    >
      {label}
    </button>
  )
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
