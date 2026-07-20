export function normalizeCardOrder(
  currentIds: readonly string[],
  preferredIds: readonly string[]
): string[] {
  const current = Array.from(new Set(currentIds))
  const currentSet = new Set(current)
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const id of preferredIds) {
    if (!currentSet.has(id) || seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
  }

  for (const id of current) {
    if (seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
  }

  return normalized
}

export function moveCard(ids: readonly string[], activeId: string, targetId: string): string[] {
  const normalized = Array.from(new Set(ids))
  const from = normalized.indexOf(activeId)
  const to = normalized.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return normalized

  const next = [...normalized]
  const [active] = next.splice(from, 1)
  if (active === undefined) return normalized
  next.splice(to, 0, active)
  return next
}

export function mergeVisibleCardOrder(
  currentIds: readonly string[],
  visibleIds: readonly string[]
): string[] {
  const current = Array.from(new Set(currentIds))
  const currentSet = new Set(current)
  const visible = Array.from(new Set(visibleIds)).filter((id) => currentSet.has(id))
  const visibleSet = new Set(visible)
  let visibleIndex = 0

  return current.map((id) => {
    if (!visibleSet.has(id)) return id
    const replacement = visible[visibleIndex]
    visibleIndex += 1
    return replacement ?? id
  })
}
