/**
 * Codex 日志解析器单元测试:覆盖 parseCodexSessionFile / discoverCodexSessions,
 * 校验累计 token 事件的增量计算、会话发现与现代 payload 解析。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import {
  parseCodexSessionFile,
  discoverCodexSessions
} from '../../../../code/src/main/log-parsers/codex'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function tokenEvent(
  input: number,
  output: number,
  cached: number,
  seq: number,
  model = 'gpt-5-codex',
  ts = '2025-01-01T00:00:00Z'
) {
  return {
    event_type: 'event_msg',
    timestamp: ts,
    thread_id: 'sess-abc',
    msg: {
      type: 'token_count',
      sequence: seq,
      model,
      total_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cached }
    }
  }
}

function modernTokenEvent(
  input: number,
  output: number,
  cached: number,
  ts = '2026-07-06T16:12:46.981Z'
) {
  return {
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output
        },
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: 0,
          total_tokens: input + output
        }
      }
    }
  }
}

// parseCodexSessionFile:解析 Codex 会话文件,从累计 token 事件计算增量
describe('parseCodexSessionFile', () => {
  it('computes deltas from cumulative token_count events', () => {
    const content = [
      JSON.stringify(tokenEvent(100, 20, 0, 1, undefined, '2025-01-01T00:00:00Z')),
      JSON.stringify(tokenEvent(250, 50, 30, 2, undefined, '2025-01-01T00:00:01Z')),
      JSON.stringify(tokenEvent(250, 50, 30, 3, undefined, '2025-01-01T00:00:02Z')) // no change
    ].join('\n')
    const records = parseCodexSessionFile(content, '/x/sess-abc.jsonl')
    // First event: delta = (100,20,0) → fresh=100, cached=0, out=20
    // Second event: delta = (150,30,30) → fresh=150-30=120, cached=30, out=30
    // Third event: no change → skipped
    expect(records).toHaveLength(2)
    expect(records[0]!.promptTokens).toBe(100)
    expect(records[0]!.completionTokens).toBe(20)
    expect(records[0]!.cacheReadTokens).toBe(0)
    expect(records[1]!.promptTokens).toBe(120)
    expect(records[1]!.completionTokens).toBe(30)
    expect(records[1]!.cacheReadTokens).toBe(30)
  })

  it('skips non-token_count events', () => {
    const content = [
      '{"event_type":"session_meta","cwd":"/x"}',
      JSON.stringify(tokenEvent(100, 20, 0, 1)),
      '{"event_type":"event_msg","msg":{"type":"message","role":"user"}}',
      '{"event_type":"event_msg","msg":{"type":"function_call"}}'
    ].join('\n')
    const records = parseCodexSessionFile(content, '/x.jsonl')
    expect(records).toHaveLength(1)
  })

  it('skips blank and invalid lines', () => {
    const content = ['', JSON.stringify(tokenEvent(100, 20, 0, 1)), 'not json', '   '].join('\n')
    expect(parseCodexSessionFile(content, '/x.jsonl')).toHaveLength(1)
  })

  it('uses thread_id as sessionId, falls back to filename stem', () => {
    const withThread = [JSON.stringify(tokenEvent(10, 5, 0, 1))].join('\n')
    const r1 = parseCodexSessionFile(withThread, '/x.jsonl')
    expect(r1[0]!.sessionId).toBe('sess-abc')
    // without thread_id
    const evt: { thread_id?: string } = tokenEvent(10, 5, 0, 1)
    delete evt.thread_id
    const r2 = parseCodexSessionFile([JSON.stringify(evt)].join('\n'), '/path/xyz-123.jsonl')
    expect(r2[0]!.sessionId).toBe('xyz-123')
  })

  it('sets messageId from sequence, prefixed with sessionId to avoid cross-file collisions', () => {
    const content = [JSON.stringify(tokenEvent(10, 5, 0, 7))].join('\n')
    const records = parseCodexSessionFile(content, '/x.jsonl')
    // tokenEvent has thread_id: 'sess-abc', so messageId includes it
    expect(records[0]!.messageId).toBe('sess-abc-seq-7')
  })

  it('clamps negative deltas to zero (defensive against replay/reset)', () => {
    // cumulative goes 100 → 50 (reset); delta should clamp to 0, not -50
    const content = [
      JSON.stringify(tokenEvent(100, 20, 0, 1)),
      JSON.stringify(tokenEvent(50, 20, 0, 2))
    ].join('\n')
    const records = parseCodexSessionFile(content, '/x.jsonl')
    expect(records).toHaveLength(1) // second event produces all-zero deltas → skipped
  })

  it('handles inclusive cache: fresh input = deltaInput - deltaCached', () => {
    // Event 1: input=100, cached=20 → fresh=80, cached=20
    // Event 2: input=300, cached=100 → deltaInput=200, deltaCached=80 → fresh=120, cached=80
    const content = [
      JSON.stringify(tokenEvent(100, 20, 20, 1)),
      JSON.stringify(tokenEvent(300, 50, 100, 2))
    ].join('\n')
    const records = parseCodexSessionFile(content, '/x.jsonl')
    expect(records[0]!.promptTokens).toBe(80) // 100 - 20
    expect(records[0]!.cacheReadTokens).toBe(20)
    expect(records[1]!.promptTokens).toBe(120) // 200 - 80
    expect(records[1]!.cacheReadTokens).toBe(80)
  })

  it('skips an initial all-zero event', () => {
    const content = [
      JSON.stringify(tokenEvent(0, 0, 0, 0)),
      JSON.stringify(tokenEvent(100, 20, 0, 1))
    ].join('\n')
    const records = parseCodexSessionFile(content, '/x.jsonl')
    expect(records).toHaveLength(1)
    expect(records[0]!.promptTokens).toBe(100)
  })

  it('falls back to unknown-codex model when msg.model missing', () => {
    const evt = tokenEvent(10, 5, 0, 1)
    const msg: { model?: string } = evt.msg
    delete msg.model
    const records = parseCodexSessionFile(JSON.stringify(evt), '/x.jsonl')
    expect(records[0]!.model).toBe('unknown-codex')
  })

  it('parses modern Codex payload token_count events and derives model/session metadata', () => {
    const content = [
      JSON.stringify({
        timestamp: '2026-07-06T16:12:00.000Z',
        type: 'session_meta',
        payload: {
          session_id: 'modern-session',
          cwd: 'D:/dev/tokenlub'
        }
      }),
      JSON.stringify({
        timestamp: '2026-07-06T16:12:01.000Z',
        type: 'turn_context',
        payload: {
          model: 'gpt-5-codex'
        }
      }),
      JSON.stringify(modernTokenEvent(100, 20, 10, '2026-07-06T16:12:02.000Z')),
      JSON.stringify(modernTokenEvent(180, 35, 30, '2026-07-06T16:12:03.000Z'))
    ].join('\n')

    const records = parseCodexSessionFile(content, '/x/rollout.jsonl')

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      providerId: 'codex',
      model: 'gpt-5-codex',
      source: 'session-log',
      sessionId: 'modern-session',
      agentLabel: 'tokenlub',
      promptTokens: 90,
      completionTokens: 20,
      cacheReadTokens: 10,
      totalTokens: 120
    })
    expect(records[0]!.messageId).toBe('modern-session-line-3')
    expect(records[1]).toMatchObject({
      promptTokens: 60,
      completionTokens: 15,
      cacheReadTokens: 20,
      totalTokens: 95
    })
    expect(records[1]!.messageId).toBe('modern-session-line-4')
  })
})

// discoverCodexSessions:遍历 sessions 与 archived_sessions 目录发现会话文件
describe('discoverCodexSessions', () => {
  const tmpRoot = join(tmpdir(), `tokenlub-test-codex-${process.pid}`)

  it('returns [] when no roots exist', () => {
    expect(discoverCodexSessions([join(tmpdir(), 'nope-codex-xyz')])).toEqual([])
  })

  it('walks both sessions and archived_sessions roots', () => {
    const sessionsRoot = join(tmpRoot, 'sessions', '2025', '01', '15')
    const archivedRoot = join(tmpRoot, 'archived_sessions')
    mkdirSync(sessionsRoot, { recursive: true })
    mkdirSync(archivedRoot, { recursive: true })
    writeFileSync(join(sessionsRoot, 'a.jsonl'), '{"event_type":"session_meta"}')
    writeFileSync(join(archivedRoot, 'b.jsonl'), '{"event_type":"session_meta"}')
    writeFileSync(join(sessionsRoot, 'c.txt'), 'ignore')
    const found = discoverCodexSessions([
      join(tmpRoot, 'sessions'),
      join(tmpRoot, 'archived_sessions')
    ])
    expect(found).toHaveLength(2)
    expect(found.every((p) => p.endsWith('.jsonl'))).toBe(true)
    rmSync(tmpRoot, { recursive: true, force: true })
  })
})
