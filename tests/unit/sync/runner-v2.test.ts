import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  revision: 4,
  snapshot: {
    settings: { refresh_interval_min: 15 },
    pricing: [],
    balances: []
  },
  dirty: false,
  generation: 3,
  base: { settings: {}, pricing: [], balances: [] },
  apply: vi.fn()
}))

vi.mock('../../../src/main/store/sync-v2-repo', () => ({
  getSyncV2Revision: () => state.revision,
  createSyncV2Snapshot: () => state.snapshot,
  getSyncV2BaseSnapshot: () => state.base,
  hasValidSyncV2BaseSnapshot: () => true,
  isSyncV2Dirty: () => state.dirty,
  getSyncV2MutationGeneration: () => state.generation,
  applySyncV2Snapshot: state.apply
}))

describe('Sync V2 runner', () => {
  beforeEach(() => {
    state.dirty = false
    state.base = { settings: {}, pricing: [], balances: [] }
    state.apply.mockReset()
  })

  it('uses exactly one exchange and applies the returned snapshot transactionally', async () => {
    const exchange = vi.fn().mockResolvedValue({
      revision: 5,
      serverTime: '2026-07-14T00:00:00.000Z',
      snapshot: state.snapshot,
      changed: true,
      accepted: true
    })
    const { runSyncV2Once } = await import('../../../src/main/sync/runner-v2')
    const result = await runSyncV2Once(
      {
        exchange,
        listDevices: vi.fn(),
        revokeDevice: vi.fn()
      },
      'merge'
    )

    expect(exchange).toHaveBeenCalledOnce()
    expect(exchange).toHaveBeenCalledWith({
      baseRevision: 4,
      strategy: 'merge',
      snapshot: state.snapshot
    })
    expect(state.apply).toHaveBeenCalledWith(
      state.snapshot,
      5,
      '2026-07-14T00:00:00.000Z',
      3,
      false
    )
    expect(result).toEqual({
      revision: 5,
      serverTime: '2026-07-14T00:00:00.000Z',
      changed: true
    })
  })

  it('rebases a dirty snapshot once when the server revision is newer', async () => {
    state.dirty = true
    const remote = {
      settings: { session_auto_parse_enabled: true },
      pricing: [],
      balances: []
    }
    const merged = {
      settings: { session_auto_parse_enabled: true, refresh_interval_min: 15 },
      pricing: [],
      balances: []
    }
    const exchange = vi
      .fn()
      .mockResolvedValueOnce({
        revision: 6,
        serverTime: '2026-07-14T00:00:00.000Z',
        snapshot: remote,
        changed: false,
        accepted: false
      })
      .mockResolvedValueOnce({
        revision: 7,
        serverTime: '2026-07-14T00:00:01.000Z',
        snapshot: merged,
        changed: true,
        accepted: true
      })
    const { runSyncV2Once } = await import('../../../src/main/sync/runner-v2')

    await runSyncV2Once({ exchange, listDevices: vi.fn(), revokeDevice: vi.fn() }, 'merge')

    expect(exchange).toHaveBeenNthCalledWith(2, {
      baseRevision: 6,
      strategy: 'merge',
      snapshot: merged
    })
    expect(state.apply).toHaveBeenCalledWith(merged, 7, '2026-07-14T00:00:01.000Z', 3, false)
  })

  it('does not apply a response after the session has been replaced', async () => {
    const exchange = vi.fn().mockResolvedValue({
      revision: 5,
      serverTime: '2026-07-14T00:00:00.000Z',
      snapshot: state.snapshot,
      changed: true,
      accepted: true
    })
    const { runSyncV2Once } = await import('../../../src/main/sync/runner-v2')

    await runSyncV2Once(
      { exchange, listDevices: vi.fn(), revokeDevice: vi.fn() },
      'merge',
      () => false
    )

    expect(state.apply).not.toHaveBeenCalled()
  })

  it('restores without uploading the potentially oversized local snapshot', async () => {
    const exchange = vi.fn().mockResolvedValue({
      revision: 5,
      serverTime: '2026-07-14T00:00:00.000Z',
      snapshot: state.snapshot,
      changed: false,
      accepted: false
    })
    const { runSyncV2Once } = await import('../../../src/main/sync/runner-v2')

    await runSyncV2Once({ exchange, listDevices: vi.fn(), revokeDevice: vi.fn() }, 'restore')

    expect(exchange).toHaveBeenCalledWith({
      baseRevision: 4,
      strategy: 'restore',
      snapshot: { settings: {}, pricing: [], balances: [] }
    })
  })
})
