/**
 * Electron 主进程入口模块:负责应用生命周期管理、数据库初始化、IPC 注册、
 * 自动刷新调度与浏览器窗口创建,同时对外部导航/打开链接进行安全校验。
 * (glm-5.2)
 */
import { app, BrowserWindow, dialog, powerMonitor } from 'electron'
import { hostname } from 'node:os'
import { createWindow } from './window'
import { registerIpcHandlers } from './ipc/register-handlers'
import { startAutoRefresh } from './scheduler/refresh'
import { getDb } from './store/db'
import { seedMinimaxPricing } from './pricing/minimax-pricing'
import { bindSync, getSyncStatus, initializeSync, syncNow } from './sync/service'
import { openAllowedExternalUrl } from './platform/external-links'
import { parseSyncBindingLink } from './sync/deep-link'
import { startCatalogAutoRefresh } from './pricing/catalog-service'
import { initializeAppUpdater } from './services/app-updater'

const isDev = !app.isPackaged
const pendingBindingLinks: string[] = []
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) app.quit()

function findBindingLink(args: string[]): string | undefined {
  return args.find((arg) => arg.startsWith('tokenlub://'))
}

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

async function handleBindingLink(value: string): Promise<void> {
  try {
    const binding = parseSyncBindingLink(value)
    await bindSync({
      ...binding,
      deviceName: hostname() || 'TokenLub Desktop',
      platform: process.platform,
      appVersion: app.getVersion()
    })
    focusMainWindow()
    await dialog.showMessageBox({ type: 'info', message: 'TokenLub 已绑定同步服务' })
    void syncNow().catch(() => undefined)
  } catch {
    focusMainWindow()
    await dialog.showMessageBox({
      type: 'error',
      message: '绑定失败',
      detail: '绑定链接无效、已过期或已被使用，请回到 Web 控制台重新绑定。'
    })
  }
}

function acceptBindingLink(value: string | undefined): void {
  if (!value) return
  if (app.isReady()) void handleBindingLink(value)
  else pendingBindingLinks.push(value)
}

if (hasSingleInstanceLock) {
  acceptBindingLink(findBindingLink(process.argv))
  app.on('second-instance', (_event, argv) => {
    focusMainWindow()
    acceptBindingLink(findBindingLink(argv))
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    acceptBindingLink(url)
  })
}

app.whenReady().then(() => {
  app.setName('TokenLub')
  if (process.platform === 'win32') app.setAppUserModelId('com.tokenlub.app')
  if (app.isPackaged) app.setAsDefaultProtocolClient('tokenlub')

  // Open DB + ensure schema before any handler fires. Must run inside
  // whenReady — app.getPath('userData') is unreliable before the 'ready'
  // event, so calling getDb() at module top level risks a wrong path or
  // a thrown error on some Electron versions / fresh user profiles.
  getDb()
  initializeSync()

  // Seed MiniMax catalog prices (idempotent; never overwrites user-set rows).
  // Fire-and-forget — a failure here must not block app startup; pricing can
  // still be entered manually via the 价格配置 page.
  void seedMinimaxPricing().catch((e) => {
    console.warn('[minimax] pricing seed failed:', e)
  })
  startCatalogAutoRefresh()

  registerIpcHandlers()
  initializeAppUpdater()
  startAutoRefresh()

  createWindow()
  for (const link of pendingBindingLinks.splice(0)) void handleBindingLink(link)
  if (getSyncStatus().configured) void syncNow().catch(() => undefined)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    if (getSyncStatus().configured) void syncNow().catch(() => undefined)
  })
})

powerMonitor.on('resume', () => {
  if (getSyncStatus().configured) void syncNow().catch(() => undefined)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (e, url) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      e.preventDefault()
      return
    }
    // Allow navigation only within the app's own origin. In dev the renderer
    // is served from localhost:5173; in production it is a file:// URL.
    // 仅允许应用自身来源的导航;开发环境渲染进程来自 localhost:5173,生产环境为 file://。 (glm-5.2)
    const isAppOrigin = isDev
      ? parsed.origin === 'http://localhost:5173'
      : parsed.protocol === 'file:'
    if (!isAppOrigin) {
      e.preventDefault()
      void openAllowedExternalUrl(url)
    }
  })
})
