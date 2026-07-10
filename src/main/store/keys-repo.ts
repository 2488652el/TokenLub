/**
 * API 密钥仓库:管理 api_keys 表的 CRUD、加密存储与查询模式控制。
 * 该模块属于 main 进程的 store 模块,提供密钥的安全存储(加密)、解密读取与列展开能力。
 * (glm-5.2)
 */
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import { encryptSecret, decryptSecret, keyTail } from '../crypto/safe-storage'
import { deriveQueryMode } from './db-usage-defaults'
import type {
  ApiKeyCreateInput,
  ApiKeyRecord,
  ApiKeyUpdateInput,
  QueryMode
} from '@shared/types/api-key'

/** api_keys 表的数据库行结构映射,含 v5 迁移新增的 usage_query_enabled 与 query_mode 列。 */
interface DbRow {
  id: string
  provider_id: string
  alias: string
  encrypted_key: Buffer
  key_tail: string
  base_url_override: string | null
  notes: string | null
  source: string
  extra_credentials?: string | null
  // PR-1 v5 migration columns. usage_query_enabled is stored as 0/1 INTEGER,
  // query_mode as TEXT ('auto' | 'manual'). Both are constrained at write time
  // by addKey/toggleUsageQuery, so the SELECT-side cast below is safe.
  usage_query_enabled: number
  query_mode: string
  created_at: string
  updated_at: string
}

/** 将 extra 凭据对象加密为 JSON 字符串,空对象返回 null。(内部辅助函数) */
function encryptExtra(extra: Record<string, string> | undefined): string | null {
  if (!extra || Object.keys(extra).length === 0) return null
  const encrypted: Record<string, string> = {}
  for (const [k, v] of Object.entries(extra)) {
    encrypted[k] = encryptSecret(v).toString('base64')
  }
  return JSON.stringify(encrypted)
}

/** 将加密的 extra 凭据 JSON 字符串解密为对象,无效输入返回空对象。(内部辅助函数) */
function decryptExtra(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') continue
    out[k] = decryptSecret(Buffer.from(v, 'base64'))
  }
  return out
}

/** 将数据库行映射为 ApiKeyRecord 对象,处理可选字段的条件展开与 queryMode 类型断言。 */
function rowToRecord(r: DbRow): ApiKeyRecord {
  return {
    id: r.id,
    providerId: r.provider_id,
    alias: r.alias,
    keyTail: r.key_tail,
    source: r.source as ApiKeyRecord['source'],
    usageQueryEnabled: r.usage_query_enabled === 1,
    // query_mode is written by addKey() via deriveQueryMode() and by the v5
    // migration's DEFAULT clause ('manual'), so the runtime values are always
    // one of the QueryMode literals — we assert here to keep the API strict.
    queryMode: r.query_mode as QueryMode,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.base_url_override !== null ? { baseUrlOverride: r.base_url_override } : {}),
    ...(r.notes !== null ? { notes: r.notes } : {})
  }
}

/** 查询所有 API 密钥,按创建时间降序排列。 */
export function listKeys(): ApiKeyRecord[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as DbRow[]
  return rows.map(rowToRecord)
}

/** 按 ID 查询单个 API 密钥,不存在返回 null。 */
export function getKey(id: string): ApiKeyRecord | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as DbRow | undefined
  return row ? rowToRecord(row) : null
}

/** Returns the decrypted API key for in-process use. Renderer NEVER calls this. */
/**
 * 返回解密后的 API 密钥明文,仅供 main 进程内部使用,渲染进程永不调用。
 * @param id 密钥 ID
 * @returns 解密后的密钥字符串;密钥不存在时抛错
 * (glm-5.2)
 */
export function getDecryptedKey(id: string): string {
  const db = getDb()
  const row = db.prepare('SELECT encrypted_key FROM api_keys WHERE id = ?').get(id) as
    { encrypted_key: Buffer } | undefined
  if (!row) throw new Error(`api key not found: ${id}`)
  return decryptSecret(row.encrypted_key)
}

/** Returns decrypted provider-specific credentials for in-process use only. */
/**
 * 返回解密后的供应商专属凭据(如 adminKey),仅供 main 进程内部使用。
 * @param id 密钥 ID
 * @returns 凭据键值对;密钥不存在时抛错
 * (glm-5.2)
 */
export function getDecryptedExtraCredentials(id: string): Record<string, string> {
  const db = getDb()
  const row = db.prepare('SELECT extra_credentials FROM api_keys WHERE id = ?').get(id) as
    { extra_credentials: string | null } | undefined
  if (!row) throw new Error(`api key not found: ${id}`)
  return decryptExtra(row.extra_credentials)
}

