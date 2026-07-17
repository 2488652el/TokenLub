/**
 * refreshAll 用量刷新单元测试:覆盖 usage provider 的额外凭证透传与定价入库,
 * 校验 extra credentials 传入 build 且按定价计算成本写入 usage 记录。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderImpl } from '../../../../code/src/shared/types/provider'

const state = vi.hoisted(() => ({
  keys: [
    {
      id: 'key-1',
      providerId: 'mock-usage',
      alias: 'Mock Usage',
      keyTail: 'ular',
      source: 'api-key' as const,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z'
    }
  ],
  apiKeys: { 'key-1': 'sk-regular' } as Record<string, string>,
  extras: { 'key-1': { adminKey: 'sk-admin-secret' } } as Record<string, Record<string, string>>,
  provider: undefined as ProviderImpl | undefined,
  insertUsageResult: { inserted: 1, skipped: 0 }
}))

vi.mock('../../../../code/src/main/store/keys-repo', () => ({
  listKeys: vi.fn(() => state.keys),
  getDecryptedKey: vi.fn((id: string) => state.apiKeys[id]),
  getDecryptedExtraCredentials: vi.fn((id: string) => state.extras[id] ?? {})
}))

vi.mock('../../../../code/src/main/providers/registry', () => ({
  getProvider: vi.fn(() => state.provider)
}))

const insertUsage = vi.fn(() => state.insertUsageResult)

vi.mock('../../../../code/src/main/store/usage-repo', () => ({
  insertUsage
}))

vi.mock('../../../../code/src/main/store/pricing-repo', () => ({
  findPricing: vi.fn(() => ({
    id: 1,
    providerId: 'mock-usage',
    model: 'mock-model',
    promptPricePerMtok: 1,
    completionPricePerMtok: 2,
    cacheReadPricePerMtok: 0.5,
    cacheCreationPricePerMtok: 3,
    currency: 'USD',
    source: 'user',
    updatedAt: '2026-07-07T00:00:00.000Z'
  }))
}))

vi.mock('../../../../code/src/main/store/balance-repo', () => ({
  insertBalance: vi.fn(),
  latestBalances: vi.fn(() => [])
}))

vi.mock('../../../../code/src/main/store/settings-store', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn()
}))

vi.mock('../../../../code/src/main/store/alerts-repo', () => ({
  listAlerts: vi.fn(() => []),
  markAlertTriggered: vi.fn(),
  insertAlertEvent: vi.fn()
}))

vi.mock('../../../../code/src/main/store/db', () => ({
  getDb: vi.fn()
}))

// refreshAll 用量刷新:透传额外凭证并插入已定价的 usage 记录
describe('scheduler refreshAll usage refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes extra credentials to usage providers and inserts priced usage records', async () => {
    const build = vi.fn(() => ({
      usage: vi.fn(async () => [
        {
          providerId: 'mock-usage',
          periodStart: '2026-07-01T00:00:00.000Z',
          periodEnd: '2026-07-02T00:00:00.000Z',
          model: 'mock-model',
          promptTokens: 1_000,
          completionTokens: 2_000,
          cacheReadTokens: 500,
          cacheCreationTokens: 250,
          source: 'vendor-api' as const
        }
      ]),
      testConnection: vi.fn()
    }))
    state.provider = {
      manifest: {
        id: 'mock-usage',
        displayName: 'Mock Usage',
        category: 'admin-org',
        features: ['usage', 'cost']
      },
      hasBalanceApi: false,
      hasUsageApi: true,
      build
    }

    const { refreshAll } = await import('../../../../code/src/main/scheduler/refresh')
    const result = await refreshAll()

    expect(build).toHaveBeenCalledWith({
      baseUrl: '',
      apiKey: 'sk-regular',
      extra: { adminKey: 'sk-admin-secret' }
    })
    expect(insertUsage).toHaveBeenCalledWith([
      expect.objectContaining({
        apiKeyId: 'key-1',
        providerId: 'mock-usage',
        model: 'mock-model',
        cost: 0.006,
        currency: 'USD'
      })
    ])
    expect(result).toMatchObject({ ok: true, refreshed: 1, usageInserted: 1, failed: 0 })
  })

  it('shares one in-flight refresh between concurrent callers', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const usage = vi.fn(async () => {
      await pending
      return []
    })
    const build = vi.fn(() => ({ usage, testConnection: vi.fn() }))
    state.provider = {
      manifest: {
        id: 'mock-usage',
        displayName: 'Mock Usage',
        category: 'admin-org',
        features: ['usage']
      },
      hasBalanceApi: false,
      hasUsageApi: true,
      build
    }
    const { refreshAll } = await import('../../../../code/src/main/scheduler/refresh')
    const first = refreshAll()
    const second = refreshAll()
    expect(second).toBe(first)
    release()
    await first
    expect(usage).toHaveBeenCalledTimes(1)
  })
})
