import { normalizeBillingScope } from './pricing-scope'
import type { PricingDiffEntry, PricingEntry } from './types/pricing'

export const DEFAULT_MAX_PRICE_CHANGE_RATIO = 2

export function pricingNaturalKey(
  entry: Pick<PricingEntry, 'providerId' | 'model' | 'currency'> & {
    billingScope?: string
  }
): string {
  return `${entry.providerId}:${normalizeBillingScope(entry.billingScope)}:${entry.model}:${entry.currency}`
}

function priceVector(entry: PricingEntry): number[] {
  return [
    entry.promptPricePerMtok,
    entry.completionPricePerMtok,
    entry.cacheReadPricePerMtok ?? 0,
    entry.cacheCreationPricePerMtok ?? 0
  ]
}

function samePrice(left: PricingEntry, right: PricingEntry): boolean {
  return JSON.stringify(priceVector(left)) === JSON.stringify(priceVector(right))
}

function calculateChangeRatio(before: PricingEntry, after: PricingEntry): number {
  return Math.max(
    ...priceVector(before).map((oldValue, index) => {
      const newValue = priceVector(after)[index] ?? 0
      if (oldValue === newValue) return 0
      if (oldValue === 0) return Number.POSITIVE_INFINITY
      return Math.abs(newValue - oldValue) / Math.abs(oldValue)
    })
  )
}

export function buildPricingCatalogDiff(
  current: PricingEntry[],
  incoming: PricingEntry[],
  maxAllowedChangeRatio = DEFAULT_MAX_PRICE_CHANGE_RATIO
): PricingDiffEntry[] {
  const currentMap = new Map(
    current
      .filter((entry) => entry.source === 'catalog' && entry.catalogActive !== false)
      .map((entry) => [pricingNaturalKey(entry), entry])
  )
  const incomingMap = new Map(incoming.map((entry) => [pricingNaturalKey(entry), entry]))
  const changes: PricingDiffEntry[] = []

  for (const [key, after] of incomingMap) {
    const before = currentMap.get(key)
    if (!before) {
      changes.push({ key, kind: 'added', after, blocked: false })
      continue
    }
    currentMap.delete(key)
    if (!samePrice(before, after)) {
      const changeRatio = calculateChangeRatio(before, after)
      changes.push({
        key,
        kind: 'changed',
        before,
        after,
        changeRatio,
        blocked: changeRatio > maxAllowedChangeRatio
      })
    }
  }

  for (const [key, before] of currentMap) {
    changes.push({ key, kind: 'removed', before, blocked: false })
  }

  return changes.sort((left, right) => left.key.localeCompare(right.key))
}

export function summarizePricingDiff(changes: PricingDiffEntry[]): {
  added: number
  changed: number
  removed: number
  blocked: number
} {
  return changes.reduce(
    (summary, change) => {
      summary[change.kind]++
      if (change.blocked) summary.blocked++
      return summary
    },
    { added: 0, changed: 0, removed: 0, blocked: 0 }
  )
}