/**
 * 新增一条 API 密钥,加密存储密钥与 extra 凭据,queryMode 由供应商 category 自动推导。
 * @param input 含 providerId、alias、apiKey 的创建输入
 * @returns 完整的 ApiKeyRecord 对象(含生成的 id 与时间戳)
 */
export function addKey(
  input: ApiKeyCreateInput & { source?: ApiKeyRecord['source'] }
): ApiKeyRecord {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  const encrypted = encryptSecret(input.apiKey)
  const extraCredentials = encryptExtra(input.extra)
  const tail = keyTail(input.apiKey)
  // PR-1: usage is enabled by default for new keys (backward-compatible with
  // pre-v5 rows where the column defaults to 1). PR-3 handler may override to
  // false at creation time via ApiKeyCreateInput.usageQueryEnabled.
  const usageQueryEnabled = input.usageQueryEnabled ?? true
  // PR-1: queryMode is derived from the provider's manifest category —
  // callers cannot override (avoids tier-of-trust escalation in the UI).
  const queryMode = deriveQueryMode(input.providerId)
  db.prepare(
    `
    INSERT INTO api_keys
      (id, provider_id, alias, encrypted_key, key_tail, base_url_override, notes, source, extra_credentials, usage_query_enabled, query_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    input.providerId,
    input.alias,
    encrypted,
    tail,
    input.baseUrlOverride ?? null,
    input.notes ?? null,
    input.source ?? 'api-key',
    extraCredentials,
    usageQueryEnabled ? 1 : 0,
    queryMode,
    now,
    now
  )
  return {
    id,
    providerId: input.providerId,
    alias: input.alias,
    keyTail: tail,
    source: input.source ?? 'api-key',
    usageQueryEnabled,
    queryMode,
    createdAt: now,
    updatedAt: now,
    ...(input.baseUrlOverride !== undefined ? { baseUrlOverride: input.baseUrlOverride } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {})
  }
}

/**
 * 更新一条 API 密钥,可选更新密钥明文与 extra 凭据(合并已有凭据)。
 * @param input 含 id 与更新字段的输入
 * @returns 更新后的 ApiKeyRecord 对象;密钥不存在时抛错
 */
export function updateKey(input: ApiKeyUpdateInput): ApiKeyRecord {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(input.id) as
    DbRow | undefined
  if (!existing) throw new Error(`api key not found: ${input.id}`)

  const now = new Date().toISOString()
  const nextKey = input.apiKey?.trim()
  const encrypted = nextKey ? encryptSecret(nextKey) : existing.encrypted_key
  const tail = nextKey ? keyTail(nextKey) : existing.key_tail
  const mergedExtra = { ...decryptExtra(existing.extra_credentials), ...(input.extra ?? {}) }
  const nextExtra = Object.keys(mergedExtra).length > 0 ? encryptExtra(mergedExtra) : null

  db.prepare(
    `
    UPDATE api_keys
    SET alias = ?,
        encrypted_key = ?,
        key_tail = ?,
        base_url_override = ?,
        notes = ?,
        extra_credentials = ?,
        updated_at = ?
    WHERE id = ?
  `
  ).run(
    input.alias,
    encrypted,
    tail,
    input.baseUrlOverride ?? null,
    input.notes ?? null,
    nextExtra,
    now,
    input.id
  )

  return {
    id: existing.id,
    providerId: existing.provider_id,
    alias: input.alias,
    keyTail: tail,
    source: existing.source as ApiKeyRecord['source'],
    usageQueryEnabled: existing.usage_query_enabled === 1,
    queryMode: existing.query_mode as QueryMode,
    createdAt: existing.created_at,
    updatedAt: now,
    ...(input.baseUrlOverride ? { baseUrlOverride: input.baseUrlOverride } : {}),
    ...(input.notes ? { notes: input.notes } : {})
  }
}

/** 删除指定 API 密钥。 */
export function deleteKey(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id)
}

/**
 * Toggle the per-row `usage_query_enabled` flag. Used by PR-3 settings UI /
 * scheduler skip logic. Returns nothing - callers that need the fresh state
 * should `listKeys()` afterward to avoid a second SELECT round-trip per call.
 * 切换单行 usage_query_enabled 标志,供设置 UI 与调度器跳过逻辑使用;调用方需自行 listKeys() 获取最新状态。(glm-5.2)
 */
export function toggleUsageQuery(id: string, enabled: boolean): void {
  const db = getDb()
  db.prepare('UPDATE api_keys SET usage_query_enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    new Date().toISOString(),
    id
  )
}
