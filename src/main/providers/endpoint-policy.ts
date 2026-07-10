import { getProvider } from './registry'
import { getCatalogEntry } from '@shared/provider-catalog'

type EndpointResult = { ok: true; origin: string } | { ok: false; reason: string }

function isManualProvider(providerId: string): boolean {
  return getProvider(providerId)?.manifest.category === 'manual'
}

function documentedOrigins(providerId: string): Set<string> {
  const entry = getCatalogEntry(providerId)
  const urls = [entry?.defaultBaseUrl ?? '', ...(entry?.baseUrlTemplates ?? []).map((t) => t.url)]
  return new Set(urls.flatMap((url) => {
    const origin = parseOrigin(url)
    return origin && url.startsWith('https://') ? [origin] : []
  }))
}

function parseOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || rawUrl.trim() === '') return ''
  try {
    return new URL(rawUrl).origin
  } catch {
    return null
  }
}

export function validateProviderEndpoint(
  providerId: string,
  rawUrl: string | null | undefined
): EndpointResult {
  if (!rawUrl || rawUrl.trim() === '') return { ok: true, origin: '' }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'endpoint must be a valid URL' }
  }

  if (providerId === 'newapi-generic' && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
    return { ok: true, origin: parsed.origin }
  }
  if (parsed.protocol === 'https:' && documentedOrigins(providerId).has(parsed.origin)) {
    return { ok: true, origin: parsed.origin }
  }
  return { ok: false, reason: parsed.protocol === 'https:' ? 'endpoint origin is not approved for this provider' : 'endpoint must use HTTP or HTTPS' }
}

export function originChanged(
  providerId: string,
  existingUrl: string | null | undefined,
  nextUrl: string | null | undefined
): boolean {
  if (isManualProvider(providerId) && (!nextUrl || nextUrl.trim() === '')) return false
  const existingOrigin = parseOrigin(existingUrl)
  const nextOrigin = parseOrigin(nextUrl)
  return existingOrigin !== nextOrigin
}
