/**
 * refreshAll usageQueryEnabled 跳过逻辑单元测试:覆盖禁用/启用/遗留 key 的处理,
 * 校验 usageQueryEnabled=false 的 key 被完全跳过、undefined 视为启用。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderImpl } from '../../../src/shared/types/provider'

const state = vi.hoisted(() => ({
  keys: [] as Array<{
    id: string
    providerId: string
    alias: string
    keyTail: string
    source: 'api-key'
    createdAt: string
    updatedAt: string
    usageQueryEnabled?: boolean
  }>,
  apiKeys: {} as Record<string, string>,
  extras: {} as Record<string, Record<string, string>>,
  provider: undefined as ProviderImpl | undefined,
  insertUsageResult: { inserted: 1, skipped: 0 },
  insertBalanceResult: { id: 1 }
}))

vi.mock('../../../src/main/store/keys-repo', () => ({
  listKeys: vi.fn(() => state.keys),
  getDecryptedKey: vi.fn((id: string) => state.apiKeys[id]),
  getDecryptedExtraCredentials: vi.fn((id: string) => state.extras[id] ?? {})
}))

vi.mock('../../../src/main/providers/registry', () => ({
  getProvider: vi.fn(() => state.provider)
}))

const insertUsage = vi.fn(() => state.insertUsageResult)
const insertBalance = vi.fn(() => state.insertBalanceResult)

vi.mock('../../../src/main/store/usage-repo', () => ({
  insertUsage
}))

vi.mock('../../../src/main/store/balance-repo', () => ({
  insertBalance,
  latestBalances: vi.fn(() => [])
}))

vi.mock('../../../src/main/store/pricing-repo', () => ({
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

vi.mock('../../../src/main/store/settings-store', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn()
}))

vi.mock('../../../src/main/store/alerts-repo', () => ({
  listAlerts: vi.fn(() => []),
  markAlertTriggered: vi.fn(),
  insertAlertEvent: vi.fn()
}))

vi.mock('../../../src/main/store/db', () => ({
  getDb: vi.fn()
}))

function makeBalanceProvider(id: string): ProviderImpl {
  const build = vi.fn(() => ({
    balance: vi.fn(async () => ({
      providerId: id,
      capturedAt: '2026-07-08T00:00:00.000Z',
      remaining: 50,
      total: 100,
      currency: 'USD'
    })),
    testConnection: vi.fn()
  }))
  return {
    manifest: {
      id,
      displayName: `Mock ${id}`,
      category: 'admin-org',
      features: ['balance']
    },
    hasBalanceApi: true,
    hasUsageApi: false,
    build
  }
}

function makeUsageProvider(id: string): ProviderImpl {
  const build = vi.fn(() => ({
    usage: vi.fn(async () => [
      {
        providerId: id,
        periodStart: '2026-07-01T00:00:00.000Z',
        periodEnd: '2026-07-02T00:00:00.000Z',
        model: 'mock-model',
        promptTokens: 1_000,
        completionTokens: 2_000,
        source: 'vendor-api' as const
      }
    ]),
    testConnection: vi.fn()
  }))
  return {
    manifest: {
      id,
      displayName: `Mock ${id}`,
      category: 'admin-org',
      features: ['usage', 'cost']
    },
    hasBalanceApi: false,
    hasUsageApi: true,
    build
  }
}

// refreshAll usageQueryEnabled 跳过 (PR-2):跳过禁用 key、处理启用与遗留 key
describe('scheduler refreshAll usageQueryEnabled skip (PR-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.keys.length = 0
    for (const k of Object.keys(state.apiKeys)) delete state.apiKeys[k]
    for (const k of Object.keys(state.extras)) delete state.extras[k]
  })

  it('skips keys with usageQueryEnabled=false and processes enabled ones', async () => {
    // Key A: usage query disabled — must be skipped entirely (no provider build,
    // no insertBalance, no insertUsage, and does not count toward refreshed).
    state.keys.push({
      id: 'key-disabled',
      providerId: 'mock-balance',
      alias: 'Disabled',
      keyTail: 'sed',
      source: 'api-key',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
      usageQueryEnabled: false
    })
    // Key B: usage query enabled — must be processed and counted.
    state.keys.push({
      id: 'key-enabled',
      providerId: 'mock-usage',
      alias: 'Enabled',
      keyTail: 'led',
      source: 'api-key',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
      usageQueryEnabled: true
    })
    state.apiKeys['key-disabled'] = 'sk-disabled'
    state.apiKeys['key-enabled'] = 'sk-enabled'

    // Build two distinct providers — getProvider returns one at a time, so we
    // wire its return value to match whichever providerId is requested.
    const balanceProvider = makeBalanceProvider('mock-balance')
    const usageProvider = makeUsageProvider('mock-usage')
    const { getProvider } = await import('../../../src/main/providers/registry')
    vi.mocked(getProvider).mockImplementation((pid: string) =>
      pid === 'mock-balance' ? balanceProvider : pid === 'mock-usage' ? usageProvider : undefined
    )

    const { refreshAll } = await import('../../../src/main/scheduler/refresh')
    const result = await refreshAll()

    // Disabled key: provider.build, insertBalance and insertUsage must NOT be hit
    // for this key. The provider instance has its own build spy, so we inspect it.
    expect(balanceProvider.build).not.toHaveBeenCalled()
    expect(insertBalance).not.toHaveBeenCalled()
    // Enabled key: usage path ran and counts toward refreshed.
    expect(usageProvider.build).toHaveBeenCalledWith({
      baseUrl: '',
      apiKey: 'sk-enabled',
      extra: {}
    })
    expect(insertUsage).toHaveBeenCalledTimes(1)
    expect(insertUsage).toHaveBeenCalledWith([
      expect.objectContaining({ apiKeyId: 'key-enabled', providerId: 'mock-usage' })
    ])
    expect(result).toMatchObject({ ok: true, refreshed: 1, usageInserted: 1, failed: 0 })
  })

  it('treats usageQueryEnabled=undefined as enabled (backward-compatible fixture)', async () => {
    state.keys.push({
      id: 'key-legacy',
      providerId: 'mock-usage',
      alias: 'Legacy',
      keyTail: 'acy',
      source: 'api-key',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z'
      // usageQueryEnabled intentionally omitted
    })
    state.apiKeys['key-legacy'] = 'sk-legacy'

    const usageProvider = makeUsageProvider('mock-usage')
    // Reset Case 1's mockImplementation so the factory's `() => state.provider`
    // is in effect again — otherwise Case 1's closure-bound providers would win.
    const { getProvider } = await import('../../../src/main/providers/registry')
    vi.mocked(getProvider).mockReset()
    vi.mocked(getProvider).mockImplementation(() => usageProvider)

    const { refreshAll } = await import('../../../src/main/scheduler/refresh')
    const result = await refreshAll()

    expect(usageProvider.build).toHaveBeenCalledTimes(1)
    expect(insertUsage).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, refreshed: 1, usageInserted: 1, failed: 0 })
  })
})
