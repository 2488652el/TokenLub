/**
 * IPC 输入校验单元测试:覆盖日志路径、Session 来源与价格汇率币种校验,
 * 确保非法输入在调用底层服务前被拒绝。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../../code/src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const syncAllSessionsMock = vi.fn()
const statSyncMock = vi.fn()
const openPathMock = vi.fn()
const getCnyRateQuoteMock = vi.fn()

async function loadRegisterIpcHandlers(): Promise<() => void> {
  vi.resetModules()
  handlers.clear()
  syncAllSessionsMock.mockReset()
  statSyncMock.mockReset()
  openPathMock.mockReset()
  getCnyRateQuoteMock.mockReset()

  vi.doMock('electron', () => ({
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown): void => {
        handlers.set(channel, handler)
      }
    },
    BrowserWindow: {
      getAllWindows: () => [{ webContents: { send: vi.fn() } }]
    },
    shell: { openPath: openPathMock, openExternal: vi.fn() }
  }))
  vi.doMock('node:fs', () => ({ statSync: statSyncMock }))
  vi.doMock('../../../code/src/main/store/keys-repo', () => ({
    listKeys: vi.fn(() => []),
    addKey: vi.fn(),
    updateKey: vi.fn(),
    deleteKey: vi.fn(),
    getDecryptedExtraCredentials: vi.fn(),
    getDecryptedKey: vi.fn(),
    toggleUsageQuery: vi.fn()
  }))
  vi.doMock('../../../code/src/main/store/balance-repo', () => ({ latestBalances: vi.fn() }))
  vi.doMock('../../../code/src/main/store/usage-repo', () => ({
    queryUsage: vi.fn(),
    queryUsagePage: vi.fn(),
    getDashboardSummary: vi.fn(),
    computeTotalSpend: vi.fn(),
    computeModelSpend: vi.fn(),
    computeSpendByKey: vi.fn()
  }))
  vi.doMock('../../../code/src/main/store/pricing-repo', () => ({
    listPricing: vi.fn(),
    setPricing: vi.fn(),
    deletePricing: vi.fn(),
    upsertCatalogBatch: vi.fn()
  }))
  vi.doMock('../../../code/src/main/store/alerts-repo', () => ({
    listAlerts: vi.fn(),
    addAlert: vi.fn(),
    toggleAlert: vi.fn(),
    deleteAlert: vi.fn()
  }))
  vi.doMock('../../../code/src/main/store/settings-store', () => ({
    setSetting: vi.fn(),
    getAllSettings: vi.fn()
  }))
  vi.doMock('../../../code/src/main/providers/registry', () => ({
    listProviders: vi.fn(),
    getProvider: vi.fn()
  }))
  vi.doMock('../../../code/src/main/pricing/catalog', () => ({ syncCatalog: vi.fn() }))
  vi.doMock('../../../code/src/main/scheduler/refresh', () => ({
    refreshAll: vi.fn(),
    restartAutoRefresh: vi.fn()
  }))
  vi.doMock('../../../code/src/main/services/exchange-rate', () => ({
    getCnyRateQuote: getCnyRateQuoteMock,
    withCnySpendConversion: vi.fn((value: unknown) => value)
  }))
  vi.doMock('../../../code/src/main/log-parsers/sync', () => ({
    syncAllSessions: syncAllSessionsMock,
    discoverAllSessions: vi.fn()
  }))
  vi.doMock('../../../code/src/main/log-parsers/cli-auth', () => ({
    detectClaudeKey: vi.fn(),
    detectCodexKey: vi.fn()
  }))

  const mod = await import('../../../code/src/main/ipc/register-handlers')
  return mod.registerIpcHandlers
}

// log IPC 输入校验:拦截非法 source 与非字符串路径
describe('log IPC input validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects log:sync with an unknown source before syncing', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    registerIpcHandlers()

    const handler = handlers.get(IPC.logSync)
    expect(handler).toBeTypeOf('function')

    await expect(async () => handler?.({}, { source: 'bad-source' })).rejects.toBeInstanceOf(Error)
    expect(syncAllSessionsMock).not.toHaveBeenCalled()
  })

  it('rejects log:open-folder with a non-string path before stat/openPath', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    registerIpcHandlers()

    const handler = handlers.get(IPC.logOpenFolder)
    expect(handler).toBeTypeOf('function')

    await expect(async () => handler?.({}, { path: 123 })).rejects.toBeInstanceOf(Error)
    expect(statSyncMock).not.toHaveBeenCalled()
  })

  it('returns only display paths without input', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    registerIpcHandlers()

    const handler = handlers.get(IPC.logLocations)
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({})
    expect(result).toEqual(
      expect.objectContaining({
        claudeProjects: expect.any(String),
        codexSessions: expect.any(String),
        kimiCodeSessions: expect.any(String)
      })
    )
    expect(result).not.toHaveProperty('codexAuthFile')
  })

  it('opens a directory whose path contains spaces and Unicode', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    statSyncMock.mockReturnValue({ isDirectory: () => true })
    registerIpcHandlers()
    const path = 'C:\\Users\\测试 用户\\.claude\\projects'

    expect(await handlers.get(IPC.logOpenFolder)?.({}, { path })).toEqual({ ok: true, path })
    expect(openPathMock).toHaveBeenCalledWith(path)
  })

  it('forwards a valid three-letter pricing currency to the exchange-rate service', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    const quote = { currency: 'EUR', rateToCny: 8.1, source: 'fallback' }
    getCnyRateQuoteMock.mockResolvedValue(quote)
    registerIpcHandlers()

    await expect(handlers.get(IPC.pricingCnyRate)?.({}, 'EUR')).resolves.toEqual(quote)
    expect(getCnyRateQuoteMock).toHaveBeenCalledWith('EUR')
  })

  it('rejects an invalid pricing currency before requesting a quote', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    registerIpcHandlers()

    await expect(async () => handlers.get(IPC.pricingCnyRate)?.({}, 'US')).rejects.toThrow(
      'pricing currency must be a three-letter code'
    )
    expect(getCnyRateQuoteMock).not.toHaveBeenCalled()
  })
})
