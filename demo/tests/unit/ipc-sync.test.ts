import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../../code/src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const syncStatusMock = vi.fn()
const syncNowMock = vi.fn()
const loginSyncMock = vi.fn()
const listSyncDevicesMock = vi.fn()
const revokeSyncDeviceMock = vi.fn()
const showOpenDialogMock = vi.fn()

async function loadHandlers(): Promise<() => void> {
  vi.resetModules()
  handlers.clear()
  syncStatusMock.mockReset()
  syncNowMock.mockReset()
  loginSyncMock.mockReset()
  listSyncDevicesMock.mockReset()
  revokeSyncDeviceMock.mockReset()
  showOpenDialogMock.mockReset()
  vi.doMock('electron', () => ({
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }
    },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showOpenDialog: showOpenDialogMock },
    shell: { openPath: vi.fn(), openExternal: vi.fn() }
  }))
  vi.doMock('../../../code/src/main/sync/service', () => ({
    getSyncStatus: syncStatusMock,
    syncNow: syncNowMock,
    loginSync: loginSyncMock,
    listSyncDevices: listSyncDevicesMock,
    revokeSyncDevice: revokeSyncDeviceMock
  }))
  vi.doMock('../../../code/src/main/store/keys-repo', () => ({
    listKeys: vi.fn(),
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
    withCnySpendConversion: vi.fn()
  }))
  vi.doMock('../../../code/src/main/log-parsers/sync', () => ({
    syncAllSessions: vi.fn(),
    discoverAllSessions: vi.fn()
  }))
  vi.doMock('../../../code/src/main/log-parsers/cli-auth', () => ({
    detectClaudeKey: vi.fn(),
    detectCodexKey: vi.fn()
  }))
  return (await import('../../../code/src/main/ipc/register-handlers')).registerIpcHandlers
}

describe('sync IPC', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('exposes status, manual trigger, and safe login result without token fields', async () => {
    const registerHandlers = await loadHandlers()
    syncStatusMock.mockReturnValue({ configured: true, state: 'idle', revision: 4 })
    syncNowMock.mockResolvedValue(undefined)
    loginSyncMock.mockResolvedValue({
      deviceId: 'device-1',
      expiresAt: '2026-07-13T00:00:00.000Z'
    })
    listSyncDevicesMock.mockResolvedValue([{ id: 'device-1', name: 'Laptop' }])
    revokeSyncDeviceMock.mockResolvedValue(undefined)
    registerHandlers()

    const status = await handlers.get(IPC.syncStatus)?.()
    const trigger = await handlers.get(IPC.syncNow)?.()
    const login = await handlers.get(IPC.syncLogin)?.(null, {
      baseUrl: 'https://sync.example',
      email: 'a@example.com',
      password: 'password',
      deviceId: 'device-1'
    })
    const devices = await handlers.get(IPC.syncDevices)?.()
    const revoke = await handlers.get(IPC.syncRevokeDevice)?.(null, { deviceId: 'device-2' })

    expect(status).toEqual({ configured: true, state: 'idle', revision: 4 })
    expect(trigger).toEqual({ started: true })
    expect(login).toEqual({ deviceId: 'device-1', expiresAt: '2026-07-13T00:00:00.000Z' })
    expect(devices).toEqual([{ id: 'device-1', name: 'Laptop' }])
    expect(revoke).toEqual({ ok: true })
    expect(JSON.stringify(status)).not.toMatch(/token|secret/i)
  })

  it('lets the user choose and persist a local backup directory', async () => {
    const registerHandlers = await loadHandlers()
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['D:/TokenLub/backups'] })
    registerHandlers()

    await expect(handlers.get(IPC.settingsChooseDirectory)?.()).resolves.toBe('D:/TokenLub/backups')
    expect(showOpenDialogMock).toHaveBeenCalledWith({
      properties: ['openDirectory', 'createDirectory']
    })
  })
})
