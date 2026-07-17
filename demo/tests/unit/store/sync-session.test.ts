import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  row: undefined as
    | {
        base_url: string
        device_id: string
        access_token: Buffer
        refresh_token: Buffer
        expires_at: string
        mode?: 'upload' | 'restore' | 'merge'
      }
    | undefined,
  db: undefined as unknown as ReturnType<typeof makeDb>
}))

function makeDb() {
  return {
    prepare(sql: string) {
      return {
        get: () => state.row,
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO sync_session')) {
            state.row = {
              base_url: String(args[0]),
              device_id: String(args[1]),
              access_token: args[2] as Buffer,
              refresh_token: args[3] as Buffer,
              expires_at: String(args[4]),
              mode: String(args[5]) as 'upload' | 'restore' | 'merge'
            }
          } else if (sql.includes('DELETE FROM sync_session')) {
            state.row = undefined
          }
          return { changes: 1 }
        }
      }
    }
  }
}

vi.mock('../../../../code/src/main/store/db', () => ({ getDb: () => state.db }))
vi.mock('../../../../code/src/main/crypto/safe-storage', () => ({
  encryptSecret: (value: string) => Buffer.from(value.split('').reverse().join('')),
  decryptSecret: (value: Buffer) => value.toString().split('').reverse().join('')
}))

describe('sync session store', () => {
  beforeEach(() => {
    state.row = undefined
    state.db = makeDb()
  })

  it('stores tokens encrypted and restores the session without exposing plaintext', async () => {
    const store = await import('../../../../code/src/main/store/sync-session')
    const session = {
      baseUrl: 'https://sync.example',
      deviceId: 'device-1',
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      expiresAt: '2026-07-13T00:00:00.000Z',
      mode: 'merge' as const
    }

    store.saveSyncSession(session)

    expect(state.row?.access_token.toString()).not.toContain(session.accessToken)
    expect(state.row?.refresh_token.toString()).not.toContain(session.refreshToken)
    expect(store.loadSyncSession()).toEqual(session)
  })

  it('clears the local session', async () => {
    const store = await import('../../../../code/src/main/store/sync-session')
    store.saveSyncSession({
      baseUrl: 'https://sync.example',
      deviceId: 'device-1',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: '2026-07-13T00:00:00.000Z',
      mode: 'merge'
    })

    store.clearSyncSession()

    expect(store.loadSyncSession()).toBeNull()
  })
})
