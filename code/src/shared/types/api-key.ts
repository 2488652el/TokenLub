/**
 * API Key 类型定义:描述用户录入的供应商密钥记录及其创建/更新输入。
 * 涵盖密钥来源、查询模式(auto/manual)与按 Key 的用量开关,供 store 层与 UI 共享。
 * (glm-5.2)
 */

/** 密钥来源:直接录入 API Key / 从 CLI 会话日志导入 / 手动录入余额。 */
export type ApiKeySource = 'api-key' | 'session-log' | 'manual'

/**
 * Whether the api key row's `query_mode` is decided by the provider's manifest
 * category (`auto` for admin-org providers that have a usage API) or by a
 * user-controlled toggle (`manual` everywhere else).
 *
 * Stored as TEXT in api_keys.query_mode (PR-1 v5 migration).
 */
export type QueryMode = 'auto' | 'manual'

/** API Key 记录:对应数据库 api_keys 表的一行,密钥仅保留尾部(keyTail)明文。 */
export interface ApiKeyRecord {
  id: string
  providerId: string
  alias: string
  keyTail: string
  baseUrlOverride?: string
  notes?: string
  source: ApiKeySource
  createdAt: string
  updatedAt: string
  /**
   * Whether usage polling is enabled for this key. Defaults to `true` so
   * pre-existing rows (added before PR-3) remain active after the v5
   * migration; new rows opt-in via {@link ApiKeyCreateInput.usageQueryEnabled}.
   *
   * Optional in the type signature for backward compatibility with older
   * mocks and code paths; the SQLite v5 migration always sets this column
   * (INTEGER NOT NULL DEFAULT 1) so values returned by `rowToRecord` are
   * always defined.
   */
  usageQueryEnabled?: boolean
  /**
   * Whether the scheduler treats this key as `auto` (provider-class-derived)
   * or `manual` (user-toggle). Repository callers may rely on this to decide
   * whether to skip balance/usage calls (PR-3/4 wiring).
   *
   * Stored as TEXT in api_keys.query_mode (PR-1 v5 migration, DEFAULT 'manual').
   */
  queryMode?: QueryMode
}

/** 创建 API Key 的输入参数,由创建模态框构建后通过 IPC 传入主进程。 */
export interface ApiKeyCreateInput {
  providerId: string
  alias: string
  apiKey: string
  baseUrlOverride?: string
  notes?: string
  extra?: Record<string, string>
  /**
   * Whether usage polling should be enabled for this key when it is first
   * created. PR-1 writes this through to the repo; PR-3 handler can override.
   * Default repo behavior (PR-1): `true` for backward compatibility with
   * pre-existing rows.
   */
  usageQueryEnabled?: boolean
}

/** 更新 API Key 的输入参数,部分字段可选(未提供即不修改)。 */
export interface ApiKeyUpdateInput {
  id: string
  alias: string
  apiKey?: string
  baseUrlOverride?: string | null
  notes?: string | null
  extra?: Record<string, string>
}
