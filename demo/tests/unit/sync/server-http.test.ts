import { describe, expect, it } from 'vitest'
import {
  createInMemoryPhase1Store,
  Phase1AuthService,
  type Phase1Store
} from '../../../../drive/src/server/phase1'
import { createPhase1HttpHandler, type HttpLogEntry } from '../../../../drive/src/server/http'
import {
  SnapshotSyncService,
  type StoredSyncV2Snapshot
} from '../../../../drive/src/server/snapshot-sync'
import { BindingTicketService } from '../../../../drive/src/server/binding-ticket'

function createFixture(rateLimit = 120) {
  const store = createInMemoryPhase1Store()
  const auth = new Phase1AuthService({
    store,
    now: () => new Date('2026-07-14T00:00:00.000Z')
  })
  let snapshot: StoredSyncV2Snapshot | undefined
  const snapshotSync = new SnapshotSyncService({
    store: createSnapshotStore(
      store,
      () => snapshot,
      (next) => (snapshot = next)
    ),
    now: () => new Date('2026-07-14T00:00:00.000Z')
  })
  const logs: HttpLogEntry[] = []
  const handle = createPhase1HttpHandler({
    auth,
    snapshotSync,
    bindingTickets: new BindingTicketService({
      now: () => Date.parse('2026-07-14T00:00:00.000Z')
    }),
    rateLimit: { max: rateLimit, windowMs: 60_000 },
    log: (entry) => logs.push(entry)
  })
  return { auth, handle, logs }
}

function createSnapshotStore(
  store: Phase1Store,
  getSnapshot: () => StoredSyncV2Snapshot | undefined,
  setSnapshot: (snapshot: StoredSyncV2Snapshot) => void
) {
  return {
    getDevice: (id: string) => store.getDevice(id),
    getSyncV2Snapshot: () => getSnapshot(),
    compareAndSwapSyncV2Snapshot(input: {
      expectedRevision: number
      snapshot: StoredSyncV2Snapshot['snapshot']
      updatedAt: string
    }) {
      if ((getSnapshot()?.revision ?? 0) !== input.expectedRevision) return undefined
      const next = {
        revision: input.expectedRevision + 1,
        snapshot: input.snapshot,
        updatedAt: input.updatedAt
      }
      setSnapshot(next)
      return next
    }
  }
}

async function sessionFixture(rateLimit = 120) {
  const fixture = createFixture(rateLimit)
  const user = await fixture.auth.registerUser({ email: 'http-v2@example.com', password: 'pw' })
  const device = await fixture.auth.registerDevice({ userId: user.id, deviceName: 'desktop' })
  const session = await fixture.auth.login({
    email: user.email,
    password: 'pw',
    deviceId: device.id
  })
  return {
    ...fixture,
    device,
    headers: { authorization: `Bearer ${session.accessToken}` }
  }
}

