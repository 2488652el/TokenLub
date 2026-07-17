import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSyncClient, type SyncClient } from '../../../code/src/main/sync/client'
import { createPhase1HttpHandler } from '../../../drive/src/server/http'
import { createInMemoryPhase1Store, Phase1AuthService } from '../../../drive/src/server/phase1'
import { createPhase1NodeServer } from '../../../drive/src/server/runtime'
import {
  SnapshotSyncService,
  type StoredSyncV2Snapshot
} from '../../../drive/src/server/snapshot-sync'

describe('Sync V2 HTTP two-device integration', () => {
  let server: Server
  let clientA: SyncClient
  let clientB: SyncClient

  beforeAll(async () => {
    const store = createInMemoryPhase1Store()
    const auth = new Phase1AuthService({ store })
    let stored: StoredSyncV2Snapshot | undefined
    const snapshotSync = new SnapshotSyncService({
      store: {
        getDevice: (id) => store.getDevice(id),
        getSyncV2Snapshot: () => stored,
        compareAndSwapSyncV2Snapshot: (input) => {
          if ((stored?.revision ?? 0) !== input.expectedRevision) return undefined
          stored = {
            revision: input.expectedRevision + 1,
            snapshot: input.snapshot,
            updatedAt: input.updatedAt
          }
          return stored
        }
      }
    })
    const user = await auth.registerUser({ email: 'v2-e2e@example.com', password: 'password' })
    const deviceA = await auth.registerDevice({ userId: user.id, deviceName: 'A' })
    const deviceB = await auth.registerDevice({ userId: user.id, deviceName: 'B' })
    const sessionA = await auth.login({
      email: user.email,
      password: 'password',
      deviceId: deviceA.id
    })
    const sessionB = await auth.login({
      email: user.email,
      password: 'password',
      deviceId: deviceB.id
    })
    const handle = createPhase1HttpHandler({ auth, snapshotSync })
    server = createPhase1NodeServer({ handle })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('expected TCP server address')
    const baseUrl = `http://127.0.0.1:${address.port}`
    clientA = createSyncClient({ baseUrl, deviceId: deviceA.id, ...sessionA })
    clientB = createSyncClient({ baseUrl, deviceId: deviceB.id, ...sessionB })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  })

  it('converges two devices through exchange without push, pull, ack, or SSE', async () => {
    const fromA = await clientA.exchange!({
      baseRevision: 0,
      strategy: 'merge',
      snapshot: {
        settings: { refresh_interval_min: 30 },
        pricing: [],
        balances: []
      }
    })
    expect(fromA).toMatchObject({ revision: 1, changed: true, accepted: true })

    const restoredByB = await clientB.exchange!({
      baseRevision: 0,
      strategy: 'restore',
      snapshot: { settings: {}, pricing: [], balances: [] }
    })
    expect(restoredByB).toMatchObject({
      revision: 1,
      changed: false,
      accepted: false,
      snapshot: { settings: { refresh_interval_min: 30 } }
    })

    const fromB = await clientB.exchange!({
      baseRevision: 1,
      strategy: 'merge',
      snapshot: {
        ...restoredByB.snapshot,
        settings: {
          ...restoredByB.snapshot.settings,
          session_auto_parse_enabled: true
        }
      }
    })
    expect(fromB.revision).toBe(2)

    const convergedA = await clientA.exchange!({
      baseRevision: 1,
      strategy: 'restore',
      snapshot: fromA.snapshot
    })
    expect(convergedA).toMatchObject({
      revision: 2,
      snapshot: {
        settings: { refresh_interval_min: 30, session_auto_parse_enabled: true }
      }
    })
  })
})
