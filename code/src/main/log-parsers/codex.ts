/**
 * Codex CLI 会话日志解析模块:负责从 ~/.codex/sessions 与 ~/.codex/archived_sessions
 * 发现 *.jsonl 会话文件,将 Codex 累计 token_count 事件转换为逐事件增量 UsageRecord,
 * 支持按字节增量同步与会话元数据(agent 标签、sessionId)推导。
 * (glm-5.2)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageRecord } from '@shared/types/usage'
import { getCliPaths } from '../platform/paths'

/** Default Codex CLI session directory. Override for tests / portable installs.
 *  Codex CLI 默认会话目录;测试或便携安装时可覆盖。 (glm-5.2)
 */
/** A raw token_count entry from the JSONL - only fields we read.
 *  JSONL 中单条 token_count 原始条目,仅包含需要读取的字段。 (glm-5.2)
 */
interface CodexTokenEntry {
  event_type?: string
  type?: string
  timestamp?: string
  thread_id?: string
  payload?: {
    type?: string
    session_id?: string
    id?: string
    cwd?: string
    model?: string
    info?: {
      total_token_usage?: CodexTokenUsage
      last_token_usage?: CodexTokenUsage
      model_context_window?: number
    }
  }
  msg?: {
    type: string
    sequence?: number
    model?: string
    total_token_usage?: CodexTokenUsage
  }
}

interface CodexTokenUsage {
  input_tokens?: number
  output_tokens?: number
  reasoning_tokens?: number
  reasoning_output_tokens?: number
  cached_input_tokens?: number
  total_tokens?: number
}

/** Cumulative totals tracked across a single session to compute deltas.
 *  单会话内累计用量状态,用于计算相邻事件间的增量。 (glm-5.2)
 */
interface CumulativeState {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

/** 单会话解析出的元数据(sessionId 与 agent 标签)。 (glm-5.2) */
interface CodexSessionMeta {
  sessionId?: string
  agentLabel?: string
}

/**
 * Scan the (leading) lines of a Codex session file for the session-meta entry
 * carrying the working directory, and derive a human-readable agent label from
 * the last non-empty path segment of that cwd. `cwd` may sit at the top level
 * or nested under `payload.cwd`; parsing is lenient. Returns undefined if no
 * cwd is found.
 *
 * 返回值:从 cwd 末尾非空路径段推导的可读 agent 标签;未找到 cwd 时返回 undefined。 (glm-5.2)
 */
export function deriveCodexAgentLabel(content: string): string | undefined {
  return deriveCodexSessionMeta(content).agentLabel
}

/** 从文件内容前若干行扫描 session_meta 条目,提取 sessionId 与 agent 标签。 (glm-5.2) */
function deriveCodexSessionMeta(content: string): CodexSessionMeta {
  let sessionId: string | undefined
  let agentLabel: string | undefined
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: { cwd?: unknown; payload?: { cwd?: unknown } }
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }
    const payload = (obj as { payload?: { session_id?: unknown; id?: unknown } }).payload
    if (!sessionId) {
      const id = payload?.session_id ?? payload?.id
      if (typeof id === 'string' && id) sessionId = id
    }
    const cwd = obj.cwd ?? obj.payload?.cwd
    if (!agentLabel && typeof cwd === 'string' && cwd) {
      const seg = cwd
        .split(/[\\/]/)
        .filter((s) => s.length > 0)
        .pop()
      if (seg) agentLabel = seg
    }
    if (sessionId && agentLabel) break
  }
  const meta: CodexSessionMeta = {}
  if (sessionId) meta.sessionId = sessionId
  if (agentLabel) meta.agentLabel = agentLabel
  return meta
}

/** 从单条 Codex 事件中提取 token_count 的累计用量对象,无匹配时返回 undefined。 (glm-5.2) */
function tokenUsage(entry: CodexTokenEntry): CodexTokenUsage | undefined {
  if (entry.event_type === 'event_msg' && entry.msg?.type === 'token_count') {
    return entry.msg.total_token_usage
  }
  if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') {
    return entry.payload.info?.total_token_usage
  }
  return undefined
}

/** 获取事件的消息序列号,用于构造 messageId 去重。 (glm-5.2) */
function tokenSequence(entry: CodexTokenEntry): number | undefined {
  return entry.msg?.sequence
}

/**
 * Parse a stream of Codex JSONL lines for ONE session file into UsageRecord[].
 *
 * Codex emits cumulative token_count events; this function converts them to
 * per-event deltas by subtracting the previous event's totals.
 *
 * @param content  the full file contents (or the new bytes since last sync)
 * @param filePath  path of the file (used for sessionId fallback from filename)
 *
 * 返回值:按事件增量转换后的 UsageRecord[]。 (glm-5.2)
 */
