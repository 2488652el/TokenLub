/**
 * Claude 日志解析器单元测试:覆盖 parseClaudeSessionLine / parseClaudeSessionFile /
 * discoverClaudeSessions / syncClaudeFile,校验 JSONL 行解析、会话发现与增量同步。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import {
  parseClaudeSessionLine,
  parseClaudeSessionFile,
  discoverClaudeSessions,
  syncClaudeFile
} from '../../../src/main/log-parsers/claude'
import { writeFileSync, mkdirSync, existsSync, rmSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// parseClaudeSessionLine:解析单行 Claude 助手消息为 UsageRecord
describe('parseClaudeSessionLine', () => {
  const baseLine = {
    type: 'assistant',
    uuid: 'u1',
    sessionId: 'sess-1',
    timestamp: '2025-01-15T10:30:00.000Z',
    message: {
      id: 'msg_01XYZ',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 1234,
        output_tokens: 567,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 800
      }
    }
  }

  it('parses a full assistant entry with usage into a UsageRecord', () => {
    const r = parseClaudeSessionLine(JSON.stringify(baseLine), '/x/sess-1.jsonl')
    expect(r).not.toBeNull()
    expect(r!.providerId).toBe('claude-code')
    expect(r!.model).toBe('claude-sonnet-4-20250514')
    expect(r!.source).toBe('session-log')
    expect(r!.promptTokens).toBe(1234)
    expect(r!.completionTokens).toBe(567)
    expect(r!.cacheCreationTokens).toBe(100)
    expect(r!.cacheReadTokens).toBe(800)
    expect(r!.totalTokens).toBe(2701)
    expect(r!.sessionId).toBe('sess-1')
    expect(r!.messageId).toBe('msg_01XYZ')
    expect(r!.capturedAt).toBe('2025-01-15T10:30:00.000Z')
  })

  it('returns null for user/summary/system lines', () => {
    expect(parseClaudeSessionLine('{"type":"user"}', '/x.jsonl')).toBeNull()
    expect(parseClaudeSessionLine('{"type":"summary"}', '/x.jsonl')).toBeNull()
    expect(parseClaudeSessionLine('{"type":"system"}', '/x.jsonl')).toBeNull()
  })

  it('returns null for assistant lines without usage', () => {
    const noUsage = {
      ...baseLine,
      message: { id: 'msg', model: 'claude-x', type: 'message', role: 'assistant' }
    }
    expect(parseClaudeSessionLine(JSON.stringify(noUsage), '/x.jsonl')).toBeNull()
  })

  it('returns null for assistant lines with empty usage object', () => {
    const emptyUsage = { ...baseLine, message: { ...baseLine.message, usage: {} } }
    expect(parseClaudeSessionLine(JSON.stringify(emptyUsage), '/x.jsonl')).toBeNull()
  })

  it('returns null for blank lines and invalid JSON', () => {
    expect(parseClaudeSessionLine('', '/x.jsonl')).toBeNull()
    expect(parseClaudeSessionLine('   ', '/x.jsonl')).toBeNull()
    expect(parseClaudeSessionLine('{not json', '/x.jsonl')).toBeNull()
  })

  it('falls back to filename stem when sessionId is missing', () => {
    const noSess = { ...baseLine } as Partial<typeof baseLine>
    delete noSess.sessionId
    const r = parseClaudeSessionLine(JSON.stringify(noSess), '/path/to/abc-123.jsonl')
    expect(r!.sessionId).toBe('abc-123')
  })

  it('falls back to "unknown-claude" model when message.model is missing', () => {
    const noModel = { ...baseLine, message: { ...baseLine.message, model: undefined } }
    const r = parseClaudeSessionLine(JSON.stringify(noModel), '/x.jsonl')
    expect(r!.model).toBe('unknown-claude')
  })

  it('handles partial usage (only input_tokens present)', () => {
    const partial = { ...baseLine, message: { ...baseLine.message, usage: { input_tokens: 100 } } }
    const r = parseClaudeSessionLine(JSON.stringify(partial), '/x.jsonl')
    expect(r!.promptTokens).toBe(100)
    expect(r!.completionTokens).toBeUndefined()
    expect(r!.totalTokens).toBe(100)
  })
})

// parseClaudeSessionFile:解析整份 JSONL 文件,跳过无效行保留有效条目
describe('parseClaudeSessionFile', () => {
  it('skips blank and invalid lines, keeps valid assistant entries', () => {
    const content = [
      '{"type":"user","message":"hi"}',
      '',
      '{"type":"assistant","message":{"usage":{"input_tokens":10}},"timestamp":"2025-01-01T00:00:00Z"}',
      'garbage line',
      '{"type":"assistant","message":{"usage":{"output_tokens":5}},"timestamp":"2025-01-01T00:00:01Z"}'
    ].join('\n')
    const records = parseClaudeSessionFile(content, '/x.jsonl')
    expect(records).toHaveLength(2)
    expect(records[0]!.promptTokens).toBe(10)
    expect(records[1]!.completionTokens).toBe(5)
  })
})

// discoverClaudeSessions:递归发现 *.jsonl 会话文件
describe('discoverClaudeSessions', () => {
  const tmpRoot = join(tmpdir(), `tokenlub-test-claude-${process.pid}`)

  it('returns [] when the root does not exist', () => {
    expect(discoverClaudeSessions(join(tmpdir(), 'definitely-not-here-xyz'))).toEqual([])
  })

  it('recursively finds *.jsonl files', () => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
    const project = join(tmpRoot, '项目 space')
    mkdirSync(join(project, 'subagents'), { recursive: true })
    writeFileSync(join(project, 'a.jsonl'), '{"type":"assistant"}')
    writeFileSync(join(project, 'subagents', 'b.jsonl'), '{"type":"assistant"}')
    writeFileSync(join(project, 'readme.txt'), 'ignore me')
    const found = discoverClaudeSessions(tmpRoot)
    expect(found).toHaveLength(2)
    expect(found.every((p) => p.includes('项目 space'))).toBe(true)
    expect(found.every((p) => p.endsWith('.jsonl'))).toBe(true)
    rmSync(tmpRoot, { recursive: true, force: true })
  })
})

// syncClaudeFile:基于字节偏移的增量同步,仅读取新增内容
describe('syncClaudeFile', () => {
  const tmpFile = join(tmpdir(), `tokenlub-sync-test-${process.pid}.jsonl`)

  it('returns empty records and unchanged offset when file is unchanged', () => {
    writeFileSync(
      tmpFile,
      '{"type":"assistant","message":{"usage":{"input_tokens":1}},"timestamp":"2025-01-01T00:00:00Z"}\n'
    )
    const first = syncClaudeFile(tmpFile, 0)
    expect(first.records).toHaveLength(1)
    const second = syncClaudeFile(tmpFile, first.nextOffset)
    expect(second.records).toHaveLength(0)
    expect(second.nextOffset).toBe(first.nextOffset)
    rmSync(tmpFile, { force: true })
  })

  it('reads only new bytes appended since last offset', () => {
    const initial =
      '{"type":"assistant","message":{"usage":{"input_tokens":1}},"timestamp":"2025-01-01T00:00:00Z"}\n'
    writeFileSync(tmpFile, initial)
    const first = syncClaudeFile(tmpFile, 0)
    expect(first.records).toHaveLength(1)
    // append a new entry
    const appended =
      '{"type":"assistant","message":{"usage":{"input_tokens":2}},"timestamp":"2025-01-01T00:01:00Z"}\n'
    appendFileSync(tmpFile, appended)
    const second = syncClaudeFile(tmpFile, first.nextOffset)
    expect(second.records).toHaveLength(1)
    expect(second.records[0]!.promptTokens).toBe(2)
    rmSync(tmpFile, { force: true })
  })
})
