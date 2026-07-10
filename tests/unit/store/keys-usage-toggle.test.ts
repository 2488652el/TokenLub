/**
 * API Key 用量查询开关存储测试:覆盖 addKey 默认值、deriveQueryMode 派生、显式禁用与 toggleUsageQuery UPDATE 语句。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveQueryMode } from '../../../src/main/store/db-usage-defaults'

interface ApiKeyRow {
  id: string
  provider_id: string
  alias: string
  encrypted_key: Buffer
  key_tail: string
  base_url_override: string | null
  notes: string | null
  source: string
  extra_credentials: string | null
  usage_query_enabled: number
  query_mode: string
  created_at: string
  updated_at: string
}

const rows = new Map<string, ApiKeyRow>()
const capturedRuns: Array<{ sql: string; args: unknown[] }> = []

function fakeDb() {
  return {
    prepare(sql: string) {
      return {
        run: (...args: unknown[]) => {
          capturedRuns.push({ sql, args })
          if (sql.includes('INSERT INTO api_keys')) {
            const [
              id,
              providerId,
              alias,
              encryptedKey,
              keyTail,
              baseUrlOverride,
              notes,
              source,
              extraCredentials,
              usageQueryEnabled,
              queryMode,
              createdAt,
              updatedAt
            ] = args
            rows.set(String(id), {
              id: String(id),
              provider_id: String(providerId),
              alias: String(alias),
              encrypted_key: encryptedKey as Buffer,
              key_tail: String(keyTail),
              base_url_override: baseUrlOverride as string | null,
              notes: notes as string | null,
              source: String(source),
              extra_credentials: extraCredentials as string | null,
              usage_query_enabled: Number(usageQueryEnabled),
              query_mode: String(queryMode),
              created_at: String(createdAt),
              updated_at: String(updatedAt)
            })
            return { changes: 1 }
          }
          if (sql.includes('UPDATE api_keys SET usage_query_enabled')) {
            // find target row by scanning rows for matching id (last positional arg)
            const id = String(args[2])
            const row = rows.get(id)
            if (!row) return { changes: 0 }
            row.usage_query_enabled = Number(args[0])
            row.updated_at = String(args[1])
            return { changes: 1 }
          }
          return { changes: 0 }
        },
        get: (id: string) => {
          const row = rows.get(id)
          if (!row) return undefined
          if (sql.includes('SELECT extra_credentials')) {
            return { extra_credentials: row.extra_credentials }
          }
          if (sql.includes('SELECT encrypted_key')) {
            return { encrypted_key: row.encrypted_key }
          }
          return row
        },
        all: () => [...rows.values()]
      }
    }
  }
}

async function loadKeysRepo() {
  vi.resetModules()
  rows.clear()
  capturedRuns.length = 0
  vi.doMock('electron', () => ({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plain: string) =>
        Buffer.from(`cipher:${Buffer.from(plain, 'utf8').toString('base64')}`),
      decryptString: (blob: Buffer) => {
        const raw = blob.toString('utf8')
        if (!raw.startsWith('cipher:')) throw new Error('invalid cipher text')
        return Buffer.from(raw.slice('cipher:'.length), 'base64').toString('utf8')
      }
    }
  }))
  vi.doMock('../../../src/main/store/db', () => ({ getDb: fakeDb }))
  return import('../../../src/main/store/keys-repo')
}

// PR-1 API Key 用量开关存储测试组:覆盖默认值、派生模式、显式禁用与 UPDATE 语句
describe('PR-1: api key usage-toggle storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('addKey writes usage_query_enabled (1) and derives query_mode from provider category', async () => {
    const { addKey } = await loadKeysRepo()

    const saved = addKey({
      providerId: 'anthropic-admin',
      alias: 'Anthropic Org',
      apiKey: 'sk-test-secret'
    })

    const stored = rows.get(saved.id)
    expect(stored).toBeDefined()
    // Default true: PR-1 keeps backward-compat with pre-v5 rows that defaulted to 1.
    expect(stored?.usage_query_enabled).toBe(1)
    // anthropic-admin has manifest.category === 'admin-org' so deriveQueryMode must yield 'auto'.
    expect(stored?.query_mode).toBe('auto')

    // The returned record must echo the persisted values so PR-3 callers can
    // read them without a second SELECT.
    expect(saved.usageQueryEnabled).toBe(true)
    expect(saved.queryMode).toBe('auto')
  })

  it('deriveQueryMode yields manual for non-admin-org providers', async () => {
    expect(deriveQueryMode('deepseek')).toBe('manual')
    expect(deriveQueryMode('anthropic-admin')).toBe('auto')
    // unknown provider falls back to manual (callers can opt in via toggle).
    expect(deriveQueryMode('does-not-exist')).toBe('manual')
  })

  it('addKey honors an explicit usageQueryEnabled=false from the caller', async () => {
    const { addKey } = await loadKeysRepo()

    const saved = addKey({
      providerId: 'deepseek',
      alias: 'DeepSeek',
      apiKey: 'sk-deepseek-secret',
      usageQueryEnabled: false
    })

    expect(rows.get(saved.id)?.usage_query_enabled).toBe(0)
    expect(saved.usageQueryEnabled).toBe(false)
    // queryMode is always derived, never caller-controlled.
    expect(rows.get(saved.id)?.query_mode).toBe('manual')
  })

  it('toggleUsageQuery issues the expected UPDATE with the correct column and parameters', async () => {
    const { addKey, toggleUsageQuery } = await loadKeysRepo()

    const saved = addKey({
      providerId: 'deepseek',
      alias: 'DeepSeek',
      apiKey: 'sk-deepseek-secret'
    })
    expect(rows.get(saved.id)?.usage_query_enabled).toBe(1)

    // Reset capture so we isolate the UPDATE statement.
    capturedRuns.length = 0

    toggleUsageQuery(saved.id, false)

    const update = capturedRuns.find((r) => r.sql.includes('UPDATE api_keys'))
    expect(update).toBeDefined()
    expect(update!.sql).toContain('SET usage_query_enabled = ?, updated_at = ?')
    expect(update!.sql).toContain('WHERE id = ?')
    expect(update!.args[0]).toBe(0)
    expect(typeof update!.args[1]).toBe('string')
    expect(update!.args[2]).toBe(saved.id)
    expect(rows.get(saved.id)?.usage_query_enabled).toBe(0)

    toggleUsageQuery(saved.id, true)
    expect(rows.get(saved.id)?.usage_query_enabled).toBe(1)
  })
})
