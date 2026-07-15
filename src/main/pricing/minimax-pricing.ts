/**
 * MiniMax 价格常量与播种模块:维护 MiniMax 官方按量付费价格表(CNY/每百万 token),
 * 并在应用启动时以幂等方式写入本地价格表(不覆盖用户已配置的行)。
 * (glm-5.2)
 */
import type { PricingEntry } from '@shared/types/pricing'

/**
 * MiniMax official pay-as-you-go prices (CNY per 1,000,000 tokens).
 *
 * Source: https://platform.minimaxi.com/docs/guides/pricing-paygo
 * Captured 2026-07-08. MiniMax bills in CNY on the China platform; the
 * international site (minimax.io) bills in USD and is NOT covered here.
 *
 * Notes:
 * - MiniMax-M3 is on "永久五折" (permanent 50% off). The numbers below are the
 *   currently-charged (discounted) rates for the ≤512k input tier. Requests
 *   whose input exceeds 512k tokens are billed at 2x - not modeled here, so
 *   long-context runs will be under-costed.
 * - M2.x are legacy models; kept so historical session logs still get costed.
 * - abab6.5 / abab6.5s / abab7 / minimax-text-01 were moved to "历史接口" and
 *   are no longer in the published price table; their rates are intentionally
 *   omitted (unconfirmed) rather than guessed.
 * - cache_read is the Prompt-cache hit price (a fraction of input).
 * - cache_creation is only documented for the M2.x family (¥2.625/Mtok); M3
 *   has no separate cache-write column, so it is left undefined for M3 and
 *   cache writes are priced as normal input.
 *
 * These rows are seeded as `source='catalog'` via {@link seedMinimaxPricing}
 * on app start. They never overwrite a user-configured row (`source='user'`)
 * for the same (provider_id, model, currency) key - that guard lives in
 * `upsertCatalogBatch`'s ON CONFLICT clause.
 *
 * 中文说明:MiniMax 官方按量付费价格表(单位 CNY/每百万 token);来源中国平台,
 * 国际站(minimax.io,USD 计费)未涵盖;这些行作为 source='catalog' 播种,绝不覆盖 source='user' 的用户行。 (glm-5.2)
 */
export const MINIMAX_PRICING: readonly Omit<PricingEntry, 'id' | 'updatedAt'>[] = [
  // --- MiniMax-M3 (current flagship, permanent 50% off, ≤512k tier) ---
  {
    providerId: 'minimax',
    model: 'MiniMax-M3',
    promptPricePerMtok: 2.1,
    completionPricePerMtok: 8.4,
    cacheReadPricePerMtok: 0.42,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  },
  // --- M2.7 family (legacy) ---
  {
    providerId: 'minimax',
    model: 'MiniMax-M2.7',
    promptPricePerMtok: 2.1,
    completionPricePerMtok: 8.4,
    cacheReadPricePerMtok: 0.42,
    cacheCreationPricePerMtok: 2.625,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  },
  {
    providerId: 'minimax',
    model: 'MiniMax-M2.7-highspeed',
    promptPricePerMtok: 4.2,
    completionPricePerMtok: 16.8,
    cacheReadPricePerMtok: 0.42,
    cacheCreationPricePerMtok: 2.625,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  },
  // --- M2.5 family (legacy) ---
  {
    providerId: 'minimax',
    model: 'MiniMax-M2.5',
    promptPricePerMtok: 2.1,
    completionPricePerMtok: 8.4,
    cacheReadPricePerMtok: 0.21,
    cacheCreationPricePerMtok: 2.625,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  },
  {
    providerId: 'minimax',
    model: 'MiniMax-M2.5-highspeed',
    promptPricePerMtok: 4.2,
    completionPricePerMtok: 16.8,
    cacheReadPricePerMtok: 0.21,
    cacheCreationPricePerMtok: 2.625,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  },
  // --- M2.1 family (legacy) ---
  {
    providerId: 'minimax',
    model: 'MiniMax-M2.1',
    promptPricePerMtok: 2.1,
    completionPricePerMtok: 8.4,
    cacheReadPricePerMtok: 0.21,
    cacheCreationPricePerMtok: 2.625,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  },
  {
    providerId: 'minimax',
    model: 'MiniMax-M2.1-highspeed',
    promptPricePerMtok: 4.2,
    completionPricePerMtok: 16.8,
    cacheReadPricePerMtok: 0.21,
    cacheCreationPricePerMtok: 2.625,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  },
  // --- M2 (legacy) ---
  {
    providerId: 'minimax',
    model: 'MiniMax-M2',
    promptPricePerMtok: 2.1,
    completionPricePerMtok: 8.4,
    cacheReadPricePerMtok: 0.21,
    cacheCreationPricePerMtok: 2.625,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'catalog'
  }
]

/**
 * Idempotently seed MiniMax catalog prices into `pricing_entries`. Safe to
 * call on every boot: `upsertCatalogBatch` skips any key already held by a
 * `source='user'` row, so user-configured prices always win.
 *
 * @param upsert  batch upsert function (defaults to the real repo impl)
 * @returns `{ updated, skipped }` from the upsert
 *
 * 幂等地将 MiniMax 目录价格写入 pricing_entries;每次启动调用均安全:用户已配置的 source='user' 行不会被覆盖。 (glm-5.2)
 */
export async function seedMinimaxPricing(
  upsert?: (entries: PricingEntry[]) => { updated: number; skipped: number }
): Promise<{ updated: number; skipped: number }> {
  const fn =
    upsert ??
    (async () => {
      const { upsertCatalogBatch } = await import('../store/pricing-repo')
      return upsertCatalogBatch(MINIMAX_PRICING as PricingEntry[])
    })
  return fn(MINIMAX_PRICING as PricingEntry[])
}
