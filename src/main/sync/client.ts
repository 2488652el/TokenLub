import type { SyncMode } from '../../shared/sync-mode'
import {
  SYNC_V2_PROTOCOL_VERSION,
  type SyncV2ExchangeResult,
  type SyncV2Snapshot,
  type SyncV2Strategy
} from '../../shared/sync-v2'

export type SyncDevice = {
  id: string
  userId: string
  name: string
  createdAt: string
  revokedAt: string | null
}

type SessionUpdate = {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

type LoginOptions = {
  baseUrl: string
  email: string
  password: string
  deviceId: string
  mode?: SyncMode
  fetcher?: typeof fetch
}

type ClaimOptions = {
  baseUrl: string
  ticket: string
  deviceName: string
  platform: string
  appVersion: string
  mode?: SyncMode
  fetcher?: typeof fetch
}

export type SyncClient = {
  exchange(input: {
    baseRevision: number
    strategy: SyncV2Strategy
    snapshot: SyncV2Snapshot
  }): Promise<SyncV2ExchangeResult>
  listDevices(): Promise<SyncDevice[]>
  revokeDevice(deviceId: string): Promise<{ ok: true }>
}

function parseSession(body: unknown): SessionUpdate {
  const session = body as Partial<SessionUpdate> | null
  if (
    !session ||
    typeof session.accessToken !== 'string' ||
    typeof session.refreshToken !== 'string' ||
    typeof session.expiresAt !== 'string'
  ) {
    throw new Error('sync authentication failed')
  }
  return session as SessionUpdate
}

export async function loginSyncSession(options: LoginOptions) {
  const fetcher = options.fetcher ?? fetch
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetcher(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: options.email,
        password: options.password,
        deviceId: options.deviceId,
        mode: options.mode ?? 'merge'
      })
    })
  } catch {
    throw new Error('sync authentication failed')
  }
  if (!response.ok) throw new Error('sync authentication failed')
  const session = parseSession(await response.json().catch(() => null))
  return { baseUrl, deviceId: options.deviceId, mode: options.mode ?? 'merge', ...session }
}

export async function claimSyncSession(options: ClaimOptions) {
  const fetcher = options.fetcher ?? fetch
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetcher(`${baseUrl}/v1/auth/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ticket: options.ticket,
        deviceName: options.deviceName,
        platform: options.platform,
        appVersion: options.appVersion
      })
    })
  } catch {
    throw new Error('sync binding failed')
  }
  if (!response.ok) throw new Error('sync binding failed')
  const body = (await response.json().catch(() => null)) as
    (Partial<SessionUpdate> & { deviceId?: string }) | null
  if (!body || typeof body.deviceId !== 'string') throw new Error('sync binding failed')
  const session = parseSession(body)
  return { baseUrl, deviceId: body.deviceId, mode: options.mode ?? 'merge', ...session }
}

type SyncClientOptions = {
  baseUrl: string
  deviceId: string
  accessToken: string
  refreshToken: string
  fetcher?: typeof fetch
  onSession?: (session: SessionUpdate) => void | Promise<void>
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const fetcher = options.fetcher ?? fetch
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  let accessToken = options.accessToken
  let refreshToken = options.refreshToken
  let refreshInFlight: Promise<void> | null = null

  const performRefresh = async (): Promise<void> => {
    let response: Response
    try {
      response = await fetcher(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken, deviceId: options.deviceId })
      })
    } catch {
      throw new Error('sync authentication failed')
    }
    if (!response.ok) throw new Error('sync authentication failed')

    const session = parseSession(await response.json().catch(() => null))
    accessToken = session.accessToken
    refreshToken = session.refreshToken
    await options.onSession?.(session)
  }

  const refresh = (): Promise<void> => {
    if (!refreshInFlight) {
      refreshInFlight = performRefresh().finally(() => {
        refreshInFlight = null
      })
    }
    return refreshInFlight
  }

  const request = async <T>(
    path: string,
    body: unknown,
    retry = true,
    method: 'POST' | 'GET' | 'DELETE' = 'POST',
    retry429 = true
  ): Promise<T> => {
    let response: Response
    try {
      const init: RequestInit = {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        }
      }
      if (body !== undefined) init.body = JSON.stringify(body)
      response = await fetcher(`${baseUrl}${path}`, init)
    } catch {
      throw new Error('sync network error')
    }
    if (response.status === 401 && retry) {
      await refresh()
      return request<T>(path, body, false, method)
    }
    if (response.status === 429 && retry429) {
      await waitForRetry(response.headers.get('retry-after'))
      return request<T>(path, body, retry, method, false)
    }
    if (!response.ok) throw new Error(`sync request failed: ${response.status}`)
    try {
      return (await response.json()) as T
    } catch {
      throw new Error('sync response invalid')
    }
  }

  return {
    exchange(input) {
      return request<SyncV2ExchangeResult>('/v1/sync/exchange', {
        protocolVersion: SYNC_V2_PROTOCOL_VERSION,
        deviceId: options.deviceId,
        ...input
      })
    },
    listDevices() {
      return request<SyncDevice[]>('/v1/devices', undefined, true, 'GET')
    },
    revokeDevice(deviceId: string) {
      return request<{ ok: true }>(
        `/v1/devices/${encodeURIComponent(deviceId)}`,
        undefined,
        true,
        'DELETE'
      )
    }
  }
}

async function waitForRetry(header: string | null): Promise<void> {
  const seconds = header === null ? Number.NaN : Number(header)
  const delay = Number.isFinite(seconds)
    ? Math.min(Math.max(seconds, 0) * 1000, 60_000)
    : header
      ? Math.min(Math.max(Date.parse(header) - Date.now(), 0), 60_000)
      : 1_000
  await new Promise<void>((resolve) => setTimeout(resolve, delay))
}
