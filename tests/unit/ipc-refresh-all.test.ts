/**
 * usage refresh IPC 单元测试:覆盖 usage:refresh-all handler,
 * 校验其返回 refreshAll 的明细计数而非简单的 fire-and-forget 应答。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc-channels'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const refreshAllMock = vi.fn()
const listKeysMock = vi.fn()

async function loadRegisterIpcHandlers(): Promise<() => void> {
  vi.resetModules()
  handlers.clear()
  refreshAllMock.mockReset()
  listKeysMock.mockReset()

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
    listKeys: listKeysMock,
    addKey: vi.fn(),
    deleteKey: vi.fn(),
    getDecryptedExtraCredentials: vi.fn(),
    getDecryptedKey: vi.fn()
  }))
  vi.doMock('../../src/main/store/balance-repo', () => ({ latestBalances: vi.fn() }))
  vi.doMock('../../src/main/store/usage-repo', () => ({
    queryUsage: vi.fn(),
    getDashboardSummary: vi.fn()
  }))
  vi.doMock('../../src/main/store/pricing-repo', () => ({
    listPricing: vi.fn(),
    setPricing: vi.fn(),
    deletePricing: vi.fn()
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
  vi.doMock('../../src/main/providers/registry', () => ({
    listProviders: vi.fn(),
    getProvider: vi.fn()
  }))
  vi.doMock('../../src/main/scheduler/refresh', () => ({
    refreshAll: refreshAllMock,
    restartAutoRefresh: vi.fn()
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

// usage refresh IPC:校验返回刷新明细计数
describe('usage refresh IPC', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns refresh counts from refreshAll instead of a fire-and-forget acknowledgement', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    listKeysMock.mockReturnValue([{ id: 'k1' }, { id: 'k2' }])
    refreshAllMock.mockResolvedValue({
      ok: true,
      refreshed: 1,
      usageInserted: 3,
      usageSkipped: 2,
      failed: 1
    })

    registerIpcHandlers()
    const handler = handlers.get(IPC.usageRefreshAll)
    expect(handler).toBeTypeOf('function')
    const result = await handler?.()

    expect(refreshAllMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      started: true,
      queued: 2,
      ok: true,
      refreshed: 1,
      usageInserted: 3,
      usageSkipped: 2,
      failed: 1
    })
  })
})
