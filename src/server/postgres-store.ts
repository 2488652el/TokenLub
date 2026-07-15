import { randomUUID } from 'node:crypto'
import type {
  AuditEventRecord,
  AuditEventInput,
  ControlEventInput,
  Phase1Device,
  Phase1RefreshSession,
  Phase1Store,
  Phase1User
} from './phase1'
import type { DataControlStore, DataTask } from './data-control'
import type { SnapshotSyncStore, StoredSyncV2Snapshot } from './snapshot-sync'
import type { SyncV2Snapshot } from '../shared/sync-v2'

export type PostgresQueryClient = {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

type TransactionClient = PostgresQueryClient & { release(): void }
type PostgresPoolClient = PostgresQueryClient & { connect(): Promise<TransactionClient> }

type Options = {
  id?: () => string
}

export class PostgresPhase1Store implements Phase1Store, DataControlStore, SnapshotSyncStore {
  private readonly client: PostgresQueryClient
  private readonly pool: PostgresPoolClient | null
  private readonly id: () => string

  constructor(client: PostgresQueryClient | PostgresPoolClient, options: Options = {}) {
    this.client = client
    this.pool = 'connect' in client ? client : null
    this.id = options.id ?? randomUUID
  }

  async createUser(input: {
    email: string
    passwordHash: string
    createdAt: string
  }): Promise<Phase1User> {
    const result = await this.client.query(
      `
        INSERT INTO users (id, email, password_hash, created_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, password_hash, created_at, email_verified_at
      `,
      [this.id(), input.email, input.passwordHash, input.createdAt]
    )
    return readUser(result.rows[0])
  }

  async getUserByEmail(email: string): Promise<Phase1User | undefined> {
    const result = await this.client.query(
      `
        SELECT id, email, password_hash, created_at, email_verified_at
        FROM users
        WHERE email = $1
      `,
      [email]
    )
    return result.rows[0] ? readUser(result.rows[0]) : undefined
  }

  async getUserById(id: string): Promise<Phase1User | undefined> {
    const result = await this.client.query(
      `
        SELECT id, email, password_hash, created_at, email_verified_at
        FROM users
        WHERE id = $1
      `,
      [id]
    )
    return result.rows[0] ? readUser(result.rows[0]) : undefined
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id`,
      [userId, passwordHash]
    )
    return result.rows.length > 0
  }

  async createEmailVerificationToken(input: {
    userId: string
    tokenHash: string
    expiresAt: string
  }): Promise<void> {
    await this.client.query(
      `
        INSERT INTO email_verification_tokens
          (id, user_id, token_hash, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [this.id(), input.userId, input.tokenHash, input.expiresAt, new Date().toISOString()]
    )
  }

  async consumeEmailVerificationToken(
    tokenHash: string,
    consumedAt: string
  ): Promise<string | undefined> {
    const result = await this.client.query(
      `
        UPDATE email_verification_tokens
        SET consumed_at = $2
        WHERE token_hash = $1
          AND consumed_at IS NULL
          AND expires_at > $2
        RETURNING user_id
      `,
      [tokenHash, consumedAt]
    )
    return result.rows[0]?.user_id ? readString(result.rows[0].user_id) : undefined
  }

  async markUserEmailVerified(userId: string, verifiedAt: string): Promise<Phase1User | undefined> {
    const result = await this.client.query(
      `
        UPDATE users
        SET email_verified_at = $2
        WHERE id = $1
        RETURNING id, email, password_hash, created_at, email_verified_at
      `,
      [userId, verifiedAt]
    )
    return result.rows[0] ? readUser(result.rows[0]) : undefined
  }

  async createDevice(input: {
    userId: string
    name: string
    platform?: string
    appVersion?: string
    createdAt: string
  }): Promise<Phase1Device> {
    const result = await this.client.query(
      `
        INSERT INTO devices (id, user_id, name, platform, app_version, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id, name, platform, app_version, created_at, last_seen_at, revoked_at
      `,
      [
        this.id(),
        input.userId,
        input.name,
        input.platform ?? 'desktop',
        input.appVersion ?? 'unknown',
        input.createdAt
      ]
    )
    return readDevice(result.rows[0])
  }

  async getDevice(id: string): Promise<Phase1Device | undefined> {
    const result = await this.client.query(
      `
        SELECT d.id, d.user_id, d.name, d.platform, d.app_version, d.created_at,
          d.last_seen_at, d.revoked_at
        FROM devices d
        WHERE d.id = $1
      `,
      [id]
    )
    return result.rows[0] ? readDevice(result.rows[0]) : undefined
  }

  async listDevices(userId: string): Promise<Phase1Device[]> {
    const result = await this.client.query(
      `
        SELECT d.id, d.user_id, d.name, d.platform, d.app_version, d.created_at,
          d.last_seen_at, d.revoked_at
        FROM devices d
        WHERE d.user_id = $1
        ORDER BY d.created_at, d.id
      `,
      [userId]
    )
    return result.rows.map(readDevice)
  }

  async updateDeviceName(
    userId: string,
    deviceId: string,
    name: string
  ): Promise<Phase1Device | undefined> {
    const result = await this.client.query(
      `
        UPDATE devices
        SET name = $3
        WHERE user_id = $1 AND id = $2
        RETURNING id, user_id, name, platform, app_version, created_at, last_seen_at, revoked_at
      `,
      [userId, deviceId, name]
    )
    if (!result.rows[0]) return undefined
    return readDevice(result.rows[0])
  }

  async touchDevice(deviceId: string, lastSeenAt: string): Promise<void> {
    await this.client.query('UPDATE devices SET last_seen_at = $1 WHERE id = $2', [
      lastSeenAt,
      deviceId
    ])
  }

  async revokeDevice(userId: string, deviceId: string, revokedAt: string): Promise<void> {
    await this.client.query(
      `
        WITH revoked AS (
          UPDATE devices
          SET revoked_at = $3
          WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL
          RETURNING id
        )
        UPDATE refresh_sessions
        SET active = false, rotated_at = $3
        WHERE user_id = $1 AND device_id IN (SELECT id FROM revoked)
      `,
      [userId, deviceId, revokedAt]
    )
  }

  async createRefreshSession(input: {
    userId: string
    deviceId: string
    refreshTokenHash: string
    createdAt: string
  }): Promise<Phase1RefreshSession> {
    const result = await this.client.query(
      `
        INSERT INTO refresh_sessions (
          id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
        )
        VALUES ($1, $2, $3, $4, true, $5, NULL)
        RETURNING id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
      `,
      [this.id(), input.userId, input.deviceId, input.refreshTokenHash, input.createdAt]
    )
    return readRefreshSession(result.rows[0])
  }

  async getRefreshSessionByTokenHash(
    refreshTokenHash: string
  ): Promise<Phase1RefreshSession | undefined> {
    const result = await this.client.query(
      `
        SELECT id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
        FROM refresh_sessions
        WHERE refresh_token_hash = $1
      `,
      [refreshTokenHash]
    )
    return result.rows[0] ? readRefreshSession(result.rows[0]) : undefined
  }

  async getRefreshSessionById(id: string): Promise<Phase1RefreshSession | undefined> {
    const result = await this.client.query(
      `
        SELECT id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
        FROM refresh_sessions
        WHERE id = $1
      `,
      [id]
    )
    return result.rows[0] ? readRefreshSession(result.rows[0]) : undefined
  }

  async listRefreshSessions(userId: string): Promise<Phase1RefreshSession[]> {
    const result = await this.client.query(
      `
        SELECT id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
        FROM refresh_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [userId]
    )
    return result.rows.map(readRefreshSession)
  }

  async deactivateRefreshSession(id: string, rotatedAt: string): Promise<void> {
    await this.client.query(
      `
        UPDATE refresh_sessions
        SET active = false, rotated_at = $1
        WHERE id = $2
      `,
      [rotatedAt, id]
    )
  }

  async deactivateRefreshSessions(userId: string, rotatedAt: string): Promise<void> {
    await this.client.query(
      `
        UPDATE refresh_sessions
        SET active = false, rotated_at = $2
        WHERE user_id = $1 AND active = true
      `,
      [userId, rotatedAt]
    )
  }

  async rotateRefreshSession(input: {
    oldSessionId: string
    userId: string
    deviceId: string
    refreshTokenHash: string
    rotatedAt: string
    createdAt: string
  }): Promise<Phase1RefreshSession | undefined> {
    const result = await this.client.query(
      `
        WITH deactivated AS (
          UPDATE refresh_sessions
          SET active = false, rotated_at = $4
          WHERE id = $1 AND user_id = $2 AND device_id = $3 AND active = true
          RETURNING user_id, device_id
        ), inserted AS (
          INSERT INTO refresh_sessions (
            id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
          )
          SELECT $5, user_id, device_id, $6, true, $7, NULL
          FROM deactivated
          RETURNING id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
        )
        SELECT id, user_id, device_id, refresh_token_hash, active, created_at, rotated_at
        FROM inserted
      `,
      [
        input.oldSessionId,
        input.userId,
        input.deviceId,
        input.rotatedAt,
        this.id(),
        input.refreshTokenHash,
        input.createdAt
      ]
    )
    return result.rows[0] ? readRefreshSession(result.rows[0]) : undefined
  }

  async getSyncV2Snapshot(userId: string): Promise<StoredSyncV2Snapshot | undefined> {
    const result = await this.client.query(
      `
        SELECT revision, snapshot, updated_at
        FROM user_sync_snapshots
        WHERE user_id = $1
      `,
      [userId]
    )
    return result.rows[0] ? readSyncV2Snapshot(result.rows[0]) : undefined
  }

  async compareAndSwapSyncV2Snapshot(input: {
    userId: string
    expectedRevision: number
    snapshot: SyncV2Snapshot
    updatedAt: string
  }): Promise<StoredSyncV2Snapshot | undefined> {
    const result =
      input.expectedRevision === 0
        ? await this.client.query(
            `
              INSERT INTO user_sync_snapshots (user_id, revision, snapshot, updated_at)
              VALUES ($1, 1, $2::jsonb, $3)
              ON CONFLICT (user_id) DO NOTHING
              RETURNING revision, snapshot, updated_at
            `,
            [input.userId, JSON.stringify(input.snapshot), input.updatedAt]
          )
        : await this.client.query(
            `
              UPDATE user_sync_snapshots
              SET revision = revision + 1,
                  snapshot = $3::jsonb,
                  updated_at = $4
              WHERE user_id = $1 AND revision = $2
              RETURNING revision, snapshot, updated_at
            `,
            [input.userId, input.expectedRevision, JSON.stringify(input.snapshot), input.updatedAt]
          )
    return result.rows[0] ? readSyncV2Snapshot(result.rows[0]) : undefined
  }

  async getOperationalMetrics(): Promise<{
    databaseBytes: number
    syncChangesBytes: number
    queueBacklog: number
    clientVersions: Record<string, number>
  }> {
    const result = await this.client.query(`
      SELECT
        pg_database_size(current_database()) AS database_bytes,
        pg_total_relation_size('user_sync_snapshots') AS sync_changes_bytes,
        (SELECT COUNT(*) FROM data_tasks WHERE status IN ('pending', 'running')) AS queue_backlog,
        COALESCE((
          SELECT json_object_agg(app_version, version_count)
          FROM (
            SELECT app_version, COUNT(*) AS version_count
            FROM devices
            GROUP BY app_version
          ) versions
        ), '{}'::json) AS client_versions
    `)
    const row = result.rows[0] ?? {}
    return {
      databaseBytes: readNumber(row.database_bytes ?? 0),
      syncChangesBytes: readNumber(row.sync_changes_bytes ?? 0),
      queueBacklog: readNumber(row.queue_backlog ?? 0),
      clientVersions: readNumberMap(row.client_versions)
    }
  }

  async appendAuditEvent(event: AuditEventInput): Promise<void> {
    await this.client.query(
      `
        INSERT INTO audit_events (
          id, actor_type, actor_id, user_id, event_type, trace_id, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `,
      [
        this.id(),
        event.actorType,
        event.actorId ?? null,
        event.userId ?? null,
        event.eventType,
        event.traceId ?? null,
        JSON.stringify(event.metadata ?? {}),
        event.createdAt
      ]
    )
  }

  async listAuditEvents(limit: number): Promise<AuditEventRecord[]> {
    const result = await this.client.query(
      `
        SELECT id, actor_type, actor_id, user_id, event_type, trace_id, metadata, created_at
        FROM audit_events
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      `,
      [limit]
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      actorType: String(row.actor_type) as AuditEventRecord['actorType'],
      actorId: row.actor_id ? String(row.actor_id) : null,
      userId: row.user_id ? String(row.user_id) : null,
      eventType: String(row.event_type),
      traceId: row.trace_id ? String(row.trace_id) : null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: String(row.created_at)
    }))
  }

  async appendControlEvent(event: ControlEventInput): Promise<void> {
    await this.client.query(
      `
        INSERT INTO control_events (
          id, user_id, target_device_id, type, payload, created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        this.id(),
        event.userId,
        event.targetDeviceId ?? null,
        event.type,
        JSON.stringify(event.payload ?? null),
        event.createdAt
      ]
    )
  }

  async createDataTask(input: {
    userId: string
    type: 'export' | 'delete'
    requestedAt: string
  }): Promise<DataTask> {
    const result = await this.client.query(
      `
        INSERT INTO data_tasks (id, user_id, type, status, requested_at)
        VALUES ($1, $2, $3, 'pending', $4)
        RETURNING id, user_id, type, status, result, error_code, requested_at, completed_at
      `,
      [this.id(), input.userId, input.type, input.requestedAt]
    )
    return readDataTask(result.rows[0])
  }

  async getDataTask(userId: string, taskId: string): Promise<DataTask | undefined> {
    const result = await this.client.query(
      `
        SELECT id, user_id, type, status, result, error_code, requested_at, completed_at
        FROM data_tasks
        WHERE user_id = $1 AND id = $2
      `,
      [userId, taskId]
    )
    return result.rows[0] ? readDataTask(result.rows[0]) : undefined
  }

  async setDataTaskStatus(input: {
    taskId: string
    status: 'running' | 'completed' | 'failed'
    result?: Record<string, unknown> | null
    errorCode?: string | null
    completedAt?: string | null
  }): Promise<void> {
    await this.client.query(
      `
        UPDATE data_tasks
        SET status = $1,
            result = COALESCE($2::jsonb, result),
            error_code = $3,
            completed_at = COALESCE($4, completed_at)
        WHERE id = $5
      `,
      [
        input.status,
        input.result === undefined ? null : JSON.stringify(input.result),
        input.errorCode ?? null,
        input.completedAt ?? null,
        input.taskId
      ]
    )
  }

  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const result = await this.client.query(
      `
        SELECT revision, snapshot, updated_at
        FROM user_sync_snapshots
        WHERE user_id = $1
      `,
      [userId]
    )
    const row = result.rows[0]
    return {
      exportedAt: new Date().toISOString(),
      revision: row ? readNumber(row.revision) : 0,
      snapshot: row ? readPayload(row.snapshot) : null,
      updatedAt: row ? readTimestamp(row.updated_at) : null
    }
  }

  async deleteUserData(userId: string): Promise<void> {
    const checkedOut = this.pool ? await this.pool.connect() : null
    const transaction = checkedOut ?? this.client
    await transaction.query('BEGIN')
    try {
      await transaction.query('DELETE FROM user_sync_snapshots WHERE user_id = $1', [userId])
      // Older tables can still contain data created before Sync V2; deletion must cover it.
      await transaction.query('DELETE FROM sync_conflicts WHERE user_id = $1', [userId])
      await transaction.query('DELETE FROM sync_operations WHERE user_id = $1', [userId])
      await transaction.query('DELETE FROM sync_changes WHERE user_id = $1', [userId])
      await transaction.query('DELETE FROM sync_entities WHERE user_id = $1', [userId])
      await transaction.query('COMMIT')
    } catch (error) {
      await transaction.query('ROLLBACK')
      throw error
    } finally {
      checkedOut?.release()
    }
  }
}

function readUser(row: Row | undefined): Phase1User {
  if (!row) throw new Error('expected user row')
  return {
    id: readString(row.id),
    email: readString(row.email),
    passwordHash: readString(row.password_hash),
    createdAt: readTimestamp(row.created_at),
    emailVerifiedAt:
      row.email_verified_at === null || row.email_verified_at === undefined
        ? null
        : readTimestamp(row.email_verified_at)
  }
}

function readDevice(row: Row | undefined): Phase1Device {
  if (!row) throw new Error('expected device row')
  return {
    id: readString(row.id),
    userId: readString(row.user_id),
    name: readString(row.name),
    platform: readString(row.platform ?? 'desktop'),
    appVersion: readString(row.app_version ?? 'unknown'),
    createdAt: readTimestamp(row.created_at),
    lastSeenAt:
      row.last_seen_at === null || row.last_seen_at === undefined
        ? null
        : readTimestamp(row.last_seen_at),
    revokedAt:
      row.revoked_at === null || row.revoked_at === undefined ? null : readTimestamp(row.revoked_at)
  }
}

function readRefreshSession(row: Row | undefined): Phase1RefreshSession {
  if (!row) throw new Error('expected refresh session row')
  return {
    id: readString(row.id),
    userId: readString(row.user_id),
    deviceId: readString(row.device_id),
    refreshTokenHash: readString(row.refresh_token_hash),
    active: Boolean(row.active),
    createdAt: readTimestamp(row.created_at),
    rotatedAt:
      row.rotated_at === null || row.rotated_at === undefined ? null : readTimestamp(row.rotated_at)
  }
}

function readSyncV2Snapshot(row: Row): StoredSyncV2Snapshot {
  return {
    revision: readNumber(row.revision),
    snapshot: readPayload(row.snapshot) as SyncV2Snapshot,
    updatedAt: readTimestamp(row.updated_at)
  }
}

function readDataTask(row: Row | undefined): DataTask {
  if (!row) throw new Error('expected data task row')
  return {
    id: readString(row.id),
    userId: readString(row.user_id),
    type: row.type === 'delete' ? 'delete' : 'export',
    status:
      row.status === 'running' || row.status === 'completed' || row.status === 'failed'
        ? row.status
        : 'pending',
    result: row.result === null || row.result === undefined ? null : readPayload(row.result),
    errorCode:
      row.error_code === null || row.error_code === undefined ? null : readString(row.error_code),
    requestedAt: readTimestamp(row.requested_at),
    completedAt:
      row.completed_at === null || row.completed_at === undefined
        ? null
        : readTimestamp(row.completed_at)
  }
}

type Row = Record<string, unknown>

function readString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected string column')
  return value
}

function readTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('expected timestamp column')
    return value.toISOString()
  }
  return readString(value)
}

function readNumber(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed))
    throw new Error('expected number column')
  return parsed
}

function readNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected json map')
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, readNumber(count)]))
}

function readPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error('expected json payload column')
}
