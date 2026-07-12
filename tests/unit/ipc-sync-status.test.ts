/**
 * sync:get-status IPC 单元测试:只读暴露本地同步状态,不让 renderer 触碰 DB。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { IPC } from '../../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const getLocalSyncStatusMock = vi.fn()

async function loadRegisterIpcHandlers(): Promise<() => void> {
  vi.resetModules()
  handlers.clear()
  getLocalSyncStatusMock.mockReset()

  vi.doMock('electron', () => ({
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown): void => {
        handlers.set(channel, handler)
      }
    },
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openPath: vi.fn(), openExternal: vi.fn() }
  }))
  vi.doMock('../../src/main/store/keys-repo', () => ({
    listKeys: vi.fn(),
    addKey: vi.fn(),
    updateKey: vi.fn(),
    deleteKey: vi.fn(),
    getDecryptedExtraCredentials: vi.fn(),
    getDecryptedKey: vi.fn(),
    toggleUsageQuery: vi.fn()
  }))
  vi.doMock('../../src/main/store/balance-repo', () => ({ latestBalances: vi.fn() }))
  vi.doMock('../../src/main/store/usage-repo', () => ({
    queryUsage: vi.fn(),
    queryUsagePage: vi.fn(),
    getDashboardSummary: vi.fn(),
    computeTotalSpend: vi.fn(),
    computeModelSpend: vi.fn(),
    computeSpendByKey: vi.fn()
  }))
  vi.doMock('../../src/main/store/pricing-repo', () => ({
    listPricing: vi.fn(),
    setPricing: vi.fn(),
    deletePricing: vi.fn(),
    upsertCatalogBatch: vi.fn()
  }))
  vi.doMock('../../src/main/store/alerts-repo', () => ({
    listAlerts: vi.fn(),
    addAlert: vi.fn(),
    toggleAlert: vi.fn(),
    deleteAlert: vi.fn()
  }))
  vi.doMock('../../src/main/store/settings-store', () => ({
    setSetting: vi.fn(),
    getAllSettings: vi.fn()
  }))
  vi.doMock('../../src/main/store/sync-repo', () => ({
    getLocalSyncStatus: getLocalSyncStatusMock
  }))
  vi.doMock('../../src/main/providers/registry', () => ({
    listProviders: vi.fn(),
    getProvider: vi.fn()
  }))
  vi.doMock('../../src/main/pricing/catalog', () => ({ syncCatalog: vi.fn() }))
  vi.doMock('../../src/main/scheduler/refresh', () => ({
    refreshAll: vi.fn(),
    restartAutoRefresh: vi.fn()
  }))
  vi.doMock('../../src/main/services/exchange-rate', () => ({
    withCnySpendConversion: vi.fn((input) => input)
  }))
  vi.doMock('../../src/main/log-parsers/sync', () => ({
    syncAllSessions: vi.fn(),
    discoverAllSessions: vi.fn()
  }))
  vi.doMock('../../src/main/log-parsers/cli-auth', () => ({
    detectClaudeKey: vi.fn(),
    detectCodexKey: vi.fn()
  }))

  const mod = await import('../../src/main/ipc/register-handlers')
  return mod.registerIpcHandlers
}

describe('sync:get-status IPC handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns local sync status from the main-process store layer', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    getLocalSyncStatusMock.mockReturnValue({
      mode: 'local-only',
      state: 'pending',
      pendingOutboxCount: 2,
      openConflictCount: 0,
      cursorPresent: false,
      lastSuccessAt: null,
      lastErrorCode: null,
      bootstrapRequired: false
    })

    registerIpcHandlers()
    const handler = handlers.get(IPC.syncGetStatus)
    expect(handler).toBeTypeOf('function')

    await expect(Promise.resolve(handler?.({}))).resolves.toEqual({
      mode: 'local-only',
      state: 'pending',
      pendingOutboxCount: 2,
      openConflictCount: 0,
      cursorPresent: false,
      lastSuccessAt: null,
      lastErrorCode: null,
      bootstrapRequired: false
    })
    expect(getLocalSyncStatusMock).toHaveBeenCalledTimes(1)
  })
})

describe('sync preload API surface', () => {
  it('exposes a whitelisted getStatus invoke without raw ipcRenderer access', () => {
    const source = readFileSync('src/preload/index.ts', 'utf8')

    expect(source).toContain('sync: {')
    expect(source).toContain('getStatus: (): Promise<LocalSyncStatus>')
    expect(source).toContain('ipcRenderer.invoke(IPC.syncGetStatus)')
  })
})
