/**
 * CLI 鉴权检测单元测试:覆盖 maskKey / detectClaudeKey / detectCodexKey / detectAllCLIKeys,
 * 校验环境变量与凭据文件的密钥发现、脱敏与降级处理。
 * (glm-5.2)
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  maskKey,
  detectClaudeKey,
  detectCodexKey,
  detectAllCLIKeys
} from '../../../../code/src/main/log-parsers/cli-auth'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// NOTE: We capture individual env vars and restore them via assignment/delete
// through Node's `process.env` proxy. We deliberately do NOT reassign
// `process.env = { ... }` — that replaces the libuv-backed proxy with a plain
// object, after which `os.homedir()` (which reads the OS env, not the JS
// object) stops honoring runtime `USERPROFILE`/`HOME` changes and the
// file-based detection tests break.
const originalHome = process.env['HOME']
const originalUserprofile = process.env['USERPROFILE']
const originalAnthropic = process.env['ANTHROPIC_API_KEY']
const originalOpenai = process.env['OPENAI_API_KEY']

// maskKey:对长密钥中间脱敏,短密钥返回 ****
describe('maskKey', () => {
  it('masks the middle of a long key', () => {
    expect(maskKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456')).toBe('sk-ant-a...3456')
  })
  it('returns **** for short keys (<=12 chars)', () => {
    expect(maskKey('short-key')).toBe('****')
    expect(maskKey('exactly12ch')).toBe('****')
  })
  it('masks a 13-char key correctly', () => {
    // 13 chars: first 8 + ... + last 4 = 8+3+4 = 15 chars
    expect(maskKey('sk-ant-1234567')).toBe('sk-ant-1...4567')
  })
})

// detectClaudeKey:从环境变量或 ~/.claude 凭据文件发现 Anthropic 密钥
describe('detectClaudeKey', () => {
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY']
  })
  afterEach(() => {
    if (originalHome !== undefined) process.env['HOME'] = originalHome
    else delete process.env['HOME']
    if (originalUserprofile !== undefined) process.env['USERPROFILE'] = originalUserprofile
    else delete process.env['USERPROFILE']
    if (originalAnthropic !== undefined) process.env['ANTHROPIC_API_KEY'] = originalAnthropic
    else delete process.env['ANTHROPIC_API_KEY']
  })

  it('finds key from ANTHROPIC_API_KEY env var first', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-testenvkey123'
    const result = detectClaudeKey()
    expect(result.found).toBe(true)
    expect(result.path).toBe('env:ANTHROPIC_API_KEY')
    expect(result.fullKey).toBe('sk-ant-api03-testenvkey123')
    expect(result.maskedKey).toBe('sk-ant-a...y123')
  })

  it('returns not-found when env is unset and no credential file exists', () => {
    // Point HOME to an empty temp dir so no real credentials are read
    const tmpHome = join(tmpdir(), `tokenlub-test-nohome-${process.pid}`)
    mkdirSync(tmpHome, { recursive: true })
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    const result = detectClaudeKey()
    expect(result.found).toBe(false)
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('reads key from ~/.claude/.credentials.json apiKeys array', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-cred-${process.pid}`)
    const claudeDir = join(tmpHome, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, '.credentials.json'),
      JSON.stringify({
        apiKeys: [{ label: 'work', key: 'sk-ant-api03-verylongkeyvalue123456789' }],
        claudeAiOauth: { accessToken: 'oauth-tok' }
      })
    )
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    const result = detectClaudeKey()
    expect(result.found).toBe(true)
    expect(result.fullKey).toBe('sk-ant-api03-verylongkeyvalue123456789')
    expect(result.maskedKey).toBe('sk-ant-a...6789')
    expect(result.path).toContain('.credentials.json')
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('ignores non-sk-ant- keys in the apiKeys array', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-badkey-${process.pid}`)
    const claudeDir = join(tmpHome, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, '.credentials.json'),
      JSON.stringify({ apiKeys: [{ label: 'bad', key: 'not-a-real-key' }] })
    )
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    const result = detectClaudeKey()
    expect(result.found).toBe(false)
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('falls back to credentials.json (older path)', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-oldcred-${process.pid}`)
    const claudeDir = join(tmpHome, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(
      join(claudeDir, 'credentials.json'),
      JSON.stringify({ apiKeys: [{ key: 'sk-ant-api03-fromoldpath987654' }] })
    )
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    const result = detectClaudeKey()
    expect(result.found).toBe(true)
    expect(result.fullKey).toBe('sk-ant-api03-fromoldpath987654')
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('handles malformed JSON gracefully (returns not-found)', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-malformed-${process.pid}`)
    const claudeDir = join(tmpHome, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, '.credentials.json'), '{not valid json')
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    const result = detectClaudeKey()
    expect(result.found).toBe(false)
    rmSync(tmpHome, { recursive: true, force: true })
  })
})

// detectCodexKey:从环境变量或 ~/.codex/auth.json 发现 OpenAI 密钥
describe('detectCodexKey', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY']
  })
  afterEach(() => {
    if (originalHome !== undefined) process.env['HOME'] = originalHome
    else delete process.env['HOME']
    if (originalUserprofile !== undefined) process.env['USERPROFILE'] = originalUserprofile
    else delete process.env['USERPROFILE']
    if (originalOpenai !== undefined) process.env['OPENAI_API_KEY'] = originalOpenai
    else delete process.env['OPENAI_API_KEY']
  })

  it('finds key from OPENAI_API_KEY env var first', () => {
    process.env['OPENAI_API_KEY'] = 'sk-proj-testenvkey456'
    const result = detectCodexKey()
    expect(result.found).toBe(true)
    expect(result.path).toBe('env:OPENAI_API_KEY')
    expect(result.fullKey).toBe('sk-proj-testenvkey456')
    expect(result.maskedKey).toBe('sk-proj-...y456')
  })

  it('reads OPENAI_API_KEY from ~/.codex/auth.json', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-codex-${process.pid}`)
    const codexDir = join(tmpHome, '.codex')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(
      join(codexDir, 'auth.json'),
      JSON.stringify({
        OPENAI_API_KEY: 'sk-proj-fromauthfile789012',
        tokens: { access_token: 'oauth' },
        last_refresh: '2025-01-01T00:00:00Z'
      })
    )
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    const result = detectCodexKey()
    expect(result.found).toBe(true)
    expect(result.fullKey).toBe('sk-proj-fromauthfile789012')
    expect(result.path).toContain('auth.json')
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('ignores non-sk- prefixed values in auth.json', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-codexbad-${process.pid}`)
    const codexDir = join(tmpHome, '.codex')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(join(codexDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'not-a-key' }))
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    const result = detectCodexKey()
    expect(result.found).toBe(false)
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('returns not-found when nothing exists', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-codexnone-${process.pid}`)
    mkdirSync(tmpHome, { recursive: true })
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    expect(detectCodexKey().found).toBe(false)
    rmSync(tmpHome, { recursive: true, force: true })
  })
})

// detectAllCLIKeys:同时返回 Claude 与 Codex 的检测结果
describe('detectAllCLIKeys', () => {
  afterEach(() => {
    if (originalHome !== undefined) process.env['HOME'] = originalHome
    else delete process.env['HOME']
    if (originalUserprofile !== undefined) process.env['USERPROFILE'] = originalUserprofile
    else delete process.env['USERPROFILE']
    if (originalAnthropic !== undefined) process.env['ANTHROPIC_API_KEY'] = originalAnthropic
    else delete process.env['ANTHROPIC_API_KEY']
    if (originalOpenai !== undefined) process.env['OPENAI_API_KEY'] = originalOpenai
    else delete process.env['OPENAI_API_KEY']
  })

  it('returns both detection results', () => {
    const tmpHome = join(tmpdir(), `tokenlub-test-all-${process.pid}`)
    mkdirSync(tmpHome, { recursive: true })
    process.env['HOME'] = tmpHome
    process.env['USERPROFILE'] = tmpHome
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['OPENAI_API_KEY']
    const result = detectAllCLIKeys()
    expect(result).toHaveProperty('claude')
    expect(result).toHaveProperty('codex')
    expect(result.claude.found).toBe(false)
    expect(result.codex.found).toBe(false)
    rmSync(tmpHome, { recursive: true, force: true })
  })
})
