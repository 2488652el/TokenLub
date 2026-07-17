/**
 * create-key-payload 单元测试:覆盖 buildCreateKeyPayload 构造创建密钥载荷的逻辑,
 * 验证各 provider 的字段处理(别名、密钥、baseUrlOverride、adminKey、平台 cookie 等)。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { buildCreateKeyPayload } from '../../../code/src/shared/create-key-payload'
import { PROVIDER_CATALOG } from '../../../code/src/shared/provider-catalog'

// 构造创建密钥载荷
describe('buildCreateKeyPayload', () => {
  it('builds a valid payload for an OpenAI-compatible provider', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'deepseek',
        alias: 'Production Key',
        apiKey: 'sk-abc',
        adminKey: '',
        platformCookie: '',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.providerId).toBe('deepseek')
    expect(r.input.alias).toBe('Production Key')
    expect(r.input.apiKey).toBe('sk-abc')
    expect(r.input.baseUrlOverride).toBeUndefined()
    expect(r.input.extra).toBeUndefined()
    expect(r.notes.adminKeyStored).toBe(false)
  })

  it('includes baseUrlOverride when set', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'deepseek',
        alias: 'a',
        apiKey: 'sk-x',
        adminKey: '',
        platformCookie: '',
        baseUrl: 'https://mirror.example.com/v1',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.baseUrlOverride).toBe('https://mirror.example.com/v1')
  })

  it('omits notes when empty after trim', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'moonshot',
        alias: 'a',
        apiKey: 'sk',
        adminKey: '',
        platformCookie: '',
        baseUrl: '',
        notes: '   '
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.notes).toBeUndefined()
  })

  it('includes adminKey in extra for anthropic-admin and openai-admin providers', () => {
    for (const pid of ['anthropic-admin', 'openai-admin']) {
      const r = buildCreateKeyPayload(
        {
          providerId: pid,
          alias: 'org-key',
          apiKey: 'sk-user',
          adminKey: 'sk-admin',
          platformCookie: '',
          baseUrl: '',
          notes: ''
        },
        PROVIDER_CATALOG
      )
      expect(r.ok, pid).toBe(true)
      if (!r.ok) return
      expect(r.input.extra?.adminKey).toBe('sk-admin')
      expect(r.notes.adminKeyStored).toBe(true)
    }
  })

  it('omits adminKey for non-admin providers even if filled in', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'deepseek',
        alias: 'a',
        apiKey: 'sk-x',
        adminKey: 'should-be-ignored',
        platformCookie: '',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.extra).toBeUndefined()
    expect(r.notes.adminKeyStored).toBe(false)
  })

  it('requires a baseUrl for newapi-generic (self-hosted)', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'newapi-generic',
        alias: 'self',
        apiKey: 'sk',
        adminKey: '',
        platformCookie: '',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/baseUrl/i)
  })

  it('rejects empty alias', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'deepseek',
        alias: '   ',
        apiKey: 'sk',
        adminKey: '',
        platformCookie: '',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(false)
  })

  it('rejects empty apiKey', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'deepseek',
        alias: 'a',
        apiKey: '',
        adminKey: '',
        platformCookie: '',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(false)
  })

  it('rejects unknown providerId', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'mystery',
        alias: 'a',
        apiKey: 'sk',
        adminKey: '',
        platformCookie: '',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/mystery/)
  })

  it('trims whitespace from alias, apiKey, and notes', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'longcat',
        alias: '  Spaced Alias  ',
        apiKey: '\tsk-abc\n',
        adminKey: '',
        platformCookie: '',
        baseUrl: '',
        notes: '  some note  '
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.alias).toBe('Spaced Alias')
    expect(r.input.apiKey).toBe('sk-abc')
    expect(r.input.notes).toBe('some note')
  })

  it('includes LongCat platform cookie in encrypted extra credentials', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'longcat',
        alias: 'LongCat',
        apiKey: 'sk-longcat',
        adminKey: '',
        platformCookie: '  passport_token_key=secret; long_cat_region_key=0  ',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.extra?.longcatPlatformCookie).toBe(
      'passport_token_key=secret; long_cat_region_key=0'
    )
  })

  it('omits platform cookie for non-LongCat providers', () => {
    const r = buildCreateKeyPayload(
      {
        providerId: 'deepseek',
        alias: 'DeepSeek',
        apiKey: 'sk-deepseek',
        adminKey: '',
        platformCookie: 'passport_token_key=secret',
        baseUrl: '',
        notes: ''
      },
      PROVIDER_CATALOG
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.extra).toBeUndefined()
  })
})
