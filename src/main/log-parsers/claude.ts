/**
 * Claude Code 会话日志解析模块:负责从 ~/.claude/projects 目录发现 *.jsonl
 * 会话文件,按行解析 assistant 消息中的 usage 字段为 UsageRecord,
 * 支持按字节增量同步与文件发现。
 * (glm-5.2)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageRecord } from '@shared/types/usage'
import { getCliPaths } from '../platform/paths'

/** Default Claude Code session directory. Override for tests / portable installs.
 *  Claude Code 默认会话目录;测试或便携安装时可覆盖。 (glm-5.2)
 */
/** A raw assistant entry from the JSONL - only fields we read.
 *  JSONL 中单条 assistant 原始条目,仅包含需要读取的字段。 (glm-5.2)
 */
interface ClaudeAssistantEntry {
  type: string
  uuid?: string
  sessionId?: string
  cwd?: string
  timestamp?: string
  message?: {
    id?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

/**
 * Derive a human-readable agent/project label for a Claude Code record.
 *
 * Preference order:
 *   1. entry.cwd — the last non-empty path segment (the working-dir basename).
 *   2. filePath — under ~/.claude/projects the parent directory name is the
 *      dash-encoded project path (e.g. "-Users-me-dev-tokenlub"). Strip the
 *      leading "-", split on "-", and use the last non-empty segment.
 *
 * Returns undefined when no non-empty label can be derived.
 *
 * 返回值:可读的 agent/项目标签字符串;无法推导时返回 undefined。 (glm-5.2)
 */
export function deriveClaudeAgentLabel(
  entry: ClaudeAssistantEntry,
  filePath: string
): string | undefined {
  if (entry.cwd) {
    const seg = entry.cwd
      .split(/[\\/]/)
      .filter((s) => s.length > 0)
      .pop()
    if (seg) return seg
  }
  // Parent directory name (the dash-encoded project path) under .../projects/.
  // 父目录名为 .../projects/ 下以短横线编码的项目路径。 (glm-5.2)
  const projectDir = filePath
    .split(/[\\/]/)
    .filter((s) => s.length > 0)
    .slice(0, -1)
    .pop()
  if (projectDir) {
    const seg = projectDir
      .replace(/^-/, '')
      .split('-')
      .filter((s) => s.length > 0)
      .pop()
    if (seg) return seg
  }
  return undefined
}

/**
 * Parse a single JSONL line into a UsageRecord, or null if the line is not a
 * token-bearing assistant entry (skips user/summary/system lines and assistant
 * lines without usage data).
 *
 * @param line   one JSONL line (may have trailing newline)
 * @param filePath  path of the file this line came from (used for sessionId fallback)
 *
 * 返回值:解析得到的 UsageRecord;若该行非携带 token 的 assistant 条目则返回 null。 (glm-5.2)
 */
export function parseClaudeSessionLine(line: string, filePath: string): UsageRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let entry: ClaudeAssistantEntry
  try {
    entry = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (entry.type !== 'assistant') return null
  const usage = entry.message?.usage
  if (!usage) return null
  // Require at least one token field to be present — otherwise the line is
  // an assistant tool/thinking turn with no billing impact.
  const hasTokens =
    usage.input_tokens != null ||
    usage.output_tokens != null ||
    usage.cache_creation_input_tokens != null ||
    usage.cache_read_input_tokens != null
  if (!hasTokens) return null

  const record: UsageRecord = {
    providerId: 'claude-code',
    model: entry.message?.model ?? 'unknown-claude',
    source: 'session-log',
    capturedAt: entry.timestamp ?? new Date().toISOString()
  }
  // sessionId: prefer the entry's sessionId, fall back to the filename stem
  // sessionId:优先使用条目自带值,否则回退到文件名(去 .jsonl)。 (glm-5.2)
  if (entry.sessionId) {
    record.sessionId = entry.sessionId
  } else {
    const stem = filePath
      .replace(/\.jsonl$/, '')
      .split(/[\\/]/)
      .pop()
    if (stem) record.sessionId = stem
  }
  if (entry.message?.id) record.messageId = entry.message.id
  if (typeof usage.input_tokens === 'number') record.promptTokens = usage.input_tokens
  if (typeof usage.output_tokens === 'number') record.completionTokens = usage.output_tokens
  if (typeof usage.cache_creation_input_tokens === 'number') {
    record.cacheCreationTokens = usage.cache_creation_input_tokens
  }
  if (typeof usage.cache_read_input_tokens === 'number') {
    record.cacheReadTokens = usage.cache_read_input_tokens
  }
  const total =
    (record.promptTokens ?? 0) +
    (record.completionTokens ?? 0) +
    (record.cacheCreationTokens ?? 0) +
    (record.cacheReadTokens ?? 0)
  record.totalTokens = total
  const agentLabel = deriveClaudeAgentLabel(entry, filePath)
  if (agentLabel) record.agentLabel = agentLabel
  return record
}

/**
 * Parse an entire JSONL file (already-read string) into UsageRecord[].
 * Blank lines and unparseable lines are silently skipped.
 *
 * 将已读取的整个 JSONL 文件内容解析为 UsageRecord[];空行与无法解析的行被静默跳过。 (glm-5.2)
 */
export function parseClaudeSessionFile(content: string, filePath: string): UsageRecord[] {
  const out: UsageRecord[] = []
  for (const line of content.split(/\r?\n/)) {
    const r = parseClaudeSessionLine(line, filePath)
    if (r) out.push(r)
  }
  return out
}

/**
 * Discover Claude Code session files under the given root (defaults to
 * CLAUDE_LOG_DIR). Returns absolute paths to *.jsonl files.
 *
 * Uses glob-style recursive walk. Returns [] if the directory does not exist
 * (common on machines without Claude Code installed).
 *
 * 使用递归遍历发现文件;目录不存在时返回空数组(未安装 Claude Code 时常见)。 (glm-5.2)
 */
export function discoverClaudeSessions(root?: string): string[] {
  const actualRoot = root ?? getCliPaths().claudeProjects
  if (!existsSync(actualRoot)) return []
  const results: string[] = []
  /** 递归遍历目录,收集 *.jsonl 文件绝对路径。 (glm-5.2) */
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
  walk(actualRoot)
  return results
}

/**
 * Sync a single file's new lines since last offset. Returns inserted records
 * and the new byte offset to persist for the next sync. If the file has not
 * grown (or was deleted), returns an empty record list.
 *
 * Reads as Buffer and slices by BYTE offset (not UTF-16 code-unit index).
 * If byteOffset lands in the middle of a multi-byte UTF-8 char, the boundary
 * char becomes a replacement char and that single line fails JSON.parse ->
 * skipped. Only one boundary line is affected, never the whole file.
 *
 * 若字节偏移落在多字节 UTF-8 字符中间,该边界字符会变为替换字符并导致该行 JSON 解析失败被跳过;
 * 仅影响一行,不影响整个文件。 (glm-5.2)
 */
export function syncClaudeFile(
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
  const buf = readFileSync(filePath)
  const newContent = buf.subarray(byteOffset).toString('utf8')
  const records = parseClaudeSessionFile(newContent, filePath)
  return { records, nextOffset: st.size }
}
