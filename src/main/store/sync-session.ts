import { decryptSecret, encryptSecret } from '../crypto/safe-storage'
import { getDb } from './db'
import type { SyncMode } from '../../shared/sync-mode'

export type SyncSession = {
  baseUrl: string
  deviceId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
  mode: SyncMode
}

type SessionRow = {
  base_url: string
  device_id: string
  access_token: Buffer
  refresh_token: Buffer
  expires_at: string
  mode?: SyncMode
}

export function saveSyncSession(session: SyncSession): void {
  getDb()
    .prepare(
      `
      INSERT INTO sync_session (
        id, base_url, device_id, access_token, refresh_token, expires_at, mode, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        base_url = excluded.base_url,
        device_id = excluded.device_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        mode = excluded.mode,
        updated_at = excluded.updated_at
    `
    )
    .run(
      session.baseUrl,
      session.deviceId,
      encryptSecret(session.accessToken),
      encryptSecret(session.refreshToken),
      session.expiresAt,
      session.mode,
      new Date().toISOString()
    )
}

export function loadSyncSession(): SyncSession | null {
  const row = getDb().prepare('SELECT * FROM sync_session WHERE id = 1').get() as
    SessionRow | undefined
  if (!row) return null
  return {
    baseUrl: row.base_url,
    deviceId: row.device_id,
    accessToken: decryptSecret(row.access_token),
    refreshToken: decryptSecret(row.refresh_token),
    expiresAt: row.expires_at,
    mode: row.mode ?? 'merge'
  }
}

export function clearSyncSession(): void {
  getDb().prepare('DELETE FROM sync_session WHERE id = 1').run()
}
