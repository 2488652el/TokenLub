import type { PricingEntry } from '../types/pricing'

export type PricingViewFilter = {
  providerId: string | null
  currency: string | null
  billingScope: string | null
  source: PricingEntry['source'] | null
  query: string
}

export type PricingViewSummary = {
  total: number
  providerCount: number
  customCount: number
  inactiveCount: number
}

/**
 * 聚合网关 providerId:它们转售多家上游模型,价格并非模型官方价。
 * 官方直连(anthropic/deepseek/moonshot/zhipu 等)= 不在此集合中的 provider。
 */
const AGGREGATOR_PROVIDER_IDS: ReadonlySet<string> = new Set(['openrouter', 'siliconflow'])

/**
 * 按模型归并价格:同一模型被官方与聚合商同时收录时只保留官方那一行,
 * 保证「每个模型只显示一个价格,且是官方价」。官方目录没有、仅聚合商收录
 * 的模型仍保留(否则这些模型会彻底消失、无法估算费用)。用户自定义行
 * (source='user')不参与归并,原样保留,便于单独管理。
 *
 * 归并键为 (model, billingScope):scope 不同(如 cn/global)属不同价格渠道,不合并。
 */
export function dedupePricingToOfficial(entries: PricingEntry[]): PricingEntry[] {
  const pickOfficial = new Map<string, PricingEntry>()

  for (const entry of entries) {
    if (entry.source === 'user') continue // 自定义价不动
    const key = `${entry.model}${entry.billingScope ?? 'default'}`
    const existing = pickOfficial.get(key)
    if (!existing) {
      pickOfficial.set(key, entry)
      continue
    }
    const existingIsAggregator = AGGREGATOR_PROVIDER_IDS.has(existing.providerId)
    const entryIsAggregator = AGGREGATOR_PROVIDER_IDS.has(entry.providerId)
    // 官方优先:仅当现有的是聚合商、新来的是官方直连时才替换。
    if (existingIsAggregator && !entryIsAggregator) {
      pickOfficial.set(key, entry)
    }
  }

  return entries.filter((entry) => {
    if (entry.source === 'user') return true
    const key = `${entry.model}${entry.billingScope ?? 'default'}`
    return pickOfficial.get(key) === entry
  })
}

export function filterPricingEntries(
  entries: PricingEntry[],
  filter: PricingViewFilter
): PricingEntry[] {
  const query = filter.query.trim().toLocaleLowerCase()

  return entries.filter((entry) => {
    if (filter.providerId && entry.providerId !== filter.providerId) return false
    if (filter.currency && entry.currency !== filter.currency) return false
    if (filter.billingScope && (entry.billingScope ?? 'default') !== filter.billingScope) {
      return false
    }
    if (filter.source && entry.source !== filter.source) return false
    if (
      query &&
      !`${entry.providerId} ${entry.model} ${entry.billingScope ?? 'default'}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return false
    }
    return true
  })
}

export function summarizePricingEntries(entries: PricingEntry[]): PricingViewSummary {
  return {
    total: entries.length,
    providerCount: new Set(entries.map((entry) => entry.providerId)).size,
    customCount: entries.filter((entry) => entry.source === 'user').length,
    inactiveCount: entries.filter((entry) => entry.catalogActive === false).length
  }
}

export function paginatePricingEntries(
  entries: PricingEntry[],
  requestedPage: number,
  pageSize: number
): { entries: PricingEntry[]; page: number; totalPages: number } {
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const totalPages = Math.max(1, Math.ceil(entries.length / safePageSize))
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages)
  const start = (page - 1) * safePageSize

  return {
    entries: entries.slice(start, start + safePageSize),
    page,
    totalPages
  }
}
