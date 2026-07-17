import { describe, expect, it } from 'vitest'
import type { Phase1Device } from '../../../../drive/src/server/phase1'
import {
  normalizeSnapshot,
  SnapshotSyncService,
  type SnapshotSyncStore,
  type StoredSyncV2Snapshot
} from '../../../../drive/src/server/snapshot-sync'
import { rebaseSyncV2Snapshot, type SyncV2Snapshot } from '../../../../code/src/shared/sync-v2'
import { MAX_SYNC_V2_BALANCES } from '../../../../code/src/shared/sync-v2'

const device: Phase1Device = {
  id: 'device-1',
  userId: 'user-1',
  name: 'Laptop',
  platform: 'win32',
  appVersion: '1.0.0',
  createdAt: '2026-07-14T00:00:00.000Z',
  lastSeenAt: null,
  revokedAt: null
}

const local: SyncV2Snapshot = {
  settings: { refresh_interval_min: 15 },
  pricing: [
    {
      providerId: 'openai',
      model: 'gpt-test',
      currency: 'USD',
      promptPricePerMtok: 1,
      completionPricePerMtok: 2,
      source: 'user'
    }
  ],
  balances: [
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      providerId: 'openai',
      capturedAt: '2026-07-14T00:00:00.000Z',
      remaining: 10,
      currency: 'USD'
    }
  ]
}

function createStore(initial?: StoredSyncV2Snapshot) {
  let stored = initial
  let failCas = 0
  const store: SnapshotSyncStore = {
    getDevice: (id) => (id === device.id ? device : undefined),
    getSyncV2Snapshot: () => stored,
    compareAndSwapSyncV2Snapshot: (input) => {
      if (failCas-- > 0) return undefined
      if ((stored?.revision ?? 0) !== input.expectedRevision) return undefined
      stored = {
        revision: input.expectedRevision + 1,
        snapshot: input.snapshot,
        updatedAt: input.updatedAt
      }
      return stored
    }
  }
  return {
    store,
    get stored() {
      return stored
    },
    failNextCas() {
      failCas++
    }
  }
}

function service(store: SnapshotSyncStore) {
  return new SnapshotSyncService({
    store,
    now: () => new Date('2026-07-14T01:00:00.000Z')
  })
}

