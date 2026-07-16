import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../src/shared/ipc-channels'

type EventListener = (...args: unknown[]) => void

const state = vi.hoisted(() => ({
  isPackaged: true,
  listeners: new Map<string, EventListener[]>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
  quitAndInstall: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.isPackaged
    },
    getVersion: () => '1.0.5'
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: state.send }
      }
    ]
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    allowDowngrade: true,
    on: (event: string, listener: EventListener) => {
      const listeners = state.listeners.get(event) ?? []
      listeners.push(listener)
      state.listeners.set(event, listeners)
    },
    checkForUpdates: state.checkForUpdates,
    quitAndInstall: state.quitAndInstall
  }
}))

function emit(event: string, ...args: unknown[]): void {
  for (const listener of state.listeners.get(event) ?? []) listener(...args)
}

async function loadUpdater() {
  vi.resetModules()
  return import('../../src/main/services/app-updater')
}

describe('application updater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.isPackaged = true
    state.listeners.clear()
    state.handlers.clear()
    state.checkForUpdates.mockReset()
    state.checkForUpdates.mockResolvedValue(null)
    state.quitAndInstall.mockReset()
    state.send.mockReset()
    delete process.env['PORTABLE_EXECUTABLE_DIR']
  })

  afterEach(() => {
    delete process.env['PORTABLE_EXECUTABLE_DIR']
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('registers IPC and checks shortly after a packaged app starts', async () => {
    const { initializeAppUpdater } = await loadUpdater()
    initializeAppUpdater()

    expect(state.handlers.has(IPC.appUpdateGetStatus)).toBe(true)
    expect(state.handlers.has(IPC.appUpdateCheck)).toBe(true)
    expect(state.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(state.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('does not contact the update server in development', async () => {
    state.isPackaged = false
    const { initializeAppUpdater } = await loadUpdater()
    initializeAppUpdater()

    const check = state.handlers.get(IPC.appUpdateCheck)
    const result = await check?.()

    expect(result).toMatchObject({ phase: 'unsupported', currentVersion: '1.0.5' })
    expect(state.checkForUpdates).not.toHaveBeenCalled()
  })

  it('does not replace a portable build with an NSIS installation', async () => {
    process.env['PORTABLE_EXECUTABLE_DIR'] = 'C:\\TokenLub'
    const { getAppUpdateStatus, initializeAppUpdater } = await loadUpdater()
    initializeAppUpdater()

    expect(getAppUpdateStatus()).toMatchObject({
      phase: 'unsupported',
      message: '便携版无法安全地原地覆盖，请下载安装版后使用自动更新'
    })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(state.checkForUpdates).not.toHaveBeenCalled()
  })

  it('reports download progress and silently installs the downloaded update', async () => {
    const { getAppUpdateStatus, initializeAppUpdater } = await loadUpdater()
    initializeAppUpdater()

    emit('update-available', { version: '1.1.0' })
    emit('download-progress', { percent: 63.25 })
    expect(getAppUpdateStatus()).toMatchObject({
      phase: 'downloading',
      currentVersion: '1.0.5',
      latestVersion: '1.1.0',
      percent: 63.25
    })

    emit('update-downloaded', { version: '1.1.0' })
    expect(getAppUpdateStatus()).toMatchObject({ phase: 'downloaded', percent: 100 })
    expect(state.quitAndInstall).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('redacts GitHub tokens from updater errors', async () => {
    const { getAppUpdateStatus, initializeAppUpdater } = await loadUpdater()
    initializeAppUpdater()

    emit('error', new Error('request failed for ghp_1234567890secret'))

    expect(getAppUpdateStatus()).toMatchObject({
      phase: 'error',
      message: 'request failed for [redacted]'
    })
  })
})
