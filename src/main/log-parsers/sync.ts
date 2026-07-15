/**
 * 日志同步编排模块:协调 Claude Code 与 Codex 会话文件的发现、增量同步、
 * 用量写入与同步状态持久化,并在同步后对历史数据进行 agent 标签回填。
 * (glm-5.2)
 */
import { statSync, readFileSync } from 'node:fs'
import { getDb } from '../store/db'
import { insertUsage } from '../store/usage-repo'
import { discoverClaudeSessions, syncClaudeFile, deriveClaudeAgentLabel } from './claude'
import { discoverCodexSessions, syncCodexFile, deriveCodexAgentLabel } from './codex'
import type { UsageRecord } from '@shared/types/usage'

/** 单文件同步进度回调载荷。 (glm-5.2) */
export interface SyncProgress {
  source: string
  file: string
  lines: number
  tokens: number
}

/** 单来源同步汇总结果。 (glm-5.2) */
export interface SyncResult {
  source: string
  totals: { lines: number; tokens: number; inserted: number }
}

/** log_sync_state 表行结构,记录每个文件的同步偏移与 mtime。 (glm-5.2) */
interface SyncStateRow {
  byte_offset: number | null
  mtime_ms: number | null
}

const CODEX_SYNC_STATE_SOURCE = 'codex:v2'

/** 读取指定来源+文件路径在 log_sync_state 中的字节偏移与 mtime。 (glm-5.2) */
function readSyncState(source: string, filePath: string): { byteOffset: number; mtimeMs: number } {
  const db = getDb()
  const row = db
    .prepare('SELECT byte_offset, mtime_ms FROM log_sync_state WHERE source = ? AND file_path = ?')
    .get(source, filePath) as SyncStateRow | undefined
  return {
    byteOffset: row?.byte_offset ?? 0,
    mtimeMs: row?.mtime_ms ?? 0
  }
}

