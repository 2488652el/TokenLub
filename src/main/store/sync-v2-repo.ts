import { getDb } from './db'
import {
  EMPTY_SYNC_V2_SNAPSHOT,
  MAX_SYNC_V2_BALANCES,
  SYNCABLE_SETTING_KEYS,
  type SyncV2Snapshot
} from '../../shared/sync-v2'
import type { SyncMode } from '../../shared/sync-mode'
import type { SyncPreview } from '../../shared/sync-preview'
import { dirname } from 'node:path'
import { normalizeBillingScope } from '../../shared/pricing-scope'

type PricingRow = {
  provider_id: string
  billing_scope: string
  model: string
  prompt_price_per_mtok: number
  completion_price_per_mtok: number
  cache_read_price_per_mtok: number | null
  cache_creation_price_per_mtok: number | null
  currency: string
  source: string
  catalog_active: number
}

type BalanceRow = {
  sync_id: string
  provider_id: string
  total: number | null
  used: number | null
  remaining: number | null
  currency: string | null
  captured_at: string
}

export function getSyncV2Revision(): number {
  const row = getDb().prepare('SELECT revision FROM sync_v2_state WHERE id = 1').get() as
    { revision: number } | undefined
  return Number.isSafeInteger(row?.revision) && (row?.revision ?? -1) >= 0 ? row!.revision : 0
}

export function isSyncV2Dirty(): boolean {
  const row = getDb().prepare('SELECT dirty FROM sync_v2_state WHERE id = 1').get() as
    { dirty: number } | undefined
  return row?.dirty === 1
}

export function getSyncV2MutationGeneration(): number {
  const row = getDb()
    .prepare('SELECT mutation_generation FROM sync_v2_state WHERE id = 1')
    .get() as { mutation_generation: number } | undefined
  return Number.isSafeInteger(row?.mutation_generation) && (row?.mutation_generation ?? -1) >= 0
    ? row!.mutation_generation
    : 0
}

export function getSyncV2BaseSnapshot(): SyncV2Snapshot {
  const row = getDb().prepare('SELECT base_snapshot FROM sync_v2_state WHERE id = 1').get() as
    { base_snapshot: string | null } | undefined
  if (!row?.base_snapshot) return EMPTY_SYNC_V2_SNAPSHOT
  return parseBaseSnapshot(row.base_snapshot) ?? EMPTY_SYNC_V2_SNAPSHOT
}

export function hasValidSyncV2BaseSnapshot(): boolean {
  const row = getDb().prepare('SELECT base_snapshot FROM sync_v2_state WHERE id = 1').get() as
    { base_snapshot: string | null } | undefined
  return parseBaseSnapshot(row?.base_snapshot ?? null) !== null
}

export function markSyncV2Dirty(): void {
  getDb()
    .prepare(
      'UPDATE sync_v2_state SET dirty = 1, mutation_generation = mutation_generation + 1 WHERE id = 1'
    )
    .run()
}

export function createSyncV2Snapshot(): SyncV2Snapshot {
  const db = getDb()
  const settings: Record<string, unknown> = {}
  const readSetting = db.prepare('SELECT value FROM app_settings WHERE key = ?')
  for (const key of SYNCABLE_SETTING_KEYS) {
    const row = readSetting.get(key) as { value: string } | undefined
    if (!row) continue
    try {
      settings[key] = JSON.parse(row.value) as unknown
    } catch {
      settings[key] = row.value
    }
  }

  const pricing = (db.prepare('SELECT * FROM pricing_entries').all() as PricingRow[]).map(
    (row) => ({
      providerId: row.provider_id,
      billingScope: row.billing_scope,
      model: row.model,
      currency: row.currency,
      promptPricePerMtok: row.prompt_price_per_mtok,
      completionPricePerMtok: row.completion_price_per_mtok,
      cacheReadPricePerMtok: row.cache_read_price_per_mtok,
      cacheCreationPricePerMtok: row.cache_creation_price_per_mtok,
      source: row.source === 'catalog' ? ('catalog' as const) : ('user' as const),
      catalogActive: row.catalog_active !== 0
    })
  )

  const balances = (
    db
      .prepare(
        `
          SELECT sync_id, provider_id, total, used, remaining, currency, captured_at
          FROM balance_snapshots
          WHERE sync_id IS NOT NULL
          ORDER BY captured_at DESC, sync_id DESC
          LIMIT ?
        `
      )
      .all(MAX_SYNC_V2_BALANCES) as BalanceRow[]
  ).map((row) => ({
    id: row.sync_id,
    providerId: row.provider_id,
    capturedAt: row.captured_at,
    ...(row.total !== null ? { total: row.total } : {}),
    ...(row.used !== null ? { used: row.used } : {}),
    ...(row.remaining !== null ? { remaining: row.remaining } : {}),
    ...(row.currency !== null ? { currency: row.currency } : {})
  }))

  return { settings, pricing, balances }
}

