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
