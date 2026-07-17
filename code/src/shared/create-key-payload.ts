import type { ApiKeyCreateInput } from '../shared/types/api-key'
import type { ProviderCatalogEntry } from '../shared/provider-catalog'

/**
 * Pure helper used by the "create new key" modal to build the
 * `ApiKeyCreateInput` payload from form state.
 *
 * Lives in `shared/` (not in `renderer/components/`) so we can unit-test the
 * form-to-IPC mapping without spinning up a DOM environment. The modal calls
 * this on submit and forwards the result to `window.api.keys.add`.
 *
 * Validation rules:
 * - `alias` and `apiKey` must be non-empty after trim
 * - providers that need a base URL (`newapi-generic`) must supply a non-empty
 *   `baseUrl`
 * - `adminKey` is included in `extra` only when non-empty AND the provider's
 *   protocol is `anthropic-admin` or `openai-admin`
 * - LongCat platform Cookie is included in `extra.longcatPlatformCookie` only
 *   for LongCat, and is used by the main process to read Token Pack balance
 *
 * 中文说明:纯函数,把"创建密钥"表单状态转换为 IPC 入参,并做必填校验。
 * (glm-5.2)
 */
/** 创建密钥的表单状态(对应模态框各输入字段)。 */
export interface CreateKeyFormState {
  providerId: string
  alias: string
  apiKey: string
  adminKey: string
  platformCookie?: string
  baseUrl: string
  notes: string
}

/** 构建结果:成功时携带 IPC 入参,失败时携带原因字符串。 */
export type CreateKeyPayloadResult =
  | {
      ok: true
      input: ApiKeyCreateInput
      notes: { adminKeyStored: boolean; platformCookieStored: boolean }
    }
  | { ok: false; reason: string }

/**
 * 根据表单状态与供应商目录构建 IPC 创建入参。
 * @param state 表单状态
 * @param catalog 供应商目录
 * @returns 成功返回入参,失败返回原因
 */
export function buildCreateKeyPayload(
  state: CreateKeyFormState,
  catalog: readonly ProviderCatalogEntry[]
): CreateKeyPayloadResult {
  const entry = catalog.find((c) => c.id === state.providerId)
  if (!entry) return { ok: false, reason: `unknown provider: ${state.providerId}` }

  const alias = state.alias.trim()
  const apiKey = state.apiKey.trim()
  if (alias.length === 0) return { ok: false, reason: 'alias is required' }
  if (apiKey.length === 0) return { ok: false, reason: 'apiKey is required' }

  const needsBaseUrl = entry.id === 'newapi-generic'
  const baseUrl = state.baseUrl.trim()
  if (needsBaseUrl && baseUrl.length === 0) {
    return { ok: false, reason: 'baseUrl is required for newapi-generic' }
  }

  const needsAdminKey = entry.protocol === 'anthropic-admin' || entry.protocol === 'openai-admin'
  const adminKey = state.adminKey.trim()
  const extra: Record<string, string> = {}
  let adminKeyStored = false
  let platformCookieStored = false
  if (needsAdminKey && adminKey.length > 0) {
    extra.adminKey = adminKey
    adminKeyStored = true
  }
  if (entry.id === 'longcat' && state.platformCookie?.trim()) {
    extra.longcatPlatformCookie = state.platformCookie.trim()
    platformCookieStored = true
  }

  const input: ApiKeyCreateInput = {
    providerId: entry.id,
    alias,
    apiKey,
    ...(state.notes.trim() ? { notes: state.notes.trim() } : {}),
    ...(baseUrl ? { baseUrlOverride: baseUrl } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {})
  }

  return { ok: true, input, notes: { adminKeyStored, platformCookieStored } }
}
