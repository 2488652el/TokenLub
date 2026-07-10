import { describe, expect, it } from 'vitest'
import { originChanged, validateProviderEndpoint } from '../../src/main/providers/endpoint-policy'

describe('provider endpoint policy', () => {
  it('requires HTTPS for hosted provider endpoints', () => {
    expect(validateProviderEndpoint('deepseek', 'https://api.deepseek.com').ok).toBe(true)
    expect(validateProviderEndpoint('deepseek', 'http://api.deepseek.com').ok).toBe(false)
    expect(validateProviderEndpoint('deepseek', 'http://127.0.0.1:3000').ok).toBe(false)
  })

  it('allows loopback HTTP only for self-hosted NewAPI', () => {
    expect(validateProviderEndpoint('newapi-generic', 'http://127.0.0.1:3000').ok).toBe(true)
    expect(validateProviderEndpoint('newapi-generic', 'file:///C:/x').ok).toBe(false)
  })

  it('compares normalized origins', () => {
    expect(originChanged('deepseek', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/v2')).toBe(false)
    expect(originChanged('deepseek', 'https://api.deepseek.com', 'https://other.example')).toBe(true)
  })
})