function postJson(
  handle: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  headers?: HeadersInit
) {
  return handle(
    new Request(`https://sync.local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    })
  )
}

describe('Sync V2 HTTP handler', () => {
  it('binds a new desktop device with a single-use browser ticket', async () => {
    const { auth, handle, headers } = await sessionFixture()
    const issued = await postJson(handle, '/v1/auth/binding-ticket', {}, headers)
    expect(issued.status).toBe(201)
    const { ticket } = (await issued.json()) as { ticket: string }

    const bound = await postJson(handle, '/v1/auth/bind', {
      ticket,
      deviceName: 'Bound Laptop',
      platform: 'win32',
      appVersion: '1.0.3'
    })
    expect(bound.status).toBe(201)
    const session = (await bound.json()) as { accessToken: string; deviceId: string }
    await expect(
      auth.verifyAccessToken(session.accessToken, session.deviceId)
    ).resolves.toMatchObject({
      deviceId: session.deviceId
    })

    const replayed = await postJson(handle, '/v1/auth/bind', {
      ticket,
      deviceName: 'Replay',
      platform: 'win32',
      appVersion: '1.0.3'
    })
    expect(replayed.status).toBe(401)
  })

  it('exchanges a snapshot and reports revision-based status without payloads', async () => {
    const { handle, device, headers } = await sessionFixture()
    const exchanged = await postJson(
      handle,
      '/v1/sync/exchange',
      {
        protocolVersion: 2,
        deviceId: device.id,
        baseRevision: 0,
        strategy: 'merge',
        snapshot: {
          settings: { refresh_interval_min: 15 },
          pricing: [],
          balances: []
        }
      },
      headers
    )
    expect(exchanged.status).toBe(200)
    await expect(exchanged.json()).resolves.toMatchObject({ revision: 1, changed: true })

    const status = await handle(new Request('https://sync.local/v1/sync/status', { headers }))
    const body = (await status.json()) as Record<string, unknown>
    expect(body).toMatchObject({ revision: 1, total: 1, byType: { setting: 1 } })
    expect(JSON.stringify(body)).not.toContain('refresh_interval_min')
  })

  it('rejects credential-shaped settings without logging their values', async () => {
    const { handle, device, headers, logs } = await sessionFixture()
    const response = await postJson(
      handle,
      '/v1/sync/exchange',
      {
        protocolVersion: 2,
        deviceId: device.id,
        baseRevision: 0,
        strategy: 'merge',
        snapshot: { settings: { access_token: 'never-log-me' }, pricing: [], balances: [] }
      },
      headers
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).not.toContain('never-log-me')
    expect(JSON.stringify(logs)).not.toContain('never-log-me')
  })

  it('requires a supported protocol and authenticated active device', async () => {
    const { handle, device, headers } = await sessionFixture()
    const body = {
      protocolVersion: 1,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'merge',
      snapshot: { settings: {}, pricing: [], balances: [] }
    }
    expect((await postJson(handle, '/v1/sync/exchange', body, headers)).status).toBe(400)
    expect(
      (await postJson(handle, '/v1/sync/exchange', { ...body, protocolVersion: 2 })).status
    ).toBe(401)
  })

  it('rate-limits exchange requests and returns Retry-After', async () => {
    const { handle, device } = await sessionFixture(1)
    const body = {
      protocolVersion: 2,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'merge',
      snapshot: { settings: {}, pricing: [], balances: [] }
    }
    expect((await postJson(handle, '/v1/sync/exchange', body)).status).toBe(401)
    const limited = await postJson(handle, '/v1/sync/exchange', body)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })

  it('rejects oversized exchange bodies before parsing entity data', async () => {
    const { handle } = createFixture()
    const response = await postJson(handle, '/v1/sync/exchange', {
      protocolVersion: 2,
      padding: 'x'.repeat(2 * 1024 * 1024)
    })
    expect(response.status).toBe(413)
  })

  it('keeps authentication and device revocation while removing V1 routes', async () => {
    const { handle, device, headers } = await sessionFixture()
    await expect(
      handle(new Request('https://sync.local/v1/devices', { headers })).then((r) => r.json())
    ).resolves.toEqual([expect.objectContaining({ id: device.id })])
    const revoked = await handle(
      new Request(`https://sync.local/v1/devices/${device.id}`, {
        method: 'DELETE',
        headers
      })
    )
    expect(revoked.status).toBe(200)
    expect((await handle(new Request('https://sync.local/v1/devices', { headers }))).status).toBe(
      401
    )

    for (const path of [
      '/v1/sync/push',
      '/v1/sync/pull',
      '/v1/sync/ack',
      '/v1/sync/bootstrap',
      '/v1/sync/events',
      '/v1/sync/conflicts'
    ]) {
      const response = await handle(new Request(`https://sync.local${path}`, { headers }))
      expect(response.status, path).toBe(404)
    }
  })
})

describe('Console HTTP assets', () => {
  it('serves the console HTML with strict browser security headers', async () => {
    const { handle } = createFixture()
    const response = await handle(new Request('https://sync.local/console'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')

    const csp = response.headers.get('content-security-policy')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(await response.text()).toContain('<title>MoonMeter 控制台</title>')
  })

  it('serves the MoonMeter icon as a cacheable PNG without content sniffing', async () => {
    const { handle } = createFixture()
    const response = await handle(new Request('https://sync.local/console/moonmeter-icon.png'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')

    const signature = new Uint8Array(await response.arrayBuffer()).slice(0, 8)
    expect([...signature]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })
})
