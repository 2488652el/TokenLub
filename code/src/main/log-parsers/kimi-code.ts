/**
 * Kimi Code CLI session log parser.
 *
 * Kimi Code stores one JSON object per line in
 * ~/.kimi-code/sessions/<workdir>/<session>/agents/<agent>/wire.jsonl.
 * Current releases persist `usage.record` entries with camelCase token
 * counters; older Kimi CLI releases persisted `StatusUpdate` entries with
 * snake_case counters. Both shapes are accepted so existing sessions remain
 * importable after an upgrade.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { UsageRecord } from '@shared/types/usage'
import { getCliPaths } from '../platform/paths'

interface KimiUsage {
  inputOther?: unknown
  output?: unknown
  inputCacheRead?: unknown
  inputCacheCreation?: unknown
  input_other?: unknown
  input_cache_read?: unknown
  input_cache_creation?: unknown
}

interface KimiWireEntry {
  type?: unknown
  model?: unknown
  time?: unknown
  timestamp?: unknown
  messageId?: unknown
  message_id?: unknown
  usage?: KimiUsage
  payload?: {
    token_usage?: KimiUsage
    message_id?: unknown
  }
  message?: {
    type?: unknown
    payload?: {
      token_usage?: KimiUsage
      message_id?: unknown
    }
  }
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return undefined
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed !== undefined) return parsed
  }
  return 0
}

function timestamp(value: unknown): string {
  if (typeof value === 'string' && value) return value
  const numeric = finiteNumber(value)
  if (numeric !== undefined) {
    const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric
    const date = new Date(milliseconds)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

export function deriveKimiCodeSessionId(filePath: string): string | undefined {
  const segments = filePath.split(/[\\/]/).filter(Boolean)
  const session = segments.find((segment) => segment.startsWith('session_'))
  if (session) return session
  const agentsIndex = segments.lastIndexOf('agents')
  return agentsIndex > 0 ? segments[agentsIndex - 1] : undefined
}

function deriveKimiCodeAgentId(filePath: string): string {
  const segments = filePath.split(/[\\/]/).filter(Boolean)
  const agentsIndex = segments.lastIndexOf('agents')
  return agentsIndex >= 0 ? (segments[agentsIndex + 1] ?? 'main') : 'main'
}

function readWorkDir(filePath: string): string | undefined {
  // wire.jsonl -> agent dir -> agents -> session dir -> state.json
  const statePath = join(dirname(dirname(dirname(filePath))), 'state.json')
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { workDir?: unknown }
    return typeof state.workDir === 'string' && state.workDir ? state.workDir : undefined
  } catch {
    return undefined
  }
}

export function deriveKimiCodeAgentLabel(filePath: string): string | undefined {
  const workDir = readWorkDir(filePath)
  if (workDir) {
    const segment = workDir.split(/[\\/]/).filter(Boolean).pop()
    if (segment) return segment
  }
  const segments = filePath.split(/[\\/]/).filter(Boolean)
  const agentsIndex = segments.lastIndexOf('agents')
  return agentsIndex >= 2 ? segments[agentsIndex - 2] : undefined
}

function extractUsage(entry: KimiWireEntry): KimiUsage | undefined {
  if (entry.type === 'usage.record' && entry.usage) return entry.usage
  if (entry.message?.type === 'StatusUpdate') return entry.message.payload?.token_usage
  if (entry.type === 'StatusUpdate') return entry.payload?.token_usage
  return undefined
}

function extractMessageId(entry: KimiWireEntry): string | undefined {
  const direct = entry.messageId ?? entry.message_id
  if (typeof direct === 'string' && direct) return direct
  const nested = entry.message?.payload?.message_id
  if (typeof nested === 'string' && nested) return nested
  const payloadMessageId = entry.payload?.message_id
  return typeof payloadMessageId === 'string' && payloadMessageId ? payloadMessageId : undefined
}

function extractModel(entry: KimiWireEntry): string {
  return typeof entry.model === 'string' && entry.model ? entry.model : 'unknown-kimi-coding'
}

export function parseKimiCodeSessionLine(
  line: string,
  filePath: string,
  lineNo = 1
): UsageRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let entry: KimiWireEntry
  try {
    entry = JSON.parse(trimmed) as KimiWireEntry
  } catch {
    return null
  }

  const usage = extractUsage(entry)
  if (!usage) return null
  const inputTokens = firstNumber(usage.inputOther, usage.input_other)
  const outputTokens = firstNumber(usage.output)
  const cacheReadTokens = firstNumber(usage.inputCacheRead, usage.input_cache_read)
  const cacheCreationTokens = firstNumber(usage.inputCacheCreation, usage.input_cache_creation)
  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens === 0) return null

  const sessionId = deriveKimiCodeSessionId(filePath) ?? 'unknown-kimi-session'
  const agentId = deriveKimiCodeAgentId(filePath)
  const record: UsageRecord = {
    providerId: 'kimi-coding',
    model: extractModel(entry),
    source: 'session-log',
    capturedAt: timestamp(entry.time ?? entry.timestamp),
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    sessionId,
    messageId: `${sessionId}-${agentId}-line-${lineNo}`
  }
  const messageId = extractMessageId(entry)
  if (messageId) record.messageId = `${sessionId}-${agentId}-${messageId}`
  const agentLabel = deriveKimiCodeAgentLabel(filePath)
  if (agentLabel) record.agentLabel = agentLabel
  return record
}

export function parseKimiCodeSessionFile(content: string, filePath: string): UsageRecord[] {
  const records: UsageRecord[] = []
  let lineNo = 0
  for (const line of content.split(/\r?\n/)) {
    lineNo++
    const record = parseKimiCodeSessionLine(line, filePath, lineNo)
    if (record) records.push(record)
  }
  return records
}

export function discoverKimiCodeSessions(root?: string): string[] {
  const actualRoot = root ?? getCliPaths().kimiCodeSessions
  if (!existsSync(actualRoot)) return []
  const results: string[] = []
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
      if (st.isDirectory()) walk(full)
      else if (st.isFile() && name === 'wire.jsonl') results.push(full)
    }
  }
  walk(actualRoot)
  return results
}

export function syncKimiCodeFile(
  filePath: string,
  byteOffset = 0
): { records: UsageRecord[]; nextOffset: number } {
  let st
  try {
    st = statSync(filePath)
  } catch {
    return { records: [], nextOffset: byteOffset }
  }
  if (st.size <= byteOffset) return { records: [], nextOffset: st.size }
  const content = readFileSync(filePath).subarray(byteOffset).toString('utf8')
  return {
    records: parseKimiCodeSessionFile(content, filePath),
    nextOffset: st.size
  }
}
