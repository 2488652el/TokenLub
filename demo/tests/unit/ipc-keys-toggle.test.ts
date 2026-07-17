/**
 * keys:set-usage-query IPC 处理器单元测试:覆盖 zod 输入校验与 handler 转发逻辑,
 * 校验 (id, enabled) 参数透传与异常输入拒绝。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { IPC } from '../../../code/src/shared/ipc-channels'
import { keysSetUsageQueryInputSchema } from '../../../code/src/shared/ipc-schemas'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const toggleUsageQueryMock = vi.fn()

async function loadRegisterIpcHandlers(): Promise<() => void> {
  vi.resetModules()
  handlers.clear()
  toggleUsageQueryMock.mockReset()

  vi.doMock('electron', () => ({
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown): void => {
        handlers.set(channel, handler)
      }
    },
    BrowserWindow: { getAllWindows: () => [] },
    shell: { openPath: vi.fn(), openExternal: vi.fn() }
  }))
  vi.doMock('../../../code/src/main/store/keys-repo', () => ({
    listKeys: vi.fn(),
    addKey: vi.fn(),
    deleteKey: vi.fn(),
    getDecryptedExtraCredentials: vi.fn(),
    getDecryptedKey: vi.fn(),
    toggleUsageQuery: toggleUsageQueryMock
  }))
  vi.doMock('../../../code/src/main/store/balance-repo', () => ({ latestBalances: vi.fn() }))
  vi.doMock('../../../code/src/main/store/usage-repo', () => ({
    queryUsage: vi.fn(),
    getDashboardSummary: vi.fn(),
    computeTotalSpend: vi.fn()
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
  vi.doMock('../../../code/src/main/log-parsers/sync', () => ({
    syncAllSessions: vi.fn(),
    discoverAllSessions: vi.fn()
  }))
  vi.doMock('../../../code/src/main/log-parsers/cli-auth', () => ({
    detectClaudeKey: vi.fn(),
    detectCodexKey: vi.fn()
  }))

  const mod = await import('../../../code/src/main/ipc/register-handlers')
  return mod.registerIpcHandlers
}

// keysSetUsageQueryInputSchema:校验 toggle 用量查询输入的 uuid 与布尔字段
describe('keysSetUsageQueryInputSchema', () => {
  it('accepts a valid uuid + boolean', () => {
    const r = keysSetUsageQueryInputSchema.safeParse({ id: randomUUID(), enabled: true })
    expect(r.success).toBe(true)
  })

  it('rejects a non-uuid id', () => {
    const r = keysSetUsageQueryInputSchema.safeParse({ id: 'not-uuid', enabled: true })
    expect(r.success).toBe(false)
  })

  it('rejects missing id', () => {
    const r = keysSetUsageQueryInputSchema.safeParse({ enabled: true })
    expect(r.success).toBe(false)
  })

  it('rejects a non-boolean enabled', () => {
    const r = keysSetUsageQueryInputSchema.safeParse({ id: randomUUID(), enabled: 'yes' })
    expect(r.success).toBe(false)
  })
})

// keys:set-usage-query IPC handler:校验参数透传与 zod 校验拦截
describe('keys:set-usage-query IPC handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards (id, enabled) to toggleUsageQuery and returns { ok: true }', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    registerIpcHandlers()

    const handler = handlers.get(IPC.keysSetUsageQuery)
    expect(handler).toBeTypeOf('function')

    const id = randomUUID()
    const result = await handler?.({}, { id, enabled: false })

    expect(toggleUsageQueryMock).toHaveBeenCalledTimes(1)
    expect(toggleUsageQueryMock).toHaveBeenCalledWith(id, false)
    expect(result).toEqual({ ok: true })
  })

  it('rejects malformed input via zod (missing id) and does not call the repo', async () => {
    const registerIpcHandlers = await loadRegisterIpcHandlers()
    registerIpcHandlers()

    const handler = handlers.get(IPC.keysSetUsageQuery)
    expect(handler).toBeTypeOf('function')

    await expect(async () => handler?.({}, { enabled: true })).rejects.toBeInstanceOf(Error)
    expect(toggleUsageQueryMock).not.toHaveBeenCalled()
  })
})

/**
 * Case 3 (preload signature check):
 * `window.api.keys.setUsageQuery(id: string, enabled: boolean): Promise<{ ok: true }>`
 * is exposed by `code/src/preload/index.ts`. We don't invoke ipcRenderer from a unit
 * test (preload only runs under contextBridge inside Electron), but the typed
 * surface above must match what the renderer imports from `TokenLubAPI`.
 */
