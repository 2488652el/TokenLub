import {
  claimSyncSession,
  createSyncClient,
  loginSyncSession,
  type SyncClient,
  type SyncDevice
} from './client'
import { createSyncScheduler, type SyncScheduler } from './scheduler'
import { runSyncV2Once } from './runner-v2'
import type { SyncMode } from '../../shared/sync-mode'
import { getSyncV2Preview, getSyncV2Revision } from '../store/sync-v2-repo'
import type { SyncPreview } from '../../shared/sync-preview'
import {
  clearSyncSession,
  loadSyncSession,
  saveSyncSession,
  type SyncSession
} from '../store/sync-session'

export type SyncStatus = {
  configured: boolean
  state: 'idle' | 'syncing' | 'error' | 'needs_login'
  revision: number
  lastSuccessAt?: string
  lastError?: string
  mode?: SyncMode
}

let client: SyncClient | null = null
let scheduler: SyncScheduler | null = null
let currentDeviceId: string | null = null
let periodicTimer: ReturnType<typeof setInterval> | null = null
let changeTimer: ReturnType<typeof setTimeout> | null = null
let sessionGeneration = 0
let status: SyncStatus = { configured: false, state: 'idle', revision: 0 }

function clearSyncTimers(): void {
  if (periodicTimer) clearInterval(periodicTimer)
  if (changeTimer) clearTimeout(changeTimer)
  periodicTimer = null
  changeTimer = null
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'sync failed'
  return message.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
}

function setFailure(error: unknown): void {
  const message = safeError(error)
  status = {
    ...status,
    state: message === 'sync authentication failed' ? 'needs_login' : 'error',
    lastError: message
  }
}

export function configureSyncSession(session: SyncSession): void {
  const generation = ++sessionGeneration
  scheduler?.dispose()
  clearSyncTimers()
  currentDeviceId = session.deviceId
  let activeSession = { ...session }
  let activeMode = session.mode
  const configuredClient = createSyncClient({
    ...session,
    onSession: (updated) => {
      if (generation !== sessionGeneration) return
      activeSession = { ...activeSession, ...updated }
      saveSyncSession(activeSession)
    }
  })
  client = configuredClient
  scheduler = createSyncScheduler(
    async () => {
      if (generation !== sessionGeneration) return
      const nextStatus = { ...status }
      delete nextStatus.lastError
      status = { ...nextStatus, state: 'syncing' }
      try {
        const result = await runSyncV2Once(
          configuredClient,
          activeMode,
          () => generation === sessionGeneration
        )
        if (generation !== sessionGeneration) return
        if (activeMode !== 'merge') {
          activeMode = 'merge'
          activeSession = { ...activeSession, mode: activeMode }
          saveSyncSession(activeSession)
        }
        status = {
          ...status,
          state: 'idle',
          revision: getSyncV2Revision(),
          mode: activeMode,
          ...(result.serverTime ? { lastSuccessAt: result.serverTime } : {})
        }
      } catch (error) {
        if (generation !== sessionGeneration) return
        setFailure(error)
        throw error
      }
    },
    {
      shouldRetry: (error) => {
        const message = error instanceof Error ? error.message : ''
        return !(
          message === 'sync authentication failed' ||
          message === 'sync response invalid' ||
          message === 'sync baseline unavailable; choose upload or restore' ||
          /^sync request failed: 4\d\d$/.test(message)
        )
      }
    }
  )
  periodicTimer = setInterval(() => void syncNow().catch(() => undefined), 30 * 60_000)
  periodicTimer.unref?.()
  saveSyncSession(session)
  status = { configured: true, state: 'idle', revision: getSyncV2Revision(), mode: session.mode }
}

export function scheduleSyncAfterChange(): void {
  if (!scheduler) return
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => {
    changeTimer = null
    void syncNow().catch(() => undefined)
  }, 2_000)
  changeTimer.unref?.()
}

export function initializeSync(): void {
  const session = loadSyncSession()
  if (session) configureSyncSession(session)
  else {
    sessionGeneration++
    client = null
    currentDeviceId = null
    scheduler?.dispose()
    scheduler = null
    clearSyncTimers()
    status = { configured: false, state: 'idle', revision: getSyncV2Revision() }
  }
}

function requireClient(): SyncClient {
  if (!client) throw new Error('sync is not configured')
  return client
}

export async function listSyncDevices(): Promise<SyncDevice[]> {
  try {
    return await requireClient().listDevices()
  } catch (error) {
    setFailure(error)
    throw error
  }
}

export async function revokeSyncDevice(deviceId: string): Promise<void> {
  try {
    await requireClient().revokeDevice(deviceId)
    if (deviceId === currentDeviceId) {
      clearSyncSession()
      scheduler?.dispose()
      clearSyncTimers()
      client = null
      scheduler = null
      currentDeviceId = null
      status = { configured: false, state: 'idle', revision: getSyncV2Revision() }
    }
  } catch (error) {
    setFailure(error)
    throw error
  }
}

export async function loginSync(
  input: Parameters<typeof loginSyncSession>[0]
): Promise<{ deviceId: string; expiresAt: string }> {
  try {
    const session = await loginSyncSession(input)
    configureSyncSession(session)
    return { deviceId: session.deviceId, expiresAt: session.expiresAt }
  } catch (error) {
    setFailure(error)
    throw error
  }
}

export async function bindSync(input: Parameters<typeof claimSyncSession>[0]): Promise<void> {
  try {
    const session = await claimSyncSession(input)
    configureSyncSession(session)
  } catch (error) {
    setFailure(error)
    throw error
  }
}

export function syncNow(): Promise<void> {
  if (!scheduler) return Promise.reject(new Error('sync is not configured'))
  return scheduler.trigger().catch((error) => {
    setFailure(error)
    throw error
  })
}

export function getSyncStatus(): SyncStatus {
  return { ...status }
}

export function previewSync(mode: SyncMode): SyncPreview {
  return getSyncV2Preview(mode)
}
