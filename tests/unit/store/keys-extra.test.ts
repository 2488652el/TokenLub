/**
 * API Key 额外凭证存储测试:覆盖 extra credentials 加密存储、列表隐藏与更新合并。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

function fakeDb() {
  return {
    prepare(sql: string) {
      return {
        run: (...args: unknown[]) => {
          if (sql.includes('UPDATE api_keys')) {
            const [
              alias,
              encryptedKey,
              keyTail,
              baseUrlOverride,
              notes,
              extraCredentials,
              updatedAt,
              id
            ] = args
            const row = rows.get(String(id))
            if (!row) return { changes: 0 }
            row.alias = String(alias)
            row.encrypted_key = encryptedKey as Buffer
            row.key_tail = String(keyTail)
            row.base_url_override = baseUrlOverride as string | null
            row.notes = notes as string | null
            row.extra_credentials = extraCredentials as string | null
            row.updated_at = String(updatedAt)
            return { changes: 1 }
          }
          if (!sql.includes('INSERT INTO api_keys')) return { changes: 0 }
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

// API Key 额外凭证存储测试组:覆盖加密存储、列表隐藏与更新合并
describe('api key extra credential storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('encrypts extra admin credentials without exposing them through listKeys', async () => {
    const { addKey, getDecryptedExtraCredentials, listKeys } = await loadKeysRepo()

    const saved = addKey({
      providerId: 'openai-admin',
      alias: 'OpenAI Admin',
      apiKey: 'sk-primary-secret',
      extra: { adminKey: 'sk-admin-secret' }
    })

    const stored = rows.get(saved.id)
    expect(stored?.extra_credentials).toBeTypeOf('string')
    expect(stored?.extra_credentials).not.toContain('sk-admin-secret')
    expect(getDecryptedExtraCredentials(saved.id)).toEqual({ adminKey: 'sk-admin-secret' })
    expect(listKeys()[0]).toEqual(
      expect.not.objectContaining({
        extra: expect.anything()
      })
    )
  })

  it('updates editable fields and merges replacement extra credentials', async () => {
    const { addKey, getDecryptedExtraCredentials, getDecryptedKey, updateKey } =
      await loadKeysRepo()

    const saved = addKey({
      providerId: 'openai-admin',
      alias: 'OpenAI Admin',
      apiKey: 'sk-primary-secret',
      extra: { adminKey: 'sk-admin-secret' }
    })

    const updated = updateKey({
      id: saved.id,
      alias: 'OpenAI Admin Renamed',
      apiKey: 'sk-new-primary-secret',
      baseUrlOverride: 'https://api.openai.com/v1',
      notes: 'rotated',
      extra: { adminKey: 'sk-new-admin-secret' }
    })

    expect(updated.alias).toBe('OpenAI Admin Renamed')
    expect(updated.keyTail).toBe('cret')
    expect(updated.baseUrlOverride).toBe('https://api.openai.com/v1')
    expect(updated.notes).toBe('rotated')
    expect(getDecryptedKey(saved.id)).toBe('sk-new-primary-secret')
    expect(getDecryptedExtraCredentials(saved.id)).toEqual({ adminKey: 'sk-new-admin-secret' })
  })

  it('rejects origin change when apiKey is omitted', async () => {
    const { addKey, updateKey } = await loadKeysRepo()
    const saved = addKey({
      providerId: 'newapi-generic',
      alias: 'OpenAI Admin',
      apiKey: 'sk-primary-secret',
      baseUrlOverride: 'http://127.0.0.1:3000'
    })

    expect(() =>
      updateKey({
        id: saved.id,
        alias: saved.alias,
        baseUrlOverride: 'http://10.0.0.8:3000'
      })
    ).toThrow(/credential/i)
  })

  it('rejects origin change when apiKey is whitespace only', async () => {
    const { addKey, updateKey } = await loadKeysRepo()
    const saved = addKey({
      providerId: 'newapi-generic',
      alias: 'NewAPI',
      apiKey: 'sk-primary-secret',
      baseUrlOverride: 'http://127.0.0.1:3000'
    })

    expect(() => updateKey({
      id: saved.id,
      alias: saved.alias,
      apiKey: '   ',
      baseUrlOverride: 'https://proxy.example'
    })).toThrow(/credential/i)
  })

  it('rejects origin change when an existing extra credential is omitted', async () => {
    const { addKey, updateKey } = await loadKeysRepo()
    const saved = addKey({
      providerId: 'newapi-generic',
      alias: 'OpenAI Admin',
      apiKey: 'sk-primary-secret',
      baseUrlOverride: 'http://127.0.0.1:3000',
      extra: { adminKey: 'sk-admin-secret' }
    })

    expect(() => updateKey({
      id: saved.id,
      alias: saved.alias,
      apiKey: 'sk-replacement',
      baseUrlOverride: 'http://192.168.1.10:3000'
    })).toThrow(/credential/i)
  })
})
