/**
 * API Keys 管理页面:展示所有密钥卡片、本机 Session 日志解析面板、
 * 搜索与按供应商筛选,以及创建/编辑/导入/测试/删除/刷新/用量查询开关等操作。
 * (glm-5.2)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { ApiKeyCard, providerLabel } from '../components/ApiKeyCard'
import { CreateKeyModal } from '../components/CreateKeyModal'
import { EditKeyModal } from '../components/EditKeyModal'
import { ProviderIcon } from '../components/ProviderIcon'
import { fmtCount } from '../../shared/utils/money'
import type { ApiKeyCreateInput, ApiKeyRecord, ApiKeyUpdateInput } from '../../shared/types/api-key'
import type { UsageRecord } from '../../shared/types/usage'
import type { BalanceSnapshot, ProviderManifest } from '../../shared/types/provider'
import type { ProviderCatalogEntry } from '../../shared/provider-catalog'

type SessionSource = 'claude-code' | 'codex'

type SessionCounts = {
  claude: number
  codex: number
}

type SessionSyncTotals = {
  lines: number
  tokens: number
  inserted: number
}

type SessionStats = Record<
  SessionSource,
  {
    requests: number
    tokens: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    sessions: number
    models: number
    lastCapturedAt?: string
  }
>

/** localStorage/settings 中控制自动解析的 key */
const SESSION_AUTO_SYNC_KEY = 'session_auto_parse_enabled'

/** 来源显示名映射 */
const SESSION_LABEL: Record<SessionSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI'
}

/** 来源到 SessionCounts 字段名的映射 */
const SESSION_COUNT_KEY: Record<SessionSource, keyof SessionCounts> = {
  'claude-code': 'claude',
  codex: 'codex'
}

/** 来源到本机扫描路径的映射(用于展示) */
const SESSION_PATH: Record<SessionSource, string> = {
  'claude-code': '%USERPROFILE%\\.claude\\projects\\',
  codex: '%USERPROFILE%\\.codex\\sessions\\'
}

/** 空统计对象,用于初始化与重置 */
const EMPTY_SESSION_STATS: SessionStats = {
  'claude-code': {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    models: 0
  },
  codex: {
    requests: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sessions: 0,
    models: 0
  }
}

/**
 * API Keys 管理页面组件。
 * 管理密钥列表、Session 解析、筛选与增删改查操作。
 */
