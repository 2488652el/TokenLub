/**
 * Electron 主进程入口模块:负责应用生命周期管理、数据库初始化、IPC 注册、
 * 自动刷新调度与浏览器窗口创建,同时对外部导航/打开链接进行安全校验。
 * (glm-5.2)
 */
import { app, BrowserWindow, shell } from 'electron'
import { createWindow } from './window'
import { registerIpcHandlers } from './ipc/register-handlers'
import { startAutoRefresh } from './scheduler/refresh'
import { getDb } from './store/db'
import { seedMinimaxPricing } from './pricing/minimax-pricing'

const isDev = !app.isPackaged

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** 安全地打开外部链接:仅允许 http/https/mailto 协议,拦截其余协议。 (glm-5.2) */
function safeOpenExternal(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)
}

app.whenReady().then(() => {
  app.setName('TokenLub')
  app.setAppUserModelId('com.tokenlub.app')

  // Open DB + ensure schema before any handler fires. Must run inside
  // whenReady — app.getPath('userData') is unreliable before the 'ready'
  // event, so calling getDb() at module top level risks a wrong path or
  // a thrown error on some Electron versions / fresh user profiles.
  getDb()

  // Seed MiniMax catalog prices (idempotent; never overwrites user-set rows).
  // Fire-and-forget — a failure here must not block app startup; pricing can
  // still be entered manually via the 价格配置 page.
  void seedMinimaxPricing().catch((e) => {
    console.warn('[minimax] pricing seed failed:', e)
  })

  registerIpcHandlers()
  startAutoRefresh()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
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
      if (safeOpenExternal(url)) shell.openExternal(url)
    }
  })
})
