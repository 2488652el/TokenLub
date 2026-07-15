import { describe, expect, it, vi, beforeEach } from 'vitest'

const openExternalMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  shell: {
    openExternal: openExternalMock
  }
}))

import {
  isAllowedExternalUrl,
  openAllowedExternalUrl
} from '../../src/main/platform/external-links'

describe('external link allowlist', () => {
  beforeEach(() => {
    openExternalMock.mockReset()
    openExternalMock.mockResolvedValue(undefined)
  })

  it('allows http, https, and mailto', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com')).toBe(true)
    expect(isAllowedExternalUrl('mailto:test@example.com')).toBe(true)
  })

  it('rejects javascript, file, data, and invalid URLs', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('data:text/plain,hi')).toBe(false)
    expect(isAllowedExternalUrl('not a url')).toBe(false)
  })

  it('opens only allowed URLs', () => {
    expect(openAllowedExternalUrl('https://example.com')).toBe(true)
    expect(openExternalMock).toHaveBeenCalledOnce()

    expect(openAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(openExternalMock).toHaveBeenCalledOnce()
  })
})
