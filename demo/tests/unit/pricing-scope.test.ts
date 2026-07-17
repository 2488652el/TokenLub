import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BILLING_SCOPE,
  normalizeBillingScope,
  resolveBillingScope
} from '../../../code/src/shared/pricing-scope'

describe('pricing billing scope', () => {
  it('normalizes user-entered scope identifiers', () => {
    expect(normalizeBillingScope(' Global ')).toBe('global')
    expect(normalizeBillingScope('')).toBe(DEFAULT_BILLING_SCOPE)
    expect(normalizeBillingScope(undefined)).toBe(DEFAULT_BILLING_SCOPE)
  })

  it('resolves official China and global endpoints', () => {
    expect(resolveBillingScope('moonshot', 'https://api.moonshot.ai/v1')).toBe('global')
    expect(resolveBillingScope('moonshot', 'https://api.moonshot.cn/v1')).toBe('cn')
    expect(resolveBillingScope('minimax', 'https://api.minimax.io/v1')).toBe('global')
    expect(resolveBillingScope('minimax', 'https://api.minimaxi.com/v1')).toBe('cn')
  })

  it('uses provider defaults only when no override is configured', () => {
    expect(resolveBillingScope('moonshot')).toBe('cn')
    expect(resolveBillingScope('minimax')).toBe('cn')
    expect(resolveBillingScope('openai')).toBe(DEFAULT_BILLING_SCOPE)
  })

  it('does not guess pricing scope for custom or malformed gateways', () => {
    expect(resolveBillingScope('moonshot', 'https://proxy.example.com/v1')).toBe(
      DEFAULT_BILLING_SCOPE
    )
    expect(resolveBillingScope('moonshot', 'https://evilmoonshot.ai/v1')).toBe(
      DEFAULT_BILLING_SCOPE
    )
    expect(resolveBillingScope('minimax', 'https://notminimax.io/v1')).toBe(DEFAULT_BILLING_SCOPE)
    expect(resolveBillingScope('minimax', 'not a URL')).toBe(DEFAULT_BILLING_SCOPE)
  })
})