export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [providers, setProviders] = useState<ProviderManifest[]>([])
  const [catalog, setCatalog] = useState<readonly ProviderCatalogEntry[]>([])
  const [balances, setBalances] = useState<
    Array<BalanceSnapshot & { id: number; apiKeyId?: string }>
  >([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<ApiKeyRecord | null>(null)
  const [importing, setImporting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sessionCounts, setSessionCounts] = useState<SessionCounts | null>(null)
  const [sessionStats, setSessionStats] = useState<SessionStats>(EMPTY_SESSION_STATS)
  const [sessionAutoParse, setSessionAutoParse] = useState(false)
  const [sessionAutoLoaded, setSessionAutoLoaded] = useState(false)
  const [sessionSyncing, setSessionSyncing] = useState<Set<SessionSource>>(() => new Set())
  const [sessionProgress, setSessionProgress] = useState<
    Partial<Record<SessionSource, { file: string; lines: number; tokens: number }>>
  >({})
  const [sessionDone, setSessionDone] = useState<
    Partial<Record<SessionSource, { totals: SessionSyncTotals; error?: string }>>
  >({})
  const autoParsedRef = useRef(false)
  const unsubProgress = useRef<(() => void) | null>(null)
  const unsubDone = useRef<(() => void) | null>(null)
  // ponytail: simplest possible filter — a single text query + a single
  // providerId chip selection. No debounce; the list is bounded (<200 rows).
  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState<string | null>(null)

  /** 刷新密钥、供应商目录与余额列表 */
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [k, p, c, b] = await Promise.all([
        window.api.keys.list(),
        window.api.providers.list().catch(() => []),
        window.api.providers.catalog().catch(() => []),
        window.api.balance.latest().catch(() => [])
      ])
      setKeys(k)
      setProviders(p)
      setCatalog(c)
      setBalances(b)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 刷新 Session 统计:发现会话文件并重新构建用量统计 */
  const refreshSessionStats = useCallback(async () => {
    const [files, logs] = await Promise.all([
      window.api.log.discover().catch(() => ({ claude: [], codex: [] })),
      window.api.usage.getLogs({ source: 'session-log', limit: 10000 }).catch(() => [])
    ])
    setSessionCounts({ claude: files.claude.length, codex: files.codex.length })
    setSessionStats(buildSessionStats(logs))
  }, [])

  /** 同步指定来源的 Session 日志:发现文件、触发解析、更新统计 */
  const syncSessionSource = useCallback(
    async (source: SessionSource) => {
      setSessionSyncing((prev) => new Set(prev).add(source))
      setSessionDone((prev) => {
        const next = { ...prev }
        delete next[source]
        return next
      })
      setSessionProgress((prev) => {
        const next = { ...prev }
        delete next[source]
        return next
      })

      try {
        const files = await window.api.log.discover()
        setSessionCounts({ claude: files.claude.length, codex: files.codex.length })
        const count = files[SESSION_COUNT_KEY[source]].length
        if (count === 0) {
          setSessionSyncing((prev) => {
            const next = new Set(prev)
            next.delete(source)
            return next
          })
          return
        }
        await window.api.log.sync(source)
        await refreshSessionStats()
      } catch (e) {
        setSessionDone((prev) => ({
          ...prev,
          [source]: {
            totals: { lines: 0, tokens: 0, inserted: 0 },
            error: (e as Error).message
          }
        }))
      } finally {
        setSessionSyncing((prev) => {
          const next = new Set(prev)
          next.delete(source)
          return next
        })
      }
    },
    [refreshSessionStats]
  )

  /** 同步全部来源(claude-code 与 codex)的 Session 日志 */
  const syncAllSessions = useCallback(async () => {
    await syncSessionSource('claude-code')
    await syncSessionSource('codex')
  }, [syncSessionSource])

  /** 加载 Session 面板:读取自动解析设置并刷新统计 */
  const loadSessionPanel = useCallback(async () => {
    try {
      const [settings] = await Promise.all([window.api.settings.get(), refreshSessionStats()])
      setSessionAutoParse(settings[SESSION_AUTO_SYNC_KEY] === true)
    } finally {
      setSessionAutoLoaded(true)
    }
  }, [refreshSessionStats])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    unsubProgress.current = window.api.log.onSyncProgress((payload) => {
      if (payload.source !== 'claude-code' && payload.source !== 'codex') return
      setSessionProgress((prev) => ({
        ...prev,
        [payload.source]: {
          file: payload.file,
          lines: payload.lines,
          tokens: payload.tokens
        }
      }))
    })

    unsubDone.current = window.api.log.onSyncDone((payload) => {
      if (payload.source !== 'claude-code' && payload.source !== 'codex') return
      const source = payload.source
      setSessionDone((prev) => ({
        ...prev,
        [source]: {
          totals: payload.totals,
          ...(payload.error ? { error: payload.error } : {})
        }
      }))
      setSessionSyncing((prev) => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
      void refreshSessionStats()
    })

    return () => {
      unsubProgress.current?.()
      unsubDone.current?.()
    }
  }, [refreshSessionStats])

  useEffect(() => {
    void loadSessionPanel()
  }, [loadSessionPanel])

  useEffect(() => {
    if (!sessionAutoLoaded || !sessionAutoParse || autoParsedRef.current) return
    autoParsedRef.current = true
    void syncAllSessions()
  }, [sessionAutoLoaded, sessionAutoParse, syncAllSessions])

  /** 计算可选供应商筛选列表(去重并排序) */
  const providerOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const k of keys) seen.add(k.providerId)
    return Array.from(seen).sort()
  }, [keys])

  /** 按搜索词与供应商筛选后的密钥列表 */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return keys.filter((k) => {
      if (providerFilter && k.providerId !== providerFilter) return false
      if (q && !k.alias.toLowerCase().includes(q) && !k.providerId.toLowerCase().includes(q))
        return false
      return true
    })
  }, [keys, search, providerFilter])

  /** 创建新 Key 的保存回调 */
  async function handleSave(
    input: ApiKeyCreateInput,
    notes: { adminKeyStored: boolean; platformCookieStored: boolean }
  ) {
    try {
      await window.api.keys.add(input)
      setCreateOpen(false)
      await refresh()
      if (notes.platformCookieStored) {
        window.alert(
          '已保存。LongCat 平台 Cookie 已通过本机加密存储,刷新时会读取 Token 资源包余额。'
        )
        return
      }
      if (notes.adminKeyStored) {
        window.alert('已保存。Admin Key 已通过本机加密存储,刷新和测试连接会优先使用它。')
      }
    } catch (e) {
      window.alert(`创建失败：${(e as Error).message}`)
    }
  }

  /** 编辑 Key 的保存回调 */
  async function handleUpdate(input: ApiKeyUpdateInput) {
    try {
      await window.api.keys.update(input)
      setEditingKey(null)
      await refresh()
    } catch (e) {
      window.alert(`更新失败：${(e as Error).message}`)
    }
  }

  /** 删除 Key(带确认弹窗) */
  async function handleDelete(k: ApiKeyRecord) {
    if (
      !window.confirm(
        `确认删除 "${k.alias}" (${k.providerId}, key 末位 …${k.keyTail})?\n此操作不可撤销。`
      )
    )
      return
    await window.api.keys.delete(k.id)
    await refresh()
  }

  /** 测试 Key 连通性并展示结果 */
  async function handleTest(id: string, alias: string) {
    try {
      const r = await window.api.keys.test(id)
      const msg = `${alias}：${r.ok ? '✅ ' + r.message : '❌ ' + r.message}`
      window.alert(r.ok ? msg : `${msg}${hintForError(r.message)}`)
    } catch (e) {
      const msg = `${alias}：❌ ${(e as Error).message}`
      window.alert(`${msg}${hintForError((e as Error).message)}`)
    }
  }

  // ponytail: cheap string-match hint for common HTTP error codes. Not a real
  // parser - just enough to nudge the user toward the obvious next step.
  //
  // 根据常见 HTTP 错误码给出简要提示文本。 (glm-5.2)
  function hintForError(message: string): string {
    if (message.includes('401')) return ' → 检查 API key 是否正确 / 余额是否充足'
    if (message.includes('403')) return ' → 该 key 可能无权访问此资源'
    if (message.includes('429')) return ' → 调用频率过高,稍后重试'
    return ''
  }

  /** 从本机 CLI 凭据导入 Key */
  async function handleImportCLI(source: 'claude' | 'codex') {
    setImporting(true)
    try {
      const r = await window.api.keys.importFromCLI(source)
      if (r.imported && r.key) {
        window.alert(
          `已导入 ${source === 'claude' ? 'Claude Code' : 'Codex CLI'} 密钥 → "${r.key.alias}"`
        )
        await refresh()
      } else {
        window.alert(r.reason ?? '未找到已安装的 CLI 密钥')
      }
    } catch (e) {
      window.alert(`导入失败：${(e as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  // ponytail: PR-3/4 wiring — per-key usage toggle round-trips through
  // window.api.keys.setUsageQuery and re-reads the list so the in-memory
  // record stays consistent with the repo.
  //
  // 切换单个 Key 的用量查询开关。 (glm-5.2)
  async function handleToggleUsage(id: string, enabled: boolean) {
    try {
      await window.api.keys.setUsageQuery(id, enabled)
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, usageQueryEnabled: enabled } : k)))
    } catch (e) {
      window.alert(`更新用量查询开关失败：${(e as Error).message}`)
    }
  }

  // ponytail: PR-4 only ships `refreshAll` (no per-key IPC). We invoke it
  // without an alert - treat it as a lightweight nudge and silently reload
  // so the user can see whether the bar moved.
  //
  // 刷新单个 Key 余额:实际调用 refreshAll 并静默重载列表。 (glm-5.2)
  async function handleRefreshOne() {
    try {
      await window.api.usage.refreshAll()
      await refresh()
    } catch (e) {
      window.alert(`刷新失败：${(e as Error).message}`)
    }
  }

  /** 切换自动解析开关并持久化设置 */
  async function changeSessionAutoParse(enabled: boolean) {
    const prev = sessionAutoParse
    setSessionAutoParse(enabled)
    try {
      await window.api.settings.set(SESSION_AUTO_SYNC_KEY, enabled)
      if (enabled) {
        autoParsedRef.current = true
        await syncAllSessions()
      }
    } catch (e) {
      setSessionAutoParse(prev)
      window.alert(`更新自动解析开关失败：${(e as Error).message}`)
    }
  }

  // ponytail: latest-by-key map for the balance summary field. Mirrors the
  // same pattern used in BalanceQuery so the two pages never disagree.
  //
  // 按 apiKeyId 保留最新一条余额快照,供卡片展示。 (glm-5.2)
  const latestByKey = useMemo(() => {
    const m = new Map<string, BalanceSnapshot & { id: number; apiKeyId?: string }>()
    for (const b of balances) {
      if (!b.apiKeyId) continue
      const prev = m.get(b.apiKeyId)
      if (!prev || Date.parse(b.capturedAt) > Date.parse(prev.capturedAt)) {
        m.set(b.apiKeyId, b)
      }
    }
    return m
  }, [balances])

  const anyFilter = !!providerFilter || search.trim() !== ''

  return (
    <div className="page-content animate-in">
      <PageHeader
        title="API Keys"
        desc="管理你的 API 密钥,Windows DPAPI 加密存储"
        action={
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline btn-sm"
              onClick={() => handleImportCLI('claude')}
              disabled={importing}
              title="从 ~/.claude/.credentials.json 或 ANTHROPIC_API_KEY 环境变量检测"
            >
              <i className="fa-solid fa-file-import" /> 导入 Claude
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => handleImportCLI('codex')}
              disabled={importing}
              title="从 ~/.codex/auth.json 或 OPENAI_API_KEY 环境变量检测"
            >
              <i className="fa-solid fa-file-import" /> 导入 Codex
            </button>
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <i className="fa-solid fa-plus" /> 创建新 Key
            </button>
          </div>
        }
      />

      {loading ? (
        <Card>
          <EmptyState icon="fa-spinner" title="加载中…" hint="读取本地加密数据库" />
        </Card>
      ) : keys.length === 0 ? (
        <Card>
          <EmptyState
            icon="fa-key"
            title="尚未添加任何 Key"
            hint="点击右上角 '创建新 Key' 或 '导入 Claude/Codex'"
            action={
              <div className="flex items-center gap-2 mt-2">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleImportCLI('claude')}
                  disabled={importing}
                >
                  <i className="fa-solid fa-file-import" /> 导入 Claude
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleImportCLI('codex')}
                  disabled={importing}
                >
                  <i className="fa-solid fa-file-import" /> 导入 Codex
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                  <i className="fa-solid fa-plus" /> 创建新 Key
                </button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="mb-3" bodyClassName="py-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-[13px] font-medium text-text-primary">本机 Session 解析</div>
                <p className="text-[12px] text-text-muted mt-1">
                  统一管理 Claude Code / Codex CLI 的本机会话日志，解析后会进入请求日志和用量统计。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
                    sessionAutoParse
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
                  }`}
                  onClick={() => void changeSessionAutoParse(!sessionAutoParse)}
                  disabled={!sessionAutoLoaded || sessionSyncing.size > 0}
                  title={sessionAutoParse ? '点击关闭自动解析' : '点击开启自动解析'}
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      sessionAutoParse ? 'bg-emerald-500' : 'bg-neutral-400'
                    }`}
                  />
                  自动解析:{sessionAutoParse ? ' 开' : ' 关'}
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => void syncAllSessions()}
                  disabled={sessionSyncing.size > 0}
                >
                  <i className="fa-solid fa-code-branch" /> 解析全部
                </button>
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-4 mb-3 max-md:grid-cols-1">
            <SessionUsageCard
              source="claude-code"
              counts={sessionCounts}
              stats={sessionStats['claude-code']}
              syncing={sessionSyncing.has('claude-code')}
              progress={sessionProgress['claude-code']}
              done={sessionDone['claude-code']}
              onSync={syncSessionSource}
            />
            <SessionUsageCard
              source="codex"
              counts={sessionCounts}
              stats={sessionStats.codex}
              syncing={sessionSyncing.has('codex')}
              progress={sessionProgress.codex}
              done={sessionDone.codex}
              onSync={syncSessionSource}
            />
          </div>
          <Card className="mb-3" bodyClassName="py-3">
            <div className="flex items-center gap-4 flex-wrap text-[12.5px]">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <i className="fa-solid fa-magnifying-glass text-text-muted text-[12px]" />
                <input
                  className="input flex-1"
                  placeholder="搜索 alias 或 provider"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-text-muted">Provider</span>
                <FilterChip active={!providerFilter} onClick={() => setProviderFilter(null)}>
                  全部
                </FilterChip>
                {providerOptions.map((p) => (
                  <FilterChip
                    key={p}
                    active={providerFilter === p}
                    onClick={() => setProviderFilter(providerFilter === p ? null : p)}
                  >
                    <ProviderIcon providerId={p} title={providerLabel(p, providers)} size={14} />
                    <span>{p}</span>
                  </FilterChip>
                ))}
                {anyFilter && (
                  <button
                    className="btn btn-outline btn-xs"
                    onClick={() => {
                      setSearch('')
                      setProviderFilter(null)
                    }}
                  >
                    <i className="fa-solid fa-xmark" /> 清空筛选
                  </button>
                )}
              </div>
            </div>
          </Card>
          {filtered.length === 0 ? (
            <Card>
              <div className="text-center text-text-muted py-8 text-[13px]">
                当前筛选下没有条目。
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
              {filtered.map((k) => (
                <ApiKeyCard
                  key={k.id}
                  keyRecord={k}
                  balance={latestByKey.get(k.id)}
                  providerDisplayName={providerLabel(k.providerId, providers)}
                  onEdit={setEditingKey}
                  onTest={handleTest}
                  onDelete={handleDelete}
                  onRefreshOne={handleRefreshOne}
                  onToggleUsage={handleToggleUsage}
                />
              ))}
            </div>
          )}
          {keys.length > 0 && (
            <div className="pt-3 mt-2 text-[12px] text-text-muted flex items-center justify-between">
              <span>
                共 {keys.length} 条 {anyFilter && `· 显示 ${filtered.length} 条`}
              </span>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <CreateKeyModal
          catalog={catalog}
          onClose={() => setCreateOpen(false)}
          onSave={handleSave}
        />
      )}
      {editingKey && (
        <EditKeyModal
          keyRecord={editingKey}
          catalog={catalog}
          onClose={() => setEditingKey(null)}
          onSave={handleUpdate}
        />
      )}
    </div>
  )
}

/** 从请求日志构建按来源汇总的 Session 用量统计 */
function buildSessionStats(rows: UsageRecord[]): SessionStats {
  const out: SessionStats = {
    'claude-code': { ...EMPTY_SESSION_STATS['claude-code'] },
    codex: { ...EMPTY_SESSION_STATS.codex }
  }
  const sessions: Record<SessionSource, Set<string>> = {
    'claude-code': new Set(),
    codex: new Set()
  }
  const models: Record<SessionSource, Set<string>> = {
    'claude-code': new Set(),
    codex: new Set()
  }

  for (const row of rows) {
    if (row.providerId !== 'claude-code' && row.providerId !== 'codex') continue
    const source = row.providerId
    const stat = out[source]
    stat.requests++
    stat.inputTokens += row.promptTokens ?? 0
    stat.outputTokens += row.completionTokens ?? 0
    stat.cacheReadTokens += row.cacheReadTokens ?? 0
    stat.cacheCreationTokens += row.cacheCreationTokens ?? 0
    stat.tokens += row.totalTokens ?? (row.promptTokens ?? 0) + (row.completionTokens ?? 0)
    if (row.sessionId) sessions[source].add(row.sessionId)
    if (row.model) models[source].add(row.model)
    if (!stat.lastCapturedAt || Date.parse(row.capturedAt) > Date.parse(stat.lastCapturedAt)) {
      stat.lastCapturedAt = row.capturedAt
    }
  }

  for (const source of Object.keys(out) as SessionSource[]) {
    out[source].sessions = sessions[source].size
    out[source].models = models[source].size
  }

  return out
}

/** 单个来源的 Session 用量卡片:展示会话文件数、请求、Token 与同步状态 */
function SessionUsageCard({
  source,
  counts,
  stats,
  syncing,
  progress,
  done,
  onSync
}: {
  source: SessionSource
  counts: SessionCounts | null
  stats: SessionStats[SessionSource]
  syncing: boolean
  progress?: { file: string; lines: number; tokens: number } | undefined
  done?: { totals: SessionSyncTotals; error?: string } | undefined
  onSync: (source: SessionSource) => Promise<void>
}) {
  const fileCount = counts?.[SESSION_COUNT_KEY[source]] ?? 0
  const hasUsage = stats.requests > 0 || stats.tokens > 0

  return (
    <Card
      title={SESSION_LABEL[source]}
      subtitle={`扫描 ${SESSION_PATH[source]}`}
      iconNode={<ProviderIcon providerId={source} title={SESSION_LABEL[source]} size={18} />}
      action={
        <button
          className="btn btn-outline btn-sm"
          onClick={() => void onSync(source)}
          disabled={syncing}
        >
          {syncing ? '解析中…' : '解析入库'}
        </button>
      }
    >
      <div className="space-y-3 text-[13px]">
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric label="会话文件" value={counts === null ? '—' : fmtCount(fileCount)} />
          <MiniMetric label="请求记录" value={fmtCount(stats.requests)} />
          <MiniMetric label="Tokens" value={fmtCount(stats.tokens)} />
        </div>
        <div className="rounded border border-border-light bg-bg-base/40 px-2 py-1.5 space-y-1">
          <StatRow
            label="输入 / 输出"
            value={`${fmtCount(stats.inputTokens)} / ${fmtCount(stats.outputTokens)}`}
          />
          <StatRow
            label="缓存读 / 写"
            value={`${fmtCount(stats.cacheReadTokens)} / ${fmtCount(stats.cacheCreationTokens)}`}
          />
          <StatRow
            label="Session / 模型"
            value={`${fmtCount(stats.sessions)} / ${fmtCount(stats.models)}`}
          />
          <StatRow
            label="最近记录"
            value={stats.lastCapturedAt ? stats.lastCapturedAt.slice(0, 16).replace('T', ' ') : '—'}
          />
        </div>
        <SessionStatus
          source={source}
          fileCount={fileCount}
          hasUsage={hasUsage}
          syncing={syncing}
          progress={progress}
          done={done}
        />
      </div>
    </Card>
  )
}

/** 小型指标块:标签 + 等宽数值 */
function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border-light bg-bg-base/40 px-2 py-2 min-w-0">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="font-mono text-[13px] font-medium text-text-primary truncate">{value}</div>
    </div>
  )
}

/** 统计行:标签 + 等宽值 */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text-secondary text-right">{value}</span>
    </div>
  )
}

/** Session 同步状态文本:按解析中/完成/失败/空等状态展示对应提示 */
function SessionStatus({
  source,
  fileCount,
  hasUsage,
  syncing,
  progress,
  done
}: {
  source: SessionSource
  fileCount: number
  hasUsage: boolean
  syncing: boolean
  progress?: { file: string; lines: number; tokens: number } | undefined
  done?: { totals: SessionSyncTotals; error?: string } | undefined
}) {
  if (done?.error) {
    return (
      <p className="text-[12px] text-status-red">
        {SESSION_LABEL[source]} 解析失败：{done.error}
      </p>
    )
  }

  if (syncing && progress) {
    return (
      <p className="text-[12px] text-text-secondary animate-pulse">
        正在解析 {progress.file}：{progress.lines.toLocaleString('en-US')} 行 /{' '}
        {progress.tokens.toLocaleString('en-US')} tokens
      </p>
    )
  }

  if (syncing) {
    return <p className="text-[12px] text-text-secondary animate-pulse">正在解析本机会话日志…</p>
  }

  if (done) {
    return (
      <p className="text-[12px] text-status-green">
        解析完成：{done.totals.lines.toLocaleString('en-US')} 行 /{' '}
        {done.totals.tokens.toLocaleString('en-US')} tokens，新增{' '}
        {done.totals.inserted.toLocaleString('en-US')} 条记录
      </p>
    )
  }

  if (fileCount === 0) {
    return <p className="text-[12px] text-text-muted">未发现会话文件。</p>
  }

  if (!hasUsage) {
    return <p className="text-[12px] text-text-muted">已发现日志，点击“解析入库”后显示用量。</p>
  }

  return (
    <p className="text-[12px] text-text-muted">已解析入库，可在请求日志和用量概览中继续查看。</p>
  )
}

/** 筛选胶囊按钮:高亮当前选中项 */
function FilterChip({
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
      } inline-flex items-center gap-1.5`}
    >
      {children}
    </button>
  )
}
