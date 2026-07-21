import { useCallback, useEffect, useMemo, useState } from 'react'
import { mergeVisibleCardOrder, normalizeCardOrder } from '../../shared/utils/card-order'

export function readStoredCardOrder(storageKey: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    let raw = window.localStorage.getItem(storageKey)
    if (raw === null && storageKey.startsWith('moonmeter.')) {
      raw = window.localStorage.getItem(storageKey.replace(/^moonmeter\./, 'tokenlub.'))
      if (raw !== null) window.localStorage.setItem(storageKey, raw)
    }
    const value: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeStoredOrder(storageKey: string, ids: readonly string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ids))
  } catch {
    // Card ordering is a convenience preference; storage failures must not block the page.
  }
}

function equalOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function useCardOrder<T>(
  storageKey: string,
  items: readonly T[],
  getId: (item: T) => string
): {
  orderedItems: T[]
  reorderVisible: (visibleIds: readonly string[]) => void
} {
  const currentIds = useMemo(() => items.map(getId), [getId, items])
  const [order, setOrder] = useState<string[]>(() => readStoredCardOrder(storageKey))

  useEffect(() => {
    setOrder((previous) => {
      if (currentIds.length === 0) return previous
      const next = normalizeCardOrder(currentIds, previous)
      if (equalOrder(previous, next)) return previous
      writeStoredOrder(storageKey, next)
      return next
    })
  }, [currentIds, storageKey])

  const orderedItems = useMemo(() => {
    const byId = new Map(items.map((item) => [getId(item), item]))
    return normalizeCardOrder(currentIds, order)
      .map((id) => byId.get(id))
      .filter((item): item is T => item !== undefined)
  }, [currentIds, getId, items, order])

  const reorderVisible = useCallback(
    (visibleIds: readonly string[]) => {
      setOrder((previous) => {
        const normalized = normalizeCardOrder(currentIds, previous)
        const next = mergeVisibleCardOrder(normalized, visibleIds)
        if (equalOrder(normalized, next)) return previous
        writeStoredOrder(storageKey, next)
        return next
      })
    },
    [currentIds, storageKey]
  )

  return { orderedItems, reorderVisible }
}
