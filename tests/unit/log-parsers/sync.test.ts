/**
 * syncFiles 同步单元测试:覆盖 Claude 与 Codex 的 syncFiles 增量同步流程,
 * 校验解析入库、缺失文件跳过与进度回调。
 * (glm-5.2)
 */
import { describe, expect, it, vi } from 'vitest'

// Ponytail: syncFiles is non-trivial (incremental byte-offset + fast-path),
// so it gets ONE runnable check. Mock the DB + usage-repo so the test never
// touches Electron's userData path or the developer's real ~/.claude logs.

vi.mock('../../../src/main/store/db', () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => undefined, // readSyncState → {byteOffset:0, mtimeMs:0} → no fast-path
      run: () => ({ changes: 1 }) // writeSyncState
    })
  })
}))
vi.mock('../../../src/main/store/usage-repo', () => ({
  insertUsage: (records: unknown[]) => ({ inserted: records.length, skipped: 0 })
}))

import { syncFiles } from '../../../src/main/log-parsers/sync'
import { syncClaudeFile } from '../../../src/main/log-parsers/claude'
import { syncCodexFile } from '../../../src/main/log-parsers/codex'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function claudeAssistantLine(input: number, output: number, seq: string): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    timestamp: '2025-01-01T00:00:00Z',
    message: {
      id: `msg_${seq}`,
      model: 'claude-sonnet-4',
      usage: { input_tokens: input, output_tokens: output }
    }
  })
}

function codexTokenEvent(input: number, output: number, seq: number): string {
  return JSON.stringify({
    event_type: 'event_msg',
    timestamp: '2025-01-01T00:00:00Z',
    thread_id: 'sess-1',
    msg: {
      type: 'token_count',
      sequence: seq,
      model: 'gpt-5-codex',
      total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: 0 }
    }
  })
}

// syncFiles (Claude):解析 Claude 会话文件并入库,校验插入计数与进度回调
describe('syncFiles (Claude)', () => {
  it('parses a session file and reports inserted + token totals', () => {
    const dir = join(tmpdir(), `tokenlub-sync-claude-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'sess.jsonl')
    writeFileSync(file, claudeAssistantLine(100, 50, '1') + '\n')
    const result = syncFiles('claude-code', [file], syncClaudeFile)
    expect(result.source).toBe('claude-code')
    expect(result.totals.lines).toBe(1)
    expect(result.totals.inserted).toBe(1)
    expect(result.totals.tokens).toBe(150)
    rmSync(dir, { recursive: true, force: true })
  })

  it('skips a missing file without throwing (statSync fails → continue)', () => {
    const result = syncFiles('claude-code', ['D:/nonexistent/xyz.jsonl'], syncClaudeFile)
    expect(result.totals.lines).toBe(0)
    expect(result.totals.inserted).toBe(0)
  })

  it('reports progress per file via callback', () => {
    const dir = join(tmpdir(), `tokenlub-sync-prog-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'sess.jsonl')
    writeFileSync(file, claudeAssistantLine(100, 50, '1') + '\n')
    const progress: Array<{ file: string; lines: number }> = []
    syncFiles('claude-code', [file], syncClaudeFile, (p: { file: string; lines: number }) =>
      progress.push({ file: p.file, lines: p.lines })
    )
    expect(progress).toHaveLength(1)
    expect(progress[0]!.lines).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

// syncFiles (Codex):将累计事件转为增量并汇总 token 总量
describe('syncFiles (Codex)', () => {
  it('converts cumulative events to deltas and reports totals', () => {
    const dir = join(tmpdir(), `tokenlub-sync-codex-${process.pid}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'sess.jsonl')
    // Two cumulative events: (100,20,0) then (250,50,0) → deltas (100,20) + (150,30)
    writeFileSync(file, codexTokenEvent(100, 20, 1) + '\n' + codexTokenEvent(250, 50, 2) + '\n')
    const result = syncFiles('codex', [file], syncCodexFile)
    expect(result.totals.lines).toBe(2)
    expect(result.totals.tokens).toBe(300) // (100+20) + (150+30)
    rmSync(dir, { recursive: true, force: true })
  })
})
