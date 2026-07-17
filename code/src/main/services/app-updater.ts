import { app, BrowserWindow, ipcMain } from 'electron'
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo
} from 'electron-updater'
import { IPC } from '@shared/ipc-channels'
import type { AppUpdateStatus } from '@shared/types/app-update'

const INITIAL_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const INSTALL_DELAY_MS = 1_000

let initialized = false
let checkInFlight: Promise<AppUpdateStatus> | null = null
let status: AppUpdateStatus = {
  phase: 'idle',
  currentVersion: app.getVersion()
}

function broadcastStatus(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.appUpdateStatusChanged, status)
  }
}

function updateStatus(next: AppUpdateStatus): void {
  status = next
  broadcastStatus()
}

function statusFor(
  phase: AppUpdateStatus['phase'],
  details: Omit<AppUpdateStatus, 'phase' | 'currentVersion'> = {}
): AppUpdateStatus {
  return {
    phase,
    currentVersion: app.getVersion(),
    ...details
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/(?:ghp|github_pat)_[A-Za-z0-9_]+/g, '[redacted]')
}

function unsupportedMessage(): string | null {
  if (!app.isPackaged) return '开发模式不执行自动更新，请使用已安装的正式版本验证'
  if (process.env['PORTABLE_EXECUTABLE_DIR']) {
    return '便携版无法安全地原地覆盖，请下载安装版后使用自动更新'
  }
  return null
}

function configureUpdaterEvents(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    updateStatus(statusFor('checking'))
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    updateStatus(
      statusFor('available', {
        latestVersion: info.version,
        message: `发现新版本 ${info.version}，正在后台下载`
      })
    )
  })
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    updateStatus(
      statusFor('up-to-date', {
        latestVersion: info.version,
        checkedAt: new Date().toISOString(),
        message: '当前已是最新版本'
      })
    )
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateStatus(
      statusFor('downloading', {
        ...(status.latestVersion ? { latestVersion: status.latestVersion } : {}),
        percent: Math.max(0, Math.min(100, progress.percent)),
        message: '正在后台下载更新'
      })
    )
  })
  autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
    updateStatus(
      statusFor('downloaded', {
        latestVersion: info.version,
        percent: 100,
        checkedAt: new Date().toISOString(),
        message: '更新已下载，正在静默安装并重启'
      })
    )
    const installTimer = setTimeout(() => autoUpdater.quitAndInstall(true, true), INSTALL_DELAY_MS)
    installTimer.unref()
  })
  autoUpdater.on('error', (error: Error) => {
    updateStatus(
      statusFor('error', {
        checkedAt: new Date().toISOString(),
        message: safeErrorMessage(error)
      })
    )
  })
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return { ...status }
}

export function checkForAppUpdates(): Promise<AppUpdateStatus> {
  const unsupportedReason = unsupportedMessage()
  if (unsupportedReason) {
    const unsupported = statusFor('unsupported', {
      message: unsupportedReason
    })
    updateStatus(unsupported)
    return Promise.resolve(unsupported)
  }

  if (checkInFlight) return checkInFlight
  if (
    status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'downloaded'
  ) {
    return Promise.resolve(getAppUpdateStatus())
  }

  checkInFlight = autoUpdater
    .checkForUpdates()
    .then(() => getAppUpdateStatus())
    .catch((error: unknown) => {
      const failed = statusFor('error', {
        checkedAt: new Date().toISOString(),
        message: safeErrorMessage(error)
      })
      updateStatus(failed)
      return failed
    })
    .finally(() => {
      checkInFlight = null
    })
  return checkInFlight
}

export function initializeAppUpdater(): void {
  if (initialized) return
  initialized = true

  configureUpdaterEvents()
  ipcMain.handle(IPC.appUpdateGetStatus, () => getAppUpdateStatus())
  ipcMain.handle(IPC.appUpdateCheck, () => checkForAppUpdates())

  const unsupportedReason = unsupportedMessage()
  if (unsupportedReason) {
    updateStatus(statusFor('unsupported', { message: unsupportedReason }))
    return
  }

  const initialTimer = setTimeout(() => void checkForAppUpdates(), INITIAL_CHECK_DELAY_MS)
  initialTimer.unref()
  const intervalTimer = setInterval(() => void checkForAppUpdates(), CHECK_INTERVAL_MS)
  intervalTimer.unref()
}
