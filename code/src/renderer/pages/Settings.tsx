/**
 * 设置页面:提供全局配置项,当前包含余额自动刷新间隔设置。
 * (glm-5.2)
 */
import { Icon } from '../components/Icon'
import { useEffect, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'
import { MoonMeterAppIcon } from '../components/Brand'
import { AnimatedNumber, ProgressBar } from '../components/motion'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useTheme, type ThemeMode } from '../theme'
import type { SyncMode } from '../../shared/sync-mode'
import { SYNC_BACKUP_DIRECTORY_SETTING_KEY } from '../../shared/sync-v2'
import type { AppUpdateStatus } from '../../shared/types/app-update'

// ponytail: scheduler reads `refresh_interval_min` (number, minutes).
// 0 means "关闭" - refresh.ts treats intervalMin <= 0 as a no-op.
//
// 自动刷新间隔选项:0 表示关闭。 (glm-5.2)
const REFRESH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '关闭' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' }
]
/** 自动刷新间隔的设置 key */
const REFRESH_KEY = 'refresh_interval_min'
const APPEARANCE_OPTIONS: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'system', label: '跟随系统', icon: 'fa-display' },
  { value: 'light', label: '浅色', icon: 'fa-sun' },
  { value: 'dark', label: '深色', icon: 'fa-moon' }
]

const UPDATE_PHASE_META: Record<
  AppUpdateStatus['phase'],
  { label: string; badgeClassName: string }
