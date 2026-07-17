import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  discoverKimiCodeSessions,
  parseKimiCodeSessionFile,
  parseKimiCodeSessionLine,
  syncKimiCodeFile
} from '../../../../code/src/main/log-parsers/kimi-code'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Kimi Code wire usage parser', () => {
  it('parses current usage.record entries', () => {
    const file =
      'C:\\Users\\tester\\.kimi-code\\sessions\\wd_demo\\session_abc\\agents\\main\\wire.jsonl'
    const record = parseKimiCodeSessionLine(
      JSON.stringify({
        type: 'usage.record',
        model: 'kimi-code/kimi-for-coding',
        usage: {
          inputOther: 1163,
          output: 352,
          inputCacheRead: 22272,
          inputCacheCreation: 0
        },
        usageScope: 'turn',
        time: 1780410897480
      }),
      file,
      7
    )

    expect(record).toMatchObject({
      providerId: 'kimi-coding',
      model: 'kimi-code/kimi-for-coding',
      promptTokens: 1163,
      completionTokens: 352,
      cacheReadTokens: 22272,
      totalTokens: 23787,
      sessionId: 'session_abc',
      messageId: 'session_abc-main-line-7'
    })
    expect(record?.capturedAt).toBe('2026-06-02T14:34:57.480Z')
  })

  it('keeps compatibility with legacy StatusUpdate entries', () => {
    const file = '/Users/tester/.kimi/sessions/group/session_old/agents/main/wire.jsonl'
    const records = parseKimiCodeSessionFile(
      JSON.stringify({
        timestamp: 1770983426.420942,
        message: {
          type: 'StatusUpdate',
          payload: {
            token_usage: {
              input_other: 1562,
              output: 2463,
              input_cache_read: 10,
              input_cache_creation: 5
            },
            message_id: 'chatcmpl-1'
          }
        }
      }),
      file
    )
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      providerId: 'kimi-coding',
      promptTokens: 1562,
      completionTokens: 2463,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      totalTokens: 4040,
      messageId: 'session_old-main-chatcmpl-1'
    })
  })

  it('discovers wire files recursively and syncs appended bytes', () => {
    const root = join(tmpdir(), `kimi-code-parser-${Date.now()}`)
    roots.push(root)
    const file = join(root, 'wd_demo', 'session_abc', 'agents', 'main', 'wire.jsonl')
    mkdirSync(join(root, 'wd_demo', 'session_abc', 'agents', 'main'), { recursive: true })
    const line = JSON.stringify({
      type: 'usage.record',
      model: 'kimi-for-coding',
      usage: { inputOther: 1, output: 2, inputCacheRead: 0, inputCacheCreation: 0 },
      time: 1780410897480
    })
    writeFileSync(file, `${line}\n`, 'utf8')
    expect(discoverKimiCodeSessions(root)).toEqual([file])

    const first = syncKimiCodeFile(file)
    expect(first.records).toHaveLength(1)
    expect(first.nextOffset).toBe(Buffer.byteLength(`${line}\n`))
    writeFileSync(file, `${line}\n${line}\n`, 'utf8')
    const second = syncKimiCodeFile(file, first.nextOffset)
    expect(second.records).toHaveLength(1)
  })
})
