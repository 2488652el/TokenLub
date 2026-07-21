import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: {
    baseUrl: 'https://sync.example',
    deviceId: 'device-1',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: '2026-07-13T00:00:00.000Z',
    mode: 'merge' as const
  },
  client: {
    listDevices: vi.fn(),
    revokeDevice: vi.fn()
  },
  scheduler: { trigger: vi.fn(), dispose: vi.fn() },
  runSyncV2Once: vi.fn(),
  saveSyncSession: vi.fn(),
  clearSyncSession: vi.fn(),
  loadSyncSession: vi.fn(),
  getSyncV2Revision: vi.fn(),
  loginSyncSession: vi.fn()
}))

vi.mock('../../../../code/src/main/store/sync-session', () => ({
  saveSyncSession: state.saveSyncSession,
  loadSyncSession: state.loadSyncSession,
  clearSyncSession: state.clearSyncSession
}))
vi.mock('../../../../code/src/main/store/sync-v2-repo', () => ({
  getSyncV2Revision: state.getSyncV2Revision,
  getSyncV2Preview: vi.fn()
}))
vi.mock('../../../../code/src/main/sync/client', () => ({
  createSyncClient: vi.fn(() => state.client),
  loginSyncSession: state.loginSyncSession
}))
vi.mock('../../../../code/src/main/sync/runner-v2', () => ({ runSyncV2Once: state.runSyncV2Once }))
vi.mock('../../../../code/src/main/sync/scheduler', () => ({
  createSyncScheduler: vi.fn((run: () => Promise<void>) => ({
    trigger: () => state.scheduler.trigger(run),
    dispose: state.scheduler.dispose
  }))
}))

describe('sync service', () => {
  beforeEach(() => {
    vi.resetModules()
    state.loadSyncSession.mockReset()
    state.saveSyncSession.mockReset()
    state.clearSyncSession.mockReset()
    state.getSyncV2Revision.mockReturnValue(0)
    state.runSyncV2Once.mockReset().mockResolvedValue({
      revision: 1,
      serverTime: '2026-07-14T00:00:00.000Z',
      changed: true
    })
    state.scheduler.trigger.mockReset().mockResolvedValue(undefined)
    state.scheduler.dispose.mockReset()
    state.loginSyncSession.mockReset()
  })

  it('initializes from encrypted session and exposes status without tokens', async () => {
    state.loadSyncSession.mockReturnValue(state.session)
    const service = await import('../../../../code/src/main/sync/service')

    service.initializeSync()

    expect(service.getSyncStatus()).toEqual({
      configured: true,
      state: 'idle',
      revision: 0,
      mode: 'merge'
    })
    expect(JSON.stringify(service.getSyncStatus())).not.toContain('access-1')
    expect(JSON.stringify(service.getSyncStatus())).not.toContain('refresh-1')
  })

  it('keeps the app usable when local sync credentials cannot be decrypted', async () => {
    state.loadSyncSession.mockImplementation(() => {
      throw new Error('Error while decrypting ciphertext secret-value')
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const service = await import('../../../../code/src/main/sync/service')

    expect(() => service.initializeSync()).not.toThrow()
    expect(service.getSyncStatus()).toEqual({
      configured: false,
      state: 'needs_login',
      revision: 0,
      lastError: 'Local sync credentials could not be restored; sign in again'
    })
    expect(JSON.stringify(service.getSyncStatus())).not.toContain('secret-value')
    expect(warning).toHaveBeenCalledWith('[sync] local credentials could not be restored')
    warning.mockRestore()
  })

  it('uses only the single-exchange V2 runner', async () => {
    state.loadSyncSession.mockReturnValue(state.session)
    state.scheduler.trigger.mockImplementationOnce(async (run: () => Promise<void>) => run())
    const service = await import('../../../../code/src/main/sync/service')
    service.initializeSync()

    await service.syncNow()
    expect(state.runSyncV2Once).toHaveBeenCalledWith(state.client, 'merge', expect.any(Function))
  })

  it('uses upload or restore only once, then persists merge mode', async () => {
    state.loadSyncSession.mockReturnValue({ ...state.session, mode: 'upload' })
    state.scheduler.trigger.mockImplementationOnce(async (run: () => Promise<void>) => run())
    const service = await import('../../../../code/src/main/sync/service')
    service.initializeSync()

    await service.syncNow()

    expect(state.runSyncV2Once).toHaveBeenCalledWith(state.client, 'upload', expect.any(Function))
    expect(state.saveSyncSession).toHaveBeenCalledWith({ ...state.session, mode: 'merge' })
    expect(service.getSyncStatus()).toMatchObject({ mode: 'merge', revision: 0 })
  })

  it('triggers the single-flight scheduler and reports safe errors', async () => {
    state.loadSyncSession.mockReturnValue(state.session)
    const service = await import('../../../../code/src/main/sync/service')
    service.initializeSync()
    state.scheduler.trigger.mockRejectedValue(new Error('sync authentication failed'))

    await expect(service.syncNow()).rejects.toThrow('sync authentication failed')
    expect(service.getSyncStatus()).toMatchObject({ state: 'needs_login' })
  })

  it('debounces local changes and keeps a periodic fallback', async () => {
    vi.useFakeTimers()
    try {
      state.loadSyncSession.mockReturnValue(state.session)
      const service = await import('../../../../code/src/main/sync/service')
      service.initializeSync()
      state.scheduler.trigger.mockClear()

      service.scheduleSyncAfterChange()
      service.scheduleSyncAfterChange()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(state.scheduler.trigger).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(30 * 60_000)
      expect(state.scheduler.trigger).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs in, stores the session, and returns only non-sensitive fields', async () => {
    state.loginSyncSession.mockResolvedValue(state.session)
    const service = await import('../../../../code/src/main/sync/service')

    await expect(
      service.loginSync({
        baseUrl: state.session.baseUrl,
        email: 'a@example.com',
        password: 'password',
        deviceId: state.session.deviceId
      })
    ).resolves.toEqual({ deviceId: 'device-1', expiresAt: state.session.expiresAt })
    expect(state.saveSyncSession).toHaveBeenCalledWith(state.session)
    expect(
      JSON.stringify(
        await service.loginSync({
          baseUrl: state.session.baseUrl,
          email: 'a@example.com',
          password: 'password',
          deviceId: state.session.deviceId
        })
      )
    ).not.toContain('access-1')
  })

  it('lists devices and clears local credentials when the current device is revoked', async () => {
    state.loadSyncSession.mockReturnValue(state.session)
    state.client.listDevices.mockResolvedValue([{ id: 'device-1', name: 'Laptop' }])
    state.client.revokeDevice.mockResolvedValue({ ok: true })
    const service = await import('../../../../code/src/main/sync/service')
    service.initializeSync()

    await expect(service.listSyncDevices()).resolves.toEqual([{ id: 'device-1', name: 'Laptop' }])
    await service.revokeSyncDevice('device-1')

    expect(state.client.revokeDevice).toHaveBeenCalledWith('device-1')
    expect(state.clearSyncSession).toHaveBeenCalledTimes(1)
    expect(service.getSyncStatus()).toMatchObject({ configured: false, state: 'idle' })
  })
})
