import { shell } from 'electron'

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

export function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED_EXTERNAL_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export function openAllowedExternalUrl(url: string): boolean {
  if (!isAllowedExternalUrl(url)) return false
  void Promise.resolve(shell.openExternal(url)).catch(() => undefined)
  return true
}
