/**
 * 价格目录同步模块:从 models.dev 拉取各模型官方价格 JSON,
 * 将 `provider/model` 前缀映射到 TokenLub 内部 providerId,
 * 并把 USD/每 token 转换为 USD/每百万 token 写入本地价格表。
 * (glm-5.2)
 */
import type { PricingEntry } from '@shared/types/pricing'
import { ProviderError } from '@shared/types/provider'

/**
 * Raw pricing object from models.dev (all values are USD-per-token strings).
 * Extra fields (web_search, image, audio, internal_reasoning) are ignored.
 *
 * models.dev 返回的原始价格对象(值均为 USD/每 token 字符串);额外字段被忽略。 (glm-5.2)
 */
interface CatalogPricing {
  prompt?: string
  completion?: string
  input_cache_read?: string
  input_cache_write?: string
}

/** models.dev 目录单条条目结构(id 形如 "anthropic/claude-opus-4.7-fast")。 (glm-5.2) */
interface CatalogEntry {
  id: string // e.g. "anthropic/claude-opus-4.7-fast"
  name?: string
  pricing?: CatalogPricing
}

/** models.dev 目录响应顶层结构。 (glm-5.2) */
interface CatalogResp {
  data: CatalogEntry[]
}

/** models.dev catalog URL (raw JSON, dev branch - the default).
 *  models.dev 目录 URL(原始 JSON,dev 分支,默认值)。 (glm-5.2) */
export const CATALOG_URL = 'https://raw.githubusercontent.com/anomalyco/models.dev/dev/models.json'

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
  qwen: 'qwen-manual',
  stepfun: 'stepfun'
}

/** models.dev prices are USD per token; TokenLub stores USD per million tokens.
 *  models.dev 价格单位为 USD/每 token,TokenLub 存储为 USD/每百万 token,故乘 1,000,000。 (glm-5.2) */
const PER_TOKEN_TO_PER_MTOK = 1_000_000

/**
 * Parse a price string ("0.00003") into a finite per-million-token number.
 * Returns null when the value is missing, empty, or not a finite number.
 *
 * 将价格字符串解析为有限值并转换为 USD/每百万 token;值缺失、空串或非有限数时返回 null。 (glm-5.2)
 */
function toPerMtok(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null
  const perToken = Number(raw)
  if (!Number.isFinite(perToken)) return null
  return perToken * PER_TOKEN_TO_PER_MTOK
}

/**
 * Transform a single models.dev catalog entry into a TokenLub PricingEntry.
 * Returns null when the entry should be skipped (unknown provider, missing
 * required prices). Pure function - safe to unit test without a DB.
 *
 * 将单条 models.dev 目录条目转换为 TokenLub PricingEntry;未知 provider 或缺少必填价格时返回 null。纯函数,可不依赖 DB 测试。 (glm-5.2)
 */
export function transformCatalogEntry(entry: CatalogEntry): PricingEntry | null {
  const slashIdx = entry.id.indexOf('/')
  if (slashIdx < 0) return null
  const catalogProvider = entry.id.slice(0, slashIdx)
  const model = entry.id.slice(slashIdx + 1)
  if (!model) return null

  const providerId = PROVIDER_MAPPING[catalogProvider]
  if (!providerId) return null // unknown provider — skip

  const pricing = entry.pricing
  if (!pricing) return null

  const promptPricePerMtok = toPerMtok(pricing.prompt)
  const completionPricePerMtok = toPerMtok(pricing.completion)
  // prompt + completion are required; skip entries missing either.
  // prompt 与 completion 为必填,缺少任一则跳过该条目。 (glm-5.2)
  if (promptPricePerMtok === null || completionPricePerMtok === null) return null

  const entry_: PricingEntry = {
    providerId,
    model,
    promptPricePerMtok,
    completionPricePerMtok,
    currency: 'USD',
    source: 'catalog'
  }

  const cacheRead = toPerMtok(pricing.input_cache_read)
  if (cacheRead !== null) entry_.cacheReadPricePerMtok = cacheRead
  const cacheCreation = toPerMtok(pricing.input_cache_write)
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
export async function syncCatalog(upsert: (entries: PricingEntry[]) => void): Promise<{
  synced: number
  skipped: number
}> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CATALOG_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(CATALOG_URL, { signal: ctrl.signal })
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

  if (!res.ok) {
    throw new ProviderError(
      'pricing-catalog',
      'HTTP_ERROR',
      res.status,
      `models.dev catalog fetch failed: ${res.status} ${res.statusText}`
    )
  }

  const body = (await res.json()) as CatalogResp
  const entries: PricingEntry[] = []
  let skipped = 0

  for (const raw of body.data ?? []) {
    const transformed = transformCatalogEntry(raw)
    if (transformed === null) {
      skipped++
      continue
    }
    entries.push(transformed)
  }

  if (entries.length > 0) {
    upsert(entries)
  }

  return { synced: entries.length, skipped }
}