describe('snapshot sync v2', () => {
  it('normalizes legacy scope defaults and keeps regional prices as distinct identities', () => {
    const snapshot = normalizeSnapshot({
      settings: {},
      pricing: [
        local.pricing[0]!,
        { ...local.pricing[0]!, billingScope: ' Global ', promptPricePerMtok: 3 },
        { ...local.pricing[0]!, billingScope: 'cn', promptPricePerMtok: 4 }
      ],
      balances: []
    })

    expect(snapshot.pricing).toHaveLength(3)
    expect(snapshot.pricing.map((entry) => entry.billingScope)).toEqual(['default', 'global', 'cn'])
    expect(snapshot.pricing.every((entry) => entry.catalogActive === true)).toBe(true)
  })

  it('rebases only fields changed locally since the clean baseline', () => {
    const base = local
    const remote: SyncV2Snapshot = {
      ...local,
      pricing: [{ ...local.pricing[0]!, promptPricePerMtok: 99 }]
    }
    const changedLocal: SyncV2Snapshot = {
      ...local,
      settings: { refresh_interval_min: 20 }
    }

    expect(rebaseSyncV2Snapshot(base, remote, changedLocal)).toEqual({
      ...remote,
      settings: { refresh_interval_min: 20 }
    })
  })

  it('creates revision one from the first local snapshot', async () => {
    const state = createStore()
    const result = await service(state.store).exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'merge',
      snapshot: local
    })

    expect(result).toMatchObject({ revision: 1, changed: true, accepted: true, snapshot: local })
  })

  it('propagates pricing deletions when the client revision is current', async () => {
    const state = createStore({
      revision: 2,
      snapshot: local,
      updatedAt: '2026-07-14T00:30:00.000Z'
    })

    const result = await service(state.store).exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 2,
      strategy: 'merge',
      snapshot: { ...local, pricing: [] }
    })

    expect(result).toMatchObject({ revision: 3, accepted: true, changed: true })
    expect(result.snapshot.pricing).toEqual([])
  })

  it('bounds merged balance history while retaining the newest entries', async () => {
    const balances = Array.from({ length: MAX_SYNC_V2_BALANCES + 1 }, (_, index) => ({
      id: `balance-${index}`,
      providerId: 'openai',
      capturedAt: new Date(Date.UTC(2026, 6, 14, 0, 0, index)).toISOString(),
      remaining: index
    }))
    const state = createStore()

    const result = await service(state.store).exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'merge',
      snapshot: { settings: {}, pricing: [], balances }
    })

    expect(result.snapshot.balances).toHaveLength(MAX_SYNC_V2_BALANCES)
    expect(result.snapshot.balances.some((entry) => entry.id === 'balance-0')).toBe(false)
  })

  it('restores the cloud snapshot without writing local data', async () => {
    const state = createStore({
      revision: 3,
      snapshot: local,
      updatedAt: '2026-07-14T00:30:00.000Z'
    })
    const result = await service(state.store).exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'restore',
      snapshot: { settings: {}, pricing: [], balances: [] }
    })

    expect(result).toMatchObject({ revision: 3, changed: false, accepted: false, snapshot: local })
    expect(state.stored?.revision).toBe(3)
  })

  it('returns the current snapshot without writing when the client revision is stale', async () => {
    const state = createStore({
      revision: 2,
      snapshot: {
        settings: { refresh_interval_min: 30, session_auto_parse_enabled: true },
        pricing: [],
        balances: [local.balances[0]!]
      },
      updatedAt: '2026-07-14T00:30:00.000Z'
    })
    const result = await service(state.store).exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 1,
      strategy: 'merge',
      snapshot: local
    })

    expect(result).toMatchObject({ revision: 2, changed: false, accepted: false })
    expect(result.snapshot.settings).toEqual({
      refresh_interval_min: 30,
      session_auto_parse_enabled: true
    })
    expect(result.snapshot.balances).toHaveLength(1)
    expect(state.stored?.revision).toBe(2)
  })

  it('retries an optimistic write collision', async () => {
    const state = createStore()
    state.failNextCas()
    const result = await service(state.store).exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'upload',
      snapshot: local
    })

    expect(result.revision).toBe(1)
  })

  it('does not oscillate when two devices exchange interleaved revisions', async () => {
    const state = createStore()
    const sync = service(state.store)
    const first = await sync.exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'merge',
      snapshot: { ...local, settings: { refresh_interval_min: 17 } }
    })
    const stale = await sync.exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: 0,
      strategy: 'merge',
      snapshot: { ...local, settings: { refresh_interval_min: 16 } }
    })
    const second = await sync.exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: stale.revision,
      strategy: 'merge',
      snapshot: { ...stale.snapshot, settings: { refresh_interval_min: 18 } }
    })
    const oldFirst = await sync.exchange({
      userId: device.userId,
      deviceId: device.id,
      baseRevision: first.revision,
      strategy: 'merge',
      snapshot: first.snapshot
    })

    expect(stale).toMatchObject({ revision: 1, accepted: false, changed: false })
    expect(second).toMatchObject({ revision: 2, accepted: true, changed: true })
    expect(oldFirst).toMatchObject({ revision: 2, accepted: false, changed: false })
    expect(oldFirst.snapshot.settings).toEqual({ refresh_interval_min: 18 })
    expect(state.stored?.revision).toBe(2)
  })

  it('rejects revoked devices and sensitive settings', async () => {
    const state = createStore()
    await expect(
      service({
        ...state.store,
        getDevice: () => ({ ...device, revokedAt: '2026-07-14' })
      }).exchange({
        userId: device.userId,
        deviceId: device.id,
        baseRevision: 0,
        strategy: 'merge',
        snapshot: local
      })
    ).rejects.toThrow('device revoked')

    await expect(
      service(state.store).exchange({
        userId: device.userId,
        deviceId: device.id,
        baseRevision: 0,
        strategy: 'merge',
        snapshot: { ...local, settings: { api_token: 'must-not-leave-device' } }
      })
    ).rejects.toThrow('sensitive setting')
  })
})
