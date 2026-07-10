/**
 * Provider 类型定义模块:定义 TokenLub 中"供应商(Provider)"相关的核心类型。
 * 包含供应商清单(Manifest)、余额快照、用量切片、能力声明与统一错误类型等,
 * 是主进程 providers 实现层与渲染层共享的数据契约。
 * (glm-5.2)
 */

/** 供应商分类,决定 UI 分组与默认查询行为。 */
export type ProviderCategory =
  'token-plan' | 'third-party' | 'admin-org' | 'newapi-generic' | 'manual'

/** 供应商支持的功能集合:余额查询 / 用量查询 / 费用计算。 */
export type SupportedFeature = 'balance' | 'usage' | 'cost'

/**
 * Wire protocol used to call the provider's API. Drives how the UI describes
 * the provider (model picker defaults, error hints) and which provider-implementation
 * code path is selected at runtime. See `src/main/providers/*` for the
 * concrete HTTP clients.
 *
 * - `openai-compatible` — OpenAI Chat Completions shape (`/v1/chat/completions`)
 * - `anthropic-compatible` — Anthropic Messages shape (`/v1/messages`)
 * - `anthropic-admin` — Anthropic Admin org endpoints (cost_report / usage)
 * - `openai-admin` — OpenAI Organization usage/cost endpoints
 * - `native` — vendor-proprietary (Zhipu, DeepSeek, NewAPI/OneAPI)
 * - `manual` — no remote endpoint, user-entered only
 */
export type ProviderProtocol =
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'anthropic-admin'
  | 'openai-admin'
  | 'native'
  | 'manual'

/** 供应商清单:描述一个供应商的静态元信息(用于 UI 展示与路由)。 */
export interface ProviderManifest {
  id: string
  displayName: string
  category: ProviderCategory
  features: readonly SupportedFeature[]
  docsUrl?: string
  accentColor?: string
  /**
   * Default base URL advertised by the vendor docs. Used by the CreateKeyModal
   * to pre-fill the optional override field. Empty string when the provider
   * requires a custom URL (e.g. NewAPI/OneAPI self-hosted).
   */
  defaultBaseUrl?: string
  /**
   * Wire protocol hint for the UI. Optional — providers that omit it fall back
   * to `native` in the renderer. Admin and manual providers MUST set this
   * explicitly so the picker renders the right hint.
   */
  protocol?: ProviderProtocol
  /**
   * Suggested model ids the user is most likely to want to query. Surfaced in
   * the modal as a read-only hint; the catalog in `pricing/` is the source of
   * truth for pricing data.
   */
  defaultModels?: readonly string[]
  /**
   * Where to create / manage API keys for this provider. Clicked via
   * `shell.openExternal` (or in-app deep link for the manual case).
   */
  signupUrl?: string
  /**
   * Short user-facing hint shown below the alias input. Should be one line
   * of plain Chinese / English that explains a non-obvious gotcha (currency,
   * region endpoint, key naming, etc.). Keep under 80 chars.
   */
  note?: string
}

/** 余额快照:某一时刻从供应商处抓取的余额信息。 */
export interface BalanceSnapshot {
  providerId: string
  capturedAt: string
  total?: number
  used?: number
  remaining?: number
  currency?: string
  raw?: unknown
}

/** 用量切片:一段时间窗口内的模型用量与费用统计。 */
export interface UsageSlice {
  providerId: string
  periodStart: string
  periodEnd: string
  model?: string
  promptTokens?: number
  completionTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  totalTokens?: number
  cost?: number
  currency?: string
  source?: 'vendor-api' | 'session-log'
  raw?: unknown
}

/** 供应商连通性测试结果。 */
export interface ProviderTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}

/** 供应商凭据:调用供应商 API 所需的鉴权信息。 */
export interface ProviderCredentials {
  baseUrl: string
  apiKey: string
  /** Extra credential slot for providers that need it (Anthropic Admin admin-key, NewAPI user-id, etc). */
  extra?: Readonly<Record<string, string>>
}

/** 供应商能力声明:表示该供应商可被调用的能力(balance/usage/testConnection)。 */
export interface ProviderCapabilities {
  /** Optional: providers without a balance API (Manual / Qwen) omit this. */
  balance?: () => Promise<BalanceSnapshot>
  usage?: (fromISO: string, toISO: string) => Promise<UsageSlice[]>
  testConnection: () => Promise<ProviderTestResult>
}

/** 供应商实现接口:清单 + 能力标志 + 工厂方法,由各 provider 注册。 */
export interface ProviderImpl {
  manifest: ProviderManifest
  hasBalanceApi: boolean
  hasUsageApi: boolean
  build: (credentials: ProviderCredentials) => ProviderCapabilities
}

/** 供应商统一错误类型,携带 providerId / 错误码 / HTTP 状态码,便于 UI 定位。 */
export class ProviderError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly code: string,
    public readonly status?: number,
    message?: string
  ) {
    super(message ?? `[${providerId}] ${code}${status ? ` (HTTP ${status})` : ''}`)
    this.name = 'ProviderError'
  }
}
