import { getDb } from './db'

export interface SyncOutboxOperation {
  operationId: string
  entityType: string
  entityId: string
  baseVersion: number
  operation: 'upsert' | 'delete'
  payload: unknown
  createdAt: string
  attemptCount: number
  nextAttemptAt: string | null
  lastErrorCode: string | null
}

export interface LocalSyncState {
  scope: string
  cursor: string | null
  lastSuccessAt: string | null
  lastErrorCode: string | null
  bootstrapRequired: boolean
}

export interface SyncStateInput {
  scope: string
  cursor: string | null
  lastSuccessAt?: string | null
  lastErrorCode?: string | null
  bootstrapRequired: boolean
}

interface OutboxRow {
  operation_id: string
  entity_type: string
  entity_id: string
  base_version: number
  operation: 'upsert' | 'delete'
  payload: string | null
  created_at: string
  attempt_count: number
  next_attempt_at: string | null
  last_error_code: string | null
}

interface SyncStateRow {
  scope: string
  cursor: string | null
  last_success_at: string | null
  last_error_code: string | null
  bootstrap_required: number
}

function parsePayload(payload: string | null): unknown {
  if (payload === null) return null
  return JSON.parse(payload) as unknown
}

function rowToOutboxOperation(row: OutboxRow): SyncOutboxOperation {
  return {
    operationId: row.operation_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    baseVersion: row.base_version,
    operation: row.operation,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code
  }
}

function rowToSyncState(row: SyncStateRow): LocalSyncState {
  return {
    scope: row.scope,
    cursor: row.cursor,
    lastSuccessAt: row.last_success_at,
    lastErrorCode: row.last_error_code,
    bootstrapRequired: row.bootstrap_required === 1
  }
}

export function listPendingOutbox(limit = 100, now = new Date().toISOString()): SyncOutboxOperation[] {
  const db = getDb()
  const rows = db
    .prepare(
      `
      SELECT * FROM sync_outbox
      WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?
    `
    )
    .all(now, limit) as OutboxRow[]
  return rows.map(rowToOutboxOperation)
}

export function acknowledgeOutboxOperations(operationIds: string[]): void {
  if (operationIds.length === 0) return
  const db = getDb()
  const placeholders = operationIds.map(() => '?').join(', ')
  db.prepare(`DELETE FROM sync_outbox WHERE operation_id IN (${placeholders})`).run(...operationIds)
}

export function recordOutboxAttempt(
  operationId: string,
  attemptCount: number,
  nextAttemptAt: string | null,
  lastErrorCode: string | null
): void {
  const db = getDb()
  db.prepare(
    `
    UPDATE sync_outbox
    SET attempt_count = ?, next_attempt_at = ?, last_error_code = ?
    WHERE operation_id = ?
  `
  ).run(attemptCount, nextAttemptAt, lastErrorCode, operationId)
}

export function getSyncState(scope = 'default'): LocalSyncState | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM sync_state WHERE scope = ?').get(scope) as
    | SyncStateRow
    | undefined
  return row ? rowToSyncState(row) : null
}

export function saveSyncState(state: SyncStateInput): void {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO sync_state (
      scope, cursor, last_success_at, last_error_code, bootstrap_required
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (scope) DO UPDATE SET
      cursor = excluded.cursor,
      last_success_at = excluded.last_success_at,
      last_error_code = excluded.last_error_code,
      bootstrap_required = excluded.bootstrap_required
  `
  ).run(
    state.scope,
    state.cursor,
    state.lastSuccessAt ?? null,
    state.lastErrorCode ?? null,
    Number(state.bootstrapRequired)
  )
}
