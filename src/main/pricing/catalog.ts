/**
 * 价格目录同步模块:从 models.dev 正式 API 拉取各 Provider 的模型价格,
 * 映射到 TokenLub providerId,并保留其 USD/每百万 token 原始单位。
 * (glm-5.2)
 */
import type { PricingEntry } from '@shared/types/pricing'
import { ProviderError } from '@shared/types/provider'
import { DEFAULT_BILLING_SCOPE } from '@shared/pricing-scope'

/**
 * Raw pricing object from models.dev (scalar values are USD per million tokens).
 * Extra fields (web_search, image, audio, internal_reasoning) are ignored.
 *
 * models.dev 返回的原始价格对象(标量值为 USD/百万 token);额外字段被忽略。 (glm-5.2)
 */
interface CatalogCost {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
}

/** models.dev `api.json` 中的模型条目。 */
interface CatalogModel {
  id?: string
  name?: string
  cost?: CatalogCost
}

/** models.dev `api.json` 中的 Provider 条目。 */
interface CatalogProvider {
  models?: Record<string, CatalogModel>
}

type CatalogResponse = Record<string, CatalogProvider>

/** models.dev 对外承诺的正式 Provider API。 */
export const CATALOG_URL = 'https://models.dev/api.json'

/** HTTP fetch timeout for catalog sync (30s - the file is ~500KB).
 *  目录同步的 HTTP 拉取超时(30 秒,文件约 500KB)。 (glm-5.2) */
const CATALOG_TIMEOUT_MS = 30_000

/**
 * Map models.dev provider prefixes to TokenLub providerIds.
 *
 * models.dev uses `provider/model` ids (e.g. `anthropic/claude-opus-4.7-fast`).
 * TokenLub uses distinct ids for admin-vs-API providers
 * (`anthropic-admin` = org cost API, vs the public `anthropic` API). We map the
 * catalog's `anthropic` to `anthropic-admin` because the prices are the same
 * and TokenLub's cost calculations target the admin/org view.
 *
 * Providers not in this map are skipped during sync (e.g. `google` has no
 * TokenLub equivalent - Gemini uses a manual free-tier provider; `siliconflow`
 * is an aggregator whose prices differ from upstream models).
 *
 * 将 models.dev 的 provider 前缀映射到 TokenLub providerId;不在映射表中的 provider 在同步时跳过。 (glm-5.2)
 */
export const PROVIDER_MAPPING: Readonly<Record<string, string>> = {
  anthropic: 'anthropic-admin',
  openai: 'openai-admin',
  deepseek: 'deepseek',
  moonshotai: 'moonshot',
  alibaba: 'qwen-manual',
  stepfun: 'stepfun',
  zhipuai: 'zhipu',
  minimax: 'minimax',
  longcat: 'longcat',
  siliconflow: 'siliconflow',
  openrouter: 'openrouter',
  google: 'gemini-manual'
}

/** models.dev 中只有部分直连 Provider 明确对应国际站价格。 */
export const PROVIDER_SCOPE_MAPPING: Readonly<Record<string, string>> = {
  moonshotai: 'global',
  minimax: 'global'
}