/** 写入(UPSERT)指定来源+文件路径的最新字节偏移与 mtime。 (glm-5.2) */
function writeSyncState(
  source: string,
  filePath: string,
  byteOffset: number,
  mtimeMs: number
): void {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO log_sync_state (source, file_path, mtime_ms, byte_offset, last_synced_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source, file_path) DO UPDATE SET
      mtime_ms = excluded.mtime_ms,
      byte_offset = excluded.byte_offset,
      last_synced_at = excluded.last_synced_at
  `
  ).run(source, filePath, mtimeMs, byteOffset, new Date().toISOString())
}

/** 累加一组 UsageRecord 的 totalTokens 总和。 (glm-5.2) */
function sumTokens(records: UsageRecord[]): number {
  return records.reduce((s, r) => s + (r.totalTokens ?? 0), 0)
}

/**
 * Exported for the sync.test.ts check.
 *
 * 通用文件同步:遍历文件列表,按各自的字节偏移增量解析并写入用量,同时持久化同步状态;
 * 支持进度回调。返回该来源的汇总结果。 (glm-5.2)
 */
export function syncFiles(
  source: string,
  files: string[],
  syncOne: (file: string, byteOffset: number) => { records: UsageRecord[]; nextOffset: number },
  onProgress?: (p: SyncProgress) => void
): SyncResult {
  let lines = 0
  let tokens = 0
  let inserted = 0
  for (const file of files) {
    let st
    try {
      st = statSync(file)
    } catch {
      continue
    }
    const { byteOffset, mtimeMs } = readSyncState(source, file)
    // Fast path: already synced once AND unchanged since.
    // 快速路径:已同步过且文件未变更(mtime 与大小一致)则跳过。 (glm-5.2)
    if (byteOffset > 0 && st.mtimeMs === mtimeMs && st.size === byteOffset) {
      continue
    }
    const { records, nextOffset } = syncOne(file, st.size < byteOffset ? 0 : byteOffset)
    if (records.length > 0) {
      inserted += insertUsage(records).inserted
    }
    lines += records.length
    const fileTokens = sumTokens(records)
    tokens += fileTokens
    writeSyncState(source, file, nextOffset, st.mtimeMs)
    onProgress?.({ source, file, lines: records.length, tokens: fileTokens })
  }
  return { source, totals: { lines, tokens, inserted } }
}

/** 同步所有 Claude Code 会话文件,返回汇总结果。 (glm-5.2) */
export function syncClaudeSessions(onProgress?: (p: SyncProgress) => void): SyncResult {
  return syncFiles('claude-code', discoverClaudeSessions(), syncClaudeFile, onProgress)
}

/** 同步所有 Codex 会话文件,返回汇总结果(进度来源名统一为 'codex')。 (glm-5.2) */
export function syncCodexSessions(onProgress?: (p: SyncProgress) => void): SyncResult {
  const result = syncFiles(
    CODEX_SYNC_STATE_SOURCE,
    discoverCodexSessions(),
    syncCodexFile,
    onProgress
      ? (p) => {
          onProgress({ ...p, source: 'codex' })
        }
      : undefined
  )
  return { source: 'codex', totals: result.totals }
}

/**
 * 按指定来源(claude-code 或 codex)同步会话文件,并在完成后尽力回填历史数据的 agent 标签。
 */
export function syncAllSessions(
  source: 'claude-code' | 'codex',
  onProgress?: (p: SyncProgress) => void
): SyncResult {
  const result =
    source === 'claude-code' ? syncClaudeSessions(onProgress) : syncCodexSessions(onProgress)
  // Best-effort: label historical rows that predate the agent_label column so
  // the UI can show a project name. Guarded internally so it never breaks sync.
  // 尽力而为:为早于 agent_label 列的历史行补充标签,内部已做防护,失败不影响同步。 (glm-5.2)
  backfillAgentLabels()
  return result
}

/** Filename stem (no .jsonl, no dir) - matches the parsers' sessionId fallback.
 *  取文件名(去 .jsonl、去目录部分),与解析器的 sessionId 回退逻辑一致。 (glm-5.2) */
function fileStem(filePath: string): string | undefined {
  return (
    filePath
      .replace(/\.jsonl$/, '')
      .split(/[\\/]/)
      .pop() || undefined
  )
}

/** Read at most `maxLines` leading lines of a file (best-effort, '' on error).
 *  读取文件前 maxLines 行(尽力而为,出错返回空串)。 (glm-5.2) */
function readHeadLines(filePath: string, maxLines = 50): string {
  try {
    return readFileSync(filePath, { encoding: 'utf8' }).split(/\r?\n/).slice(0, maxLines).join('\n')
  } catch {
    return ''
  }
}

/** Derive a Claude label from a file's head: prefer a cwd line, else filePath.
 *  从文件头部推导 Claude 标签:优先用 cwd 行,否则用文件路径推导。 (glm-5.2) */
function claudeLabelForFile(head: string, filePath: string): string | undefined {
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as { cwd?: unknown }
      if (typeof obj.cwd === 'string' && obj.cwd) {
        return deriveClaudeAgentLabel({ type: '', cwd: obj.cwd }, filePath)
      }
    } catch {
      continue
    }
  }
  return deriveClaudeAgentLabel({ type: '' }, filePath)
}

/**
 * Backfill agent_label on historical usage_records (rows inserted before the
 * label was captured, where agent_label IS NULL). Discovers claude + codex
 * session files, cheaply derives each file's sessionId (filename stem) and
 * label (from the file head, like the parsers do), and updates matching rows.
 * Wrapped in a transaction and fully guarded - a failure never breaks sync.
 *
 * 在事务中执行且全程防护:发现 claude 与 codex 会话文件,推导每文件 sessionId(文件名)与标签(取自文件头部),
 * 更新 agent_label 为 NULL 的匹配行;失败不会中断同步。 (glm-5.2)
 */
export function backfillAgentLabels(): void {
  try {
    const db = getDb()
    const update = db.prepare(
      'UPDATE usage_records SET agent_label = ? WHERE session_id = ? AND agent_label IS NULL'
    )
    const claudeFiles = discoverClaudeSessions()
    const codexFiles = discoverCodexSessions()
    const tx = db.transaction(() => {
      for (const file of claudeFiles) {
        const sessionId = fileStem(file)
        if (!sessionId) continue
        const label = claudeLabelForFile(readHeadLines(file), file)
        if (label) update.run(label, sessionId)
      }
      for (const file of codexFiles) {
        const sessionId = fileStem(file)
        if (!sessionId) continue
        const label = deriveCodexAgentLabel(readHeadLines(file))
        if (label) update.run(label, sessionId)
      }
    })
    tx()
  } catch {
    // Best-effort backfill — swallow any error so sync always succeeds.
  }
}

/** Discover session file counts for the renderer's session-parse page.
 *  为渲染层的会话解析页发现 claude 与 codex 会话文件列表。 (glm-5.2) */
export function discoverAllSessions(): { claude: string[]; codex: string[] } {
  return {
    claude: discoverClaudeSessions(),
    codex: discoverCodexSessions()
  }
}