export function parseCodexSessionFile(content: string, filePath: string): UsageRecord[] {
  const out: UsageRecord[] = []
  let prev: CumulativeState = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }
  const fileSessionId = filePath
    .replace(/\.jsonl$/, '')
    .split(/[\\/]/)
    .pop()
  // Codex writes a session-meta line early in the file carrying the working
  // directory (top-level `cwd` or nested `payload.cwd`). Derive a human-readable
  // agent label from the last path segment of that cwd and apply it to every
  // record produced from this file.
  const meta = deriveCodexSessionMeta(content)
  const defaultSessionId = meta.sessionId ?? fileSessionId
  const agentLabel = meta.agentLabel
  let currentModel = 'unknown-codex'
  let lineNo = 0

  for (const line of content.split(/\r?\n/)) {
    lineNo++
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: CodexTokenEntry
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (entry.type === 'turn_context' && typeof entry.payload?.model === 'string') {
      currentModel = entry.payload.model
      continue
    }
    const usage = tokenUsage(entry)
    if (!usage) continue

    const currentInput = usage.input_tokens ?? 0
    const currentOutput = usage.output_tokens ?? 0
    const currentCached = usage.cached_input_tokens ?? 0

    // Skip the first event's delta if all zero (initial state) — but only if
    // every field is genuinely zero, meaning nothing happened yet.
    const isFirst = out.length === 0
    if (isFirst && currentInput === 0 && currentOutput === 0 && currentCached === 0) {
      continue
    }

    // Delta = current cumulative - previous cumulative. Clamp negatives to 0
    // (can happen if a session is replayed or counts reset).
    const deltaInput = Math.max(0, currentInput - prev.inputTokens)
    const deltaOutput = Math.max(0, currentOutput - prev.outputTokens)
    const deltaCached = Math.max(0, currentCached - prev.cachedInputTokens)

    // OpenAI-style inclusive cache: input includes cached. Fresh input = deltaInput - deltaCached.
    const freshInput = Math.max(0, deltaInput - deltaCached)

    if (deltaInput === 0 && deltaOutput === 0 && deltaCached === 0) {
      // No new tokens in this event — skip to avoid a zero record
      prev = {
        inputTokens: currentInput,
        outputTokens: currentOutput,
        cachedInputTokens: currentCached
      }
      continue
    }

    const record: UsageRecord = {
      providerId: 'codex',
      model: entry.msg?.model ?? currentModel,
      source: 'session-log',
      capturedAt: entry.timestamp ?? new Date().toISOString(),
      promptTokens: freshInput,
      completionTokens: deltaOutput,
      cacheReadTokens: deltaCached,
      cacheCreationTokens: 0
    }
    if (entry.thread_id) {
      record.sessionId = entry.thread_id
    } else if (defaultSessionId) {
      record.sessionId = defaultSessionId
    }
    const sequence = tokenSequence(entry)
    if (typeof sequence === 'number') {
      // Prefix with sessionId so records from different session files don't
      // collide on the UNIQUE(source, message_id) dedup constraint.
      record.messageId = `${record.sessionId ?? defaultSessionId ?? 'unknown'}-seq-${sequence}`
    } else {
      // Newer Codex logs do not carry msg.sequence. Use a stable file-local
      // line number so repeated syncs are idempotent under UNIQUE(source,message_id).
      record.messageId = `${record.sessionId ?? defaultSessionId ?? 'unknown'}-line-${lineNo}`
    }
    if (agentLabel) record.agentLabel = agentLabel
    record.totalTokens = freshInput + deltaOutput + deltaCached
    out.push(record)

    prev = {
      inputTokens: currentInput,
      outputTokens: currentOutput,
      cachedInputTokens: currentCached
    }
  }
  return out
}

/**
 * Discover Codex session files under the given root (defaults to CODEX_LOG_DIR
 * and CODEX_ARCHIVED_DIR). Returns absolute paths to *.jsonl files.
 *
 * 发现 Codex 会话文件:在指定根目录(默认 CODEX_LOG_DIR 与 CODEX_ARCHIVED_DIR)下递归查找 *.jsonl,返回绝对路径列表。 (glm-5.2)
 */
export function discoverCodexSessions(roots?: string[]): string[] {
  const actualRoots = roots ?? [getCliPaths().codexSessions, getCliPaths().codexArchivedSessions]
  const results: string[] = []
  for (const root of actualRoots) {
    if (!existsSync(root)) continue
    const walk = (dir: string): void => {
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const name of entries) {
        const full = join(dir, name)
        let st
        try {
          st = statSync(full)
        } catch {
          continue
        }
        if (st.isDirectory()) {
          walk(full)
        } else if (st.isFile() && name.endsWith('.jsonl')) {
          results.push(full)
        }
      }
    }
    walk(root)
  }
  return results
}

/**
 * Sync a single Codex file. Re-parses the whole file each call because the
 * cumulative->delta conversion needs full-session context; downstream dedup
 * via INSERT OR IGNORE on (source, message_id) makes re-inserts safe.
 *
 * 同步单个 Codex 文件:因累计→增量转换需全文件上下文,每次调用均重新解析整个文件;
 * 下游通过 (source, message_id) 的 INSERT OR IGNORE 去重保证重复插入安全。 (glm-5.2)
 */
export function syncCodexFile(
  filePath: string,
  byteOffset = 0
): { records: UsageRecord[]; nextOffset: number } {
  let st
  try {
    st = statSync(filePath)
  } catch {
    return { records: [], nextOffset: byteOffset }
  }
  if (st.size <= byteOffset) {
    return { records: [], nextOffset: st.size }
  }
  const content = readFileSync(filePath, { encoding: 'utf8' })
  const records = parseCodexSessionFile(content, filePath)
  return { records, nextOffset: st.size }
}