/** 完整目录成功下载后需要参与失效对账的 TokenLub provider + scope 集合。 */
export const CATALOG_MANAGED_SCOPES = Object.freeze(
  Object.entries(PROVIDER_MAPPING).map(([catalogProvider, providerId]) => ({
    providerId,
    billingScope: PROVIDER_SCOPE_MAPPING[catalogProvider] ?? DEFAULT_BILLING_SCOPE
  }))
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 官方 API 的价格已经是 USD/百万 token，只接受有限非负数。 */
function toPerMtok(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
}

/**
 * Transform a single models.dev catalog entry into a TokenLub PricingEntry.
 * Returns null when the entry should be skipped (unknown provider, missing
 * required prices). Pure function - safe to unit test without a DB.
 *
 * 将单条 models.dev 目录条目转换为 TokenLub PricingEntry;未知 provider 或缺少必填价格时返回 null。纯函数,可不依赖 DB 测试。 (glm-5.2)
 */
export function transformCatalogModel(
  catalogProvider: string,
  modelId: string,
  entry: CatalogModel
): PricingEntry | null {
  const providerId = PROVIDER_MAPPING[catalogProvider]
  if (!providerId || !modelId.trim()) return null

  const cost = entry.cost
  if (!cost) return null

  const promptPricePerMtok = toPerMtok(cost.input)
  const completionPricePerMtok = toPerMtok(cost.output)
  if (promptPricePerMtok === null || completionPricePerMtok === null) return null

  const entry_: PricingEntry = {
    providerId,
    model: modelId,
    promptPricePerMtok,
    completionPricePerMtok,
    currency: 'USD',
    billingScope: PROVIDER_SCOPE_MAPPING[catalogProvider] ?? DEFAULT_BILLING_SCOPE,
    source: 'catalog',
    catalogActive: true
  }

  const cacheRead = toPerMtok(cost.cache_read)
  if (cacheRead !== null) entry_.cacheReadPricePerMtok = cacheRead
  const cacheCreation = toPerMtok(cost.cache_write)
  if (cacheCreation !== null) entry_.cacheCreationPricePerMtok = cacheCreation

  return entry_
}

/**
 * Sync the models.dev pricing catalog into the local DB.
 *
 * Fetches the catalog JSON, transforms matching entries, and upserts them
 * with `source='catalog'`. Existing `source='user'` entries are preserved
 * (upsertCatalogBatch only overwrites prior catalog rows).
 *
 * @returns `{ synced, skipped }` - synced = entries written, skipped = entries
 * that didn't match the provider map or lacked required prices.
 *
 * 返回值:`{ synced, skipped }`,synced 为已写入条目数,skipped 为未匹配 provider 或缺价格而跳过的条目数。 (glm-5.2)
 */
export interface CatalogFetchOptions {
  etag?: string
}

export interface CatalogFetchResult {
  synced: number
  skipped: number
  protected: number
  notModified: boolean
  checkedAt: string
  etag?: string
}

interface CatalogUpsertResult {
  updated: number
  skipped: number
}

export async function syncCatalog(
  upsert: (entries: PricingEntry[]) => CatalogUpsertResult | void,
  options: CatalogFetchOptions = {}
): Promise<CatalogFetchResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CATALOG_TIMEOUT_MS)
  const headers = new Headers()
  if (options.etag) headers.set('If-None-Match', options.etag)

  let res: Response
  try {
    res = await fetch(CATALOG_URL, { signal: ctrl.signal, headers })
  } catch (e) {
    clearTimeout(timer)
    throw new ProviderError(
      'pricing-catalog',
      'NETWORK_ERROR',
      undefined,
      `Failed to fetch models.dev catalog: ${(e as Error).message}`
    )
  }
  clearTimeout(timer)

  const checkedAt = new Date().toISOString()
  const etag = res.headers.get('etag') ?? options.etag
  if (res.status === 304) {
    return {
      synced: 0,
      skipped: 0,
      protected: 0,
      notModified: true,
      checkedAt,
      ...(etag ? { etag } : {})
    }
  }

  if (!res.ok) {
    throw new ProviderError(
      'pricing-catalog',
      'HTTP_ERROR',
      res.status,
      `models.dev catalog fetch failed: ${res.status} ${res.statusText}`
    )
  }

  const rawBody: unknown = await res.json()
  if (!isRecord(rawBody)) {
    throw new ProviderError(
      'pricing-catalog',
      'INVALID_RESPONSE',
      undefined,
      'Invalid models.dev catalog'
    )
  }
  const body = rawBody as CatalogResponse
  const entries: PricingEntry[] = []
  let skipped = 0

  for (const [catalogProvider, provider] of Object.entries(body)) {
    if (!isRecord(provider) || !isRecord(provider.models)) continue
    for (const [modelId, rawModel] of Object.entries(provider.models)) {
      if (!isRecord(rawModel)) {
        skipped++
        continue
      }
      const transformed = transformCatalogModel(catalogProvider, modelId, rawModel as CatalogModel)
      if (transformed === null) {
        skipped++
        continue
      }
      entries.push(transformed)
    }
  }

  let applied: CatalogUpsertResult = { updated: 0, skipped: 0 }
  if (entries.length > 0) {
    const result = upsert(entries)
    applied = result ?? { updated: entries.length, skipped: 0 }
  }

  return {
    synced: applied.updated,
    skipped,
    protected: applied.skipped,
    notModified: false,
    checkedAt,
    ...(etag ? { etag } : {})
  }
}