> = {
  idle: {
    label: '等待检查',
    badgeClassName: 'border-border-light bg-bg-card text-text-secondary'
  },
  checking: { label: '检查中', badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700' },
  available: { label: '发现新版本', badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700' },
  downloading: { label: '下载中', badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700' },
  downloaded: {
    label: '正在安装',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700'
  },
  'up-to-date': {
    label: '已是最新',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700'
  },
  error: { label: '更新失败', badgeClassName: 'border-red-200 bg-red-50 text-red-700' },
  unsupported: {
    label: '不可自动更新',
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700'
  }
}

type SyncStatus = Awaited<ReturnType<typeof window.api.sync.status>>
type SyncPreview = Awaited<ReturnType<typeof window.api.sync.preview>>
type SyncDevice = Awaited<ReturnType<typeof window.api.sync.devices>>[number]
type SyncLogin = {
  baseUrl: string
  email: string
  password: string
  deviceId: string
  mode: SyncMode
}

const SYNC_MODE_LABEL: Record<SyncMode, string> = {
  upload: '仅上传',
  restore: '仅恢复',
  merge: '合并'
}

const SYNC_STATE_META: Record<
  SyncStatus['state'],
  { label: string; description: string; dotClassName: string; badgeClassName: string }
> = {
  idle: {
    label: '已连接',
    description: '云端同步连接正常',
    dotClassName: 'bg-emerald-500',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700'
  },
  syncing: {
    label: '同步中',
    description: '正在安全地更新云端快照',
    dotClassName: 'bg-sky-500',
    badgeClassName: 'border-sky-200 bg-sky-50 text-sky-700'
  },
  error: {
    label: '同步异常',
    description: '最近一次同步未完成，请检查连接后重试',
    dotClassName: 'bg-red-500',
    badgeClassName: 'border-red-200 bg-red-50 text-red-700'
  },
  needs_login: {
    label: '需要重新登录',
    description: '登录凭据已失效，请重新连接同步服务',
    dotClassName: 'bg-amber-500',
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700'
  }
}

/**
 * 设置页面组件。
 * 读取并持久化余额自动刷新间隔设置。
 */
export default function Settings() {
  const { mode, setMode } = useTheme()
  const [refreshMin, setRefreshMin] = useState<number>(30)
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null)
  const [devices, setDevices] = useState<SyncDevice[]>([])
  const [syncing, setSyncing] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [syncStatusInitialized, setSyncStatusInitialized] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null)
  const [refreshSaving, setRefreshSaving] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [backupDirectory, setBackupDirectory] = useState<string | null>(null)
  const [login, setLogin] = useState<SyncLogin>({
    baseUrl: '',
    email: '',
    password: '',
    deviceId: '',
    mode: 'merge'
  })
  const syncBusy = syncing || loggingIn || revokingDeviceId !== null
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    void window.api.settings.get().then((all) => {
      // ponytail: settings.get returns unknown — coerce defensively.
      const raw = all[REFRESH_KEY]
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isFinite(n) && n >= 0) setRefreshMin(n)
      const configuredBackupDirectory = all[SYNC_BACKUP_DIRECTORY_SETTING_KEY]
      if (typeof configuredBackupDirectory === 'string' && configuredBackupDirectory.trim()) {
        setBackupDirectory(configuredBackupDirectory)
      }
    })
  }, [])

  useEffect(() => {
    let active = true
    const unsubscribe = window.api.appUpdate.onStatusChange((next) => {
      if (active) setAppUpdateStatus(next)
    })
    void window.api.appUpdate.getStatus().then((next) => {
      if (active) setAppUpdateStatus(next)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    void refreshSyncPanel()
      .catch((error) => {
        setSyncError(`无法读取同步状态：${(error as Error).message}`)
      })
      .finally(() => setSyncStatusInitialized(true))
  }, [])

  useEffect(() => {
    void window.api.sync
      .preview(login.mode)
      .then(setSyncPreview)
      .catch(() => setSyncPreview(null))
  }, [login.mode])

  async function refreshSyncPanel() {
    const next = await window.api.sync.status()
    setSyncStatus(next)
    if (!next.configured) {
      setDevices([])
      return
    }
    try {
      setDevices(await window.api.sync.devices())
    } catch {
      setDevices([])
    }
  }

  /** 切换自动刷新间隔并持久化(失败时回滚) */
  async function changeRefresh(value: number) {
    const prev = refreshMin
    setRefreshMin(value)
    setRefreshSaving(true)
    try {
      await window.api.settings.set(REFRESH_KEY, value)
    } catch (e) {
      setRefreshMin(prev)
      window.alert(`设置失败：${(e as Error).message}`)
    } finally {
      setRefreshSaving(false)
    }
  }

  async function checkForAppUpdate() {
    try {
      setAppUpdateStatus((current) => ({
        phase: 'checking',
        currentVersion: current?.currentVersion ?? window.api.version
      }))
      setAppUpdateStatus(await window.api.appUpdate.check())
    } catch (error) {
      setAppUpdateStatus({
        phase: 'error',
        currentVersion: appUpdateStatus?.currentVersion ?? window.api.version,
        message: (error as Error).message
      })
    }
  }

  async function triggerSync() {
    if (!syncStatus?.configured || syncBusy) return
    setSyncing(true)
    setSyncError(null)
    try {
      await window.api.sync.trigger()
      await refreshSyncPanel()
    } catch (error) {
      setSyncError((error as Error).message)
      await refreshSyncPanel().catch(() => undefined)
    } finally {
      setSyncing(false)
    }
  }

  async function chooseBackupDirectory() {
    if (syncBusy) return
    setSyncError(null)
    try {
      const selected = await window.api.settings.chooseDirectory()
      if (!selected) return
      setBackupDirectory(selected)
      setSyncPreview(await window.api.sync.preview(login.mode))
    } catch (error) {
      setSyncError(`备份目录设置失败：${(error as Error).message}`)
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (syncBusy) return
    if (
      login.mode === 'restore' &&
      !window.confirm('恢复云端数据会覆盖本机已有的同步投影，确认继续？')
    ) {
      return
    }
    setLoggingIn(true)
    setLoginError(null)
    try {
      await window.api.sync.login(login)
      setSyncError(null)
      setLogin((current) => ({ ...current, password: '' }))
      setReconnecting(false)
      await refreshSyncPanel()
    } catch (error) {
      setLoginError((error as Error).message)
    } finally {
      setLoggingIn(false)
    }
  }

  async function revokeDevice(device: SyncDevice) {
    if (device.revokedAt || syncBusy) return
    if (!window.confirm(`确认撤销设备「${device.name}」？`)) return
    setRevokingDeviceId(device.id)
    setSyncError(null)
    try {
      await window.api.sync.revokeDevice(device.id)
      await refreshSyncPanel()
    } catch (error) {
      setSyncError((error as Error).message)
      await refreshSyncPanel().catch(() => undefined)
    } finally {
      setRevokingDeviceId(null)
    }
  }

  const statusMeta = syncStatus ? SYNC_STATE_META[syncStatus.state] : null
  const showLoginForm = !syncStatus?.configured || reconnecting
  const updateMeta = UPDATE_PHASE_META[appUpdateStatus?.phase ?? 'idle']
  const updateBusy =
    appUpdateStatus?.phase === 'checking' ||
    appUpdateStatus?.phase === 'available' ||
    appUpdateStatus?.phase === 'downloading' ||
    appUpdateStatus?.phase === 'downloaded'

  return (
    <div className="page-content" data-motion-group>
      <PageHeader title="设置" desc="管理 MoonMeter 的外观、更新、自动刷新与云端同步" />

      <Card title="外观" icon="fa-sun" motionOrder={0}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-text-primary">界面主题</div>
            <p className="form-hint mt-1">
              月光纸感会随主题保持一致；「跟随系统」将在系统外观变化时自动切换。
            </p>
          </div>
          <div
            className="grid grid-cols-3 gap-1 rounded-full border border-border-light bg-bg-base/50 p-1"
            role="group"
            aria-label="界面主题"
          >
            {APPEARANCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-medium transition-colors ${
                  mode === option.value
                    ? 'bg-text-primary text-bg-base'
                    : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
                }`}
                onClick={() => setMode(option.value)}
                aria-pressed={mode === option.value}
              >
                <Icon name={option.icon} />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="mt-4" title="应用更新" icon="fa-cloud-arrow-down" motionOrder={1}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-text-primary">
                当前版本 {appUpdateStatus?.currentVersion ?? window.api.version}
              </span>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${updateMeta.badgeClassName}`}
              >
                {updateMeta.label}
              </span>
              {appUpdateStatus?.latestVersion &&
                appUpdateStatus.latestVersion !== appUpdateStatus.currentVersion && (
                  <span className="text-[12px] text-text-secondary">
                    最新版本 {appUpdateStatus.latestVersion}
                  </span>
                )}
            </div>
            <p className="form-hint mt-1.5">
              安装版启动后会自动检查 GitHub Release。新版本将在后台下载，随后静默覆盖安装并重启；
              本地数据库和设置位于独立的用户数据目录，不会被安装包覆盖。
            </p>
            {appUpdateStatus?.message && (
              <div
                className={`mt-2 text-[12px] ${appUpdateStatus.phase === 'error' ? 'text-red-600' : 'text-text-secondary'}`}
                role="status"
                aria-live="polite"
              >
                {appUpdateStatus.message}
              </div>
            )}
            {appUpdateStatus?.phase === 'downloading' && (
              <div className="mt-3 flex items-center gap-2">
                <ProgressBar
                  value={(appUpdateStatus.percent ?? 0) / 100}
                  label="更新下载进度"
                  tone="accent"
                  trackClassName="h-1.5 flex-1"
                />
                <span className="w-10 text-right font-mono text-[11px] text-text-muted">
                  <AnimatedNumber
                    value={appUpdateStatus.percent ?? 0}
                    format={(value) => `${Math.round(value)}%`}
                  />
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm shrink-0"
            onClick={() => void checkForAppUpdate()}
            disabled={updateBusy}
          >
            <Icon
              name="fa-arrows-rotate"
              className={updateBusy && !reducedMotion ? 'icon-spin' : ''}
            />
            {appUpdateStatus?.phase === 'checking' ? '检查中…' : '检查更新'}
          </button>
        </div>
      </Card>

      <Card
        className={`mt-4 ${refreshSaving ? 'motion-data-flash' : ''}`}
        title="余额自动刷新"
        icon="fa-arrows-rotate"
        motionOrder={2}
      >
        <div className="flex items-center justify-between gap-3 text-[13px] text-text-secondary">
          <div>
            <div className="text-text-primary">余额自动刷新间隔</div>
            <p className="form-hint mt-1">
              定时刷新所有 Provider 余额并触发告警评估。选择「关闭」将停止自动刷新（仍可手动触发）。
            </p>
          </div>
          <select
            className="select"
            value={refreshMin}
            onChange={(e) => changeRefresh(Number(e.target.value))}
            aria-label="余额自动刷新间隔"
            disabled={refreshSaving}
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="sr-only" role="status" aria-live="polite">
            {refreshSaving
              ? '正在保存自动刷新设置'
              : refreshMin === 0
                ? '自动刷新已关闭'
                : `自动刷新已设置为 ${refreshMin} 分钟`}
          </span>
        </div>
      </Card>

      <Card className="mt-4" bodyClassName="p-0" motionOrder={3}>
        <div className="border-b border-border-light bg-bg-base/45 px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <MoonMeterAppIcon className="h-12 w-12 shrink-0" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-text-primary">
                    MoonMeter 云端同步
                  </h2>
                  {syncStatus?.configured && statusMeta && (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${statusMeta.badgeClassName}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClassName}`} />
                      {statusMeta.label}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-text-secondary">
                  {syncStatus?.configured && statusMeta
                    ? statusMeta.description
                    : '在你的设备之间安全同步设置、价格与余额快照'}
                </p>
              </div>
            </div>
            {syncStatus?.configured && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setLoginError(null)
                    setReconnecting((current) => !current)
                  }}
                  disabled={syncBusy}
                  aria-expanded={reconnecting}
                >
                  <Icon name="fa-link" />
                  {reconnecting ? '收起连接' : '重新连接'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void triggerSync()}
                  disabled={!syncStatus.configured || syncBusy}
                >
                  <Icon
                    name="fa-arrows-rotate"
                    className={syncing && !reducedMotion ? 'icon-spin' : ''}
                  />
                  {syncing ? '同步中…' : '立即同步'}
                </button>
              </div>
            )}
          </div>
        </div>

        {!syncStatusInitialized ? (
          <div
            className="flex min-h-40 items-center justify-center gap-2 px-5 py-8 text-[12.5px] text-text-secondary"
            role="status"
            aria-live="polite"
          >
            <Icon
              name="fa-circle-notch"
              className={`${!reducedMotion ? 'icon-spin' : ''} text-emerald-600`}
            />
            正在读取同步状态…
          </div>
        ) : showLoginForm ? (
          <form className="px-5 py-5" onSubmit={(event) => void handleLogin(event)}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[13.5px] font-semibold text-text-primary">
                  {syncStatus?.configured ? '重新连接同步服务' : '连接同步服务'}
                </h3>
                <p className="form-hint mt-1">
                  凭据仅用于建立同步会话。首次连接前请选择数据合并方式。
                </p>
              </div>
              {!syncStatus?.configured && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-medium text-emerald-700">
                  本地优先
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12.5px] font-medium text-text-secondary">
                服务地址
                <input
                  className="input mt-1.5"
                  type="url"
                  value={login.baseUrl}
                  onChange={(event) =>
                    setLogin((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                  placeholder="https://sync.example.com"
                  autoComplete="url"
                  required
                  disabled={loggingIn}
                />
              </label>
              <label className="text-[12.5px] font-medium text-text-secondary">
                邮箱
                <input
                  className="input mt-1.5"
                  type="email"
                  value={login.email}
                  onChange={(event) =>
                    setLogin((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="name@example.com"
                  autoComplete="email"
                  required
                  disabled={loggingIn}
                />
              </label>
              <label className="text-[12.5px] font-medium text-text-secondary">
                密码
                <input
                  className="input mt-1.5"
                  type="password"
                  value={login.password}
                  onChange={(event) =>
                    setLogin((current) => ({ ...current, password: event.target.value }))
                  }
                  autoComplete="current-password"
                  required
                  disabled={loggingIn}
                />
              </label>
              <label className="text-[12.5px] font-medium text-text-secondary">
                设备 ID
                <input
                  className="input mt-1.5"
                  type="text"
                  value={login.deviceId}
                  onChange={(event) =>
                    setLogin((current) => ({ ...current, deviceId: event.target.value }))
                  }
                  placeholder="例如：office-desktop"
                  autoComplete="off"
                  required
                  disabled={loggingIn}
                />
              </label>
              <label className="text-[12.5px] font-medium text-text-secondary sm:col-span-2">
                初次同步模式
                <select
                  className="select mt-1.5 w-full"
                  value={login.mode}
                  onChange={(event) =>
                    setLogin((current) => ({ ...current, mode: event.target.value as SyncMode }))
                  }
                  disabled={loggingIn}
                >
                  <option value="merge">合并本机与云端</option>
                  <option value="upload">仅上传本机数据</option>
                  <option value="restore">仅恢复云端数据</option>
                </select>
              </label>
            </div>

            {syncPreview && (
              <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-3 text-[12px] text-text-secondary">
                <div className="grid gap-2 sm:grid-cols-3">
                  <span>
                    <strong className="font-medium text-text-primary">本机实体</strong>
                    <br />
                    设置 {syncPreview.settings} · 价格 {syncPreview.pricing} · 余额{' '}
                    {syncPreview.balance}
                  </span>
                  <span>
                    <strong className="font-medium text-text-primary">预计上传</strong>
                    <br />
                    {syncPreview.expectedUploads} 条
                  </span>
                  <span className="min-w-0 break-all">
                    <strong className="font-medium text-text-primary">备份目录</strong>
                    <br />
                    <span>{backupDirectory ?? syncPreview.backupDirectory ?? '不可用'}</span>
                    <button
                      type="button"
                      className="btn btn-outline btn-xs ml-2 align-middle"
                      onClick={() => void chooseBackupDirectory()}
                      disabled={syncBusy}
                    >
                      修改
                    </button>
                  </span>
                </div>
                <div className="mt-2 border-t border-emerald-100 pt-2 text-text-primary">
                  <Icon name="fa-shield-halved" className="mr-1.5 text-emerald-600" />
                  风险提示：{syncPreview.risk}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-primary" disabled={syncBusy}>
                <Icon
                  name={loggingIn ? 'fa-circle-notch' : 'fa-link'}
                  className={loggingIn && !reducedMotion ? 'icon-spin' : ''}
                />
                {loggingIn ? '连接中…' : '连接并开始同步'}
              </button>
              {syncStatus?.configured && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setReconnecting(false)}
                  disabled={loggingIn}
                >
                  取消
                </button>
              )}
              <div className="min-h-5 text-[12px] text-red-600" role="alert" aria-live="polite">
                {loginError}
              </div>
            </div>
          </form>
        ) : (
          <div className="px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border-light bg-bg-base/45 px-3.5 py-3">
                <div className="text-[11.5px] text-text-muted">当前模式</div>
                <div className="mt-1 text-[13px] font-medium text-text-primary">
                  {syncStatus?.mode ? SYNC_MODE_LABEL[syncStatus.mode] : '尚未设置'}
                </div>
              </div>
              <div className="rounded-lg border border-border-light bg-bg-base/45 px-3.5 py-3">
                <div className="text-[11.5px] text-text-muted">快照版本</div>
                <div className="mt-1 text-[13px] font-medium text-text-primary">
                  {syncStatus?.revision ?? 0}
                </div>
              </div>
              <div className="rounded-lg border border-border-light bg-bg-base/45 px-3.5 py-3">
                <div className="text-[11.5px] text-text-muted">最近同步</div>
                <div className="mt-1 truncate text-[13px] font-medium text-text-primary">
                  {syncStatus?.lastSuccessAt ?? '暂无记录'}
                </div>
              </div>
            </div>
            {syncStatus?.lastError && (
              <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {syncStatus.lastError}
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 px-5" role="status" aria-live="polite">
          {syncError && (
            <div className="mb-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {syncError}
            </div>
          )}
        </div>

        {devices.length > 0 && (
          <div className="border-t border-border-light px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[12.5px] font-semibold text-text-primary">已连接设备</div>
                <div className="mt-0.5 text-[11.5px] text-text-muted">
                  撤销后，该设备需要重新登录才能继续同步
                </div>
              </div>
              <span className="rounded-full bg-bg-base/45 px-2 py-1 text-[11px] text-text-secondary">
                {devices.length} 台
              </span>
            </div>
            <div className="space-y-2">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-light bg-bg-base/45 px-3.5 py-3 text-[12px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-card text-text-muted shadow-sm">
                      <Icon name="fa-laptop" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-text-primary">{device.name}</div>
                      <div className="truncate font-mono text-text-muted">{device.id}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-xs shrink-0"
                    disabled={!!device.revokedAt || syncBusy}
                    onClick={() => void revokeDevice(device)}
                    title="撤销设备"
                  >
                    <Icon
                      name={revokingDeviceId === device.id ? 'fa-circle-notch' : 'fa-ban'}
                      className={
                        revokingDeviceId === device.id && !reducedMotion ? 'icon-spin' : ''
                      }
                    />
                    {device.revokedAt
                      ? '已撤销'
                      : revokingDeviceId === device.id
                        ? '撤销中…'
                        : '撤销'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
