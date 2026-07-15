/**
 * ipc-schemas 单元测试:覆盖 api key / usage filter / pricing / alert / settings
 * 等各 IPC 输入 schema 的校验规则,确保非法输入被 zod 拦截。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import {
  apiKeyCreateInputSchema,
  apiKeyUpdateInputSchema,
  usageFilterSchema,
  pricingSetInputSchema,
  pricingCatalogApplyInputSchema,
  alertAddInputSchema,
  alertToggleInputSchema,
  settingsSetInputSchema
} from '../../src/shared/ipc-schemas'

// ipc-schemas:校验各 IPC 输入 schema 的合法/非法判定
describe('ipc-schemas', () => {
  it('accepts a valid api key create input', () => {
    const r = apiKeyCreateInputSchema.safeParse({
      providerId: 'deepseek',
      alias: 'Production',
      apiKey: 'sk-abc1234567'
    })
    expect(r.success).toBe(true)
  })

  it('accepts provider-specific encrypted credential extras', () => {
    const r = apiKeyCreateInputSchema.safeParse({
      providerId: 'openai-admin',
      alias: 'Production',
      apiKey: 'sk-abc1234567',
      extra: { adminKey: 'sk-admin-abc123' }
    })
    expect(r.success).toBe(true)
  })

  it('accepts api key update with nullable cleared fields', () => {
    const r = apiKeyUpdateInputSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      alias: 'DeepSeek Prod',
      baseUrlOverride: null,
      notes: null
    })
    expect(r.success).toBe(true)
  })

  it('rejects api key update with empty replacement key', () => {
    const r = apiKeyUpdateInputSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      alias: 'DeepSeek Prod',
      apiKey: ''
    })
    expect(r.success).toBe(false)
  })

  it('accepts provider extra credentials such as adminKey', () => {
    const r = apiKeyCreateInputSchema.safeParse({
      providerId: 'openai-admin',
      alias: 'Org Admin',
      apiKey: 'sk-regular',
      extra: { adminKey: 'sk-admin' }
    })
    expect(r.success).toBe(true)
  })

  it('rejects short alias', () => {
    const r = apiKeyCreateInputSchema.safeParse({
      providerId: 'deepseek',
      alias: '',
      apiKey: 'sk-abc'
    })
    expect(r.success).toBe(false)
  })

  it('validates usage filter source enum', () => {
    const r = usageFilterSchema.safeParse({ source: 'nope' as never })
    expect(r.success).toBe(false)
  })

  it('rejects negative prices', () => {
    const r = pricingSetInputSchema.safeParse({
      providerId: 'openai-admin',
      model: 'gpt-4o',
      promptPricePerMtok: -1,
      completionPricePerMtok: 5,
      currency: 'USD',
      source: 'user'
    })
    expect(r.success).toBe(false)
  })

  it('requires a UUID when applying a pricing catalog preview', () => {
    expect(pricingCatalogApplyInputSchema.safeParse({ previewId: 'not-a-uuid' }).success).toBe(
      false
    )
    expect(
      pricingCatalogApplyInputSchema.safeParse({
        previewId: '550e8400-e29b-41d4-a716-446655440000'
      }).success
    ).toBe(true)
  })

  it('accepts valid alert rule', () => {
    const r = alertAddInputSchema.safeParse({
      scope: 'global',
      threshold: 10,
      metric: 'remaining_pct'
    })
    expect(r.success).toBe(true)
  })

  // N8: IPC handlers now call schema.parse(input) before forwarding to the
  // store layer. These cases verify the schemas reject the malformed inputs
  // that would previously have reached addKey/setPricing/addAlert directly.

  it('rejects api key with empty apiKey', () => {
    const r = apiKeyCreateInputSchema.safeParse({
      providerId: 'deepseek',
      alias: 'prod',
      apiKey: ''
    })
    expect(r.success).toBe(false)
  })

  it('rejects api key with non-url baseUrlOverride', () => {
    const r = apiKeyCreateInputSchema.safeParse({
      providerId: 'deepseek',
      alias: 'prod',
      apiKey: 'sk-x',
      baseUrlOverride: 'not-a-url'
    })
    expect(r.success).toBe(false)
  })

  it('rejects settings set with empty key', () => {
    const r = settingsSetInputSchema.safeParse({ key: '', value: 1 })
    expect(r.success).toBe(false)
  })

  it('rejects alert toggle with non-uuid id', () => {
    const r = alertToggleInputSchema.safeParse({ id: 'not-a-uuid', enabled: true })
    expect(r.success).toBe(false)
  })

  it('rejects usage filter with negative limit', () => {
    const r = usageFilterSchema.safeParse({ limit: -5 })
    expect(r.success).toBe(false)
  })

  it('accepts usage filter with non-negative offset for pagination', () => {
    const r = usageFilterSchema.safeParse({ limit: 50, offset: 100 })
    expect(r.success).toBe(true)
  })

  it('rejects usage filter with negative offset', () => {
    const r = usageFilterSchema.safeParse({ offset: -1 })
    expect(r.success).toBe(false)
  })

  it('accepts usage filter with modelContains substring', () => {
    const r = usageFilterSchema.safeParse({ modelContains: 'gpt-4o' })
    expect(r.success).toBe(true)
  })

  it('rejects pricing with missing currency', () => {
    const r = pricingSetInputSchema.safeParse({
      providerId: 'openai-admin',
      model: 'gpt-4o',
      promptPricePerMtok: 5,
      completionPricePerMtok: 15,
      source: 'user'
    })
    expect(r.success).toBe(false)
  })
})