export function getSyncV2Preview(mode: SyncMode): SyncPreview {
  const db = getDb()
  const snapshot = createSyncV2Snapshot()
  return {
    mode,
    settings: Object.keys(snapshot.settings).length,
    pricing: snapshot.pricing.length,
    balance: snapshot.balances.length,
    expectedUploads:
      mode === 'restore'
        ? 0
        : Object.keys(snapshot.settings).length +
          snapshot.pricing.length +
          snapshot.balances.length,
    risk:
      mode === 'restore'
        ? '将使用云端快照覆盖可同步设置和价格；本机专属设置保持不变。'
        : mode === 'upload'
          ? '将以本机快照覆盖云端同步数据。'
          : '将按自然键合并本机与云端快照。',
    backupDirectory: db.name === ':memory:' ? null : dirname(db.name)
  }
}

export function applySyncV2Snapshot(
  snapshot: SyncV2Snapshot,
  revision: number,
  successAt: string,
  expectedGeneration?: number,
  replaceBalances = false
): boolean {
  const db = getDb()
  return db.transaction(() => {
    if (expectedGeneration !== undefined && getSyncV2MutationGeneration() !== expectedGeneration) {
      return false
    }
    const removeSetting = db.prepare('DELETE FROM app_settings WHERE key = ?')
    const upsertSetting = db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
    )
    for (const key of SYNCABLE_SETTING_KEYS) {
      if (!(key in snapshot.settings)) removeSetting.run(key)
      else upsertSetting.run(key, JSON.stringify(snapshot.settings[key]))
    }

    db.prepare('DELETE FROM pricing_entries').run()
    const insertPricing = db.prepare(`
      INSERT INTO pricing_entries (
        provider_id, billing_scope, model, prompt_price_per_mtok, completion_price_per_mtok,
        cache_read_price_per_mtok, cache_creation_price_per_mtok, currency, source,
        catalog_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const entry of snapshot.pricing) {
      insertPricing.run(
        entry.providerId,
        normalizeBillingScope(entry.billingScope),
        entry.model,
        entry.promptPricePerMtok,
        entry.completionPricePerMtok,
        entry.cacheReadPricePerMtok ?? null,
        entry.cacheCreationPricePerMtok ?? null,
        entry.currency,
        entry.source,
        entry.catalogActive === false ? 0 : 1,
        successAt
      )
    }

    if (replaceBalances) {
      const desired = new Set(snapshot.balances.map((entry) => entry.id))
      const existing = db
        .prepare('SELECT sync_id FROM balance_snapshots WHERE sync_id IS NOT NULL')
        .all() as Array<{ sync_id: string }>
      const removeBalance = db.prepare('DELETE FROM balance_snapshots WHERE sync_id = ?')
      for (const row of existing) {
        if (!desired.has(row.sync_id)) removeBalance.run(row.sync_id)
      }
    }

    const upsertBalance = db.prepare(`
      INSERT INTO balance_snapshots (
        api_key_id, provider_id, total, used, remaining, currency, captured_at, raw_json, sync_id
      ) VALUES (NULL, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT (sync_id) DO UPDATE SET
        provider_id = excluded.provider_id,
        total = excluded.total,
        used = excluded.used,
        remaining = excluded.remaining,
        currency = excluded.currency,
        captured_at = excluded.captured_at
    `)
    for (const entry of snapshot.balances) {
      upsertBalance.run(
        entry.providerId,
        entry.total ?? null,
        entry.used ?? null,
        entry.remaining ?? null,
        entry.currency ?? null,
        entry.capturedAt,
        entry.id
      )
    }

    db.prepare(
      `
        INSERT INTO sync_v2_state (
          id, revision, last_success_at, dirty, base_snapshot
        ) VALUES (1, ?, ?, 0, ?)
        ON CONFLICT (id) DO UPDATE SET
          revision = excluded.revision,
          last_success_at = excluded.last_success_at,
          dirty = 0,
          base_snapshot = excluded.base_snapshot
      `
    ).run(revision, successAt, JSON.stringify(snapshot))
    return true
  })()
}

function parseBaseSnapshot(value: string | null): SyncV2Snapshot | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<SyncV2Snapshot> | null
    if (
      !parsed ||
      typeof parsed.settings !== 'object' ||
      parsed.settings === null ||
      Array.isArray(parsed.settings) ||
      !Array.isArray(parsed.pricing) ||
      !Array.isArray(parsed.balances)
    ) {
      return null
    }
    return parsed as SyncV2Snapshot
  } catch {
    return null
  }
}
