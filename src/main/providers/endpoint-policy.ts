import { getProvider } from './registry'

type EndpointResult = { ok: true; origin: string } | { ok: false; reason: string }

function isManualProvider(providerId: string): boolean {
  return getProvider(providerId)?.manifest.category === 'manual'
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

  if (parsed.protocol === 'https:') return { ok: true, origin: parsed.origin }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
  if (providerId === 'newapi-generic' && parsed.protocol === 'http:' && loopback) {
    return { ok: true, origin: parsed.origin }
  }
  return { ok: false, reason: 'endpoint must use HTTPS' }
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
