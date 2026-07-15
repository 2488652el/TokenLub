import { describe, expect, it, vi } from 'vitest'
import { claimSyncSession, createSyncClient, loginSyncSession } from '../../../src/main/sync/client'

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('SyncClient', () => {
  it('claims a one-time app binding ticket without a password', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          deviceId: 'device-bound',
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: '2026-07-16T00:00:00.000Z'
        },
        201
      )
    )

    await expect(
      claimSyncSession({
        baseUrl: 'https://sync.example/',
        ticket: 'ticket-1',
        deviceName: 'Laptop',
        platform: 'win32',
        appVersion: '1.0.3',
        fetcher
      })
    ).resolves.toMatchObject({ baseUrl: 'https://sync.example', deviceId: 'device-bound' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://sync.example/v1/auth/bind',
      expect.objectContaining({
        body: JSON.stringify({
          ticket: 'ticket-1',
          deviceName: 'Laptop',
          platform: 'win32',
          appVersion: '1.0.3'
        })
      })
    )
  })

  it('logs in without returning raw credentials to the renderer contract', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        deviceId: 'device-1',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2026-07-13T00:00:00.000Z'
      })
    )

    await expect(
      loginSyncSession({
        baseUrl: 'https://sync.example/',
        email: 'a@example.com',
        password: 'password',
        deviceId: 'device-1',
        fetcher
      })
    ).resolves.toEqual({
      baseUrl: 'https://sync.example',
      deviceId: 'device-1',
      mode: 'merge',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: '2026-07-13T00:00:00.000Z'
    })
  })

  it('exchanges exactly one V2 snapshot', async () => {
    const response = {
      revision: 1,
      serverTime: '2026-07-14T00:00:00.000Z',
      snapshot: { settings: { refresh_interval_min: 15 }, pricing: [], balances: [] },
      changed: true,
      accepted: true
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response))
    const client = createSyncClient({
      baseUrl: 'https://sync.example',
      deviceId: 'device-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      fetcher
    })

    await expect(
      client.exchange({ baseRevision: 0, strategy: 'merge', snapshot: response.snapshot })
    ).resolves.toEqual(response)
    expect(fetcher).toHaveBeenCalledWith(
      'https://sync.example/v1/sync/exchange',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          protocolVersion: 2,
          deviceId: 'device-1',
          baseRevision: 0,
          strategy: 'merge',
          snapshot: response.snapshot
        })
      })
    )
  })

  it('refreshes an expired access token and persists the rotated session', async () => {
    const onSession = vi.fn()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresAt: '2026-07-14T01:00:00.000Z'
        })
      )
      .mockResolvedValueOnce(jsonResponse([]))
    const client = createSyncClient({
      baseUrl: 'https://sync.example',
      deviceId: 'device-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      fetcher,
      onSession
    })

    await expect(client.listDevices()).resolves.toEqual([])
    expect(onSession).toHaveBeenCalledWith({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: '2026-07-14T01:00:00.000Z'
    })
    expect(fetcher.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer access-2' })
      })
    )
  })

  it('shares one refresh-token rotation across concurrent 401 responses', async () => {
    let refreshCalls = 0
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).endsWith('/v1/auth/refresh')) {
        refreshCalls++
        return jsonResponse({
          accessToken: 'access-2',
          refreshToken: 'refresh-2',
          expiresAt: '2026-07-14T01:00:00.000Z'
        })
      }
      const authorization = (init?.headers as Record<string, string>)?.authorization
      return authorization === 'Bearer access-1'
        ? jsonResponse({ error: 'unauthorized' }, 401)
        : jsonResponse([])
    })
    const client = createSyncClient({
      baseUrl: 'https://sync.example',
      deviceId: 'device-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      fetcher
    })

    await Promise.all([client.listDevices(), client.listDevices()])

    expect(refreshCalls).toBe(1)
  })

  it('honors Retry-After once for rate-limited exchanges', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ error: 'rate_limited' }, 429, { 'retry-after': '1' }))
        .mockResolvedValueOnce(
          jsonResponse({
            revision: 0,
            serverTime: '2026-07-14T00:00:00.000Z',
            snapshot: { settings: {}, pricing: [], balances: [] },
            changed: false,
            accepted: true
          })
        )
      const client = createSyncClient({
        baseUrl: 'https://sync.example',
        deviceId: 'device-1',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        fetcher
      })
      const exchange = client.exchange({
        baseRevision: 0,
        strategy: 'merge',
        snapshot: { settings: {}, pricing: [], balances: [] }
      })

      await vi.advanceTimersByTimeAsync(999)
      expect(fetcher).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      await expect(exchange).resolves.toMatchObject({ revision: 0 })
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists and revokes devices through the authenticated request path', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([{ id: 'device-1', name: 'Laptop' }]))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    const client = createSyncClient({
      baseUrl: 'https://sync.example',
      deviceId: 'device-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      fetcher
    })

    await expect(client.listDevices()).resolves.toEqual([{ id: 'device-1', name: 'Laptop' }])
    await expect(client.revokeDevice('device-2')).resolves.toEqual({ ok: true })
  })
})
