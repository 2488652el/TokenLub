/**
 * 定价仓库:管理 pricing_entries 表的 CRUD 与批量 upsert。
 * 该模块属于 main 进程的 store 模块,提供按供应商/模型/币种查询定价与用户定价覆盖能力。
 * (glm-5.2)
 */
import { getDb } from './db'
import type { PricingDiffEntry, PricingEntry, PricingHistoryEntry } from '@shared/types/pricing'
import { markSyncV2Dirty } from './sync-v2-repo'
import { normalizeBillingScope } from '@shared/pricing-scope'

/** pricing_entries 表的数据库行结构映射。 */
interface DbRow {
  id: number
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
  updated_at: string
}

interface HistoryRow {
  id: number
  provider_id: string
  billing_scope: string
  model: string
  currency: string
  change_kind: PricingHistoryEntry['kind']
  before_json: string | null
  after_json: string | null
  change_ratio: number | null
  status: PricingHistoryEntry['status']
  detected_at: string
  applied_at: string | null
}

/** 将数据库行映射为 PricingEntry 对象,处理可选缓存价格字段的条件展开。 */
function rowToEntry(r: DbRow): PricingEntry {
  return {
    id: r.id,
    providerId: r.provider_id,
    billingScope: normalizeBillingScope(r.billing_scope),
    model: r.model,
    promptPricePerMtok: r.prompt_price_per_mtok,
    completionPricePerMtok: r.completion_price_per_mtok,
    currency: r.currency,
    source: r.source as PricingEntry['source'],
    catalogActive: r.catalog_active !== 0,
    updatedAt: r.updated_at,
    ...(r.cache_read_price_per_mtok !== null
      ? { cacheReadPricePerMtok: r.cache_read_price_per_mtok }
      : {}),
    ...(r.cache_creation_price_per_mtok !== null
      ? { cacheCreationPricePerMtok: r.cache_creation_price_per_mtok }
      : {})
  }
}

function parseHistoryEntry(value: string | null): PricingEntry | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as PricingEntry
  } catch {
    return undefined
  }
}

function rowToHistory(r: HistoryRow): PricingHistoryEntry {
  const before = parseHistoryEntry(r.before_json)
  const after = parseHistoryEntry(r.after_json)
  return {
    id: r.id,
    providerId: r.provider_id,
    billingScope: normalizeBillingScope(r.billing_scope),
    model: r.model,
    currency: r.currency,
    kind: r.change_kind,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(r.change_ratio !== null ? { changeRatio: r.change_ratio } : {}),
    status: r.status,
    detectedAt: r.detected_at,
    ...(r.applied_at ? { appliedAt: r.applied_at } : {})
  }
}

/** 查询所有定价条目,按供应商与模型排序。 */
export function listPricing(): PricingEntry[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM pricing_entries ORDER BY provider_id, billing_scope, model')
    .all() as DbRow[]
  return rows.map(rowToEntry)
}

/**
 * 按供应商与模型查找定价,优先匹配指定币种与 user 来源。
 * @param providerId 供应商 ID
 * @param model 模型名称
 * @param preferredCurrency 首选币种(可选)
 * @returns 最优匹配的定价条目,无匹配返回 null
 */
export function findPricing(
  providerId: string,
  model: string,
  preferredCurrency?: string,
  billingScope?: string
): PricingEntry | null {
  const db = getDb()
  const normalizedScope = normalizeBillingScope(billingScope)
  const rows = db
    .prepare(
      `
      SELECT * FROM pricing_entries
      WHERE provider_id = ? AND model = ?
        AND billing_scope IN (?, 'default')
      ORDER BY
        CASE WHEN billing_scope = ? THEN 0 ELSE 1 END,
        CASE WHEN currency = ? THEN 0 ELSE 1 END,
        CASE WHEN source = 'user' THEN 0 ELSE 1 END,
        catalog_active DESC,
        updated_at DESC
      LIMIT 1
    `
    )
    .all(providerId, model, normalizedScope, normalizedScope, preferredCurrency ?? '') as DbRow[]
  return rows[0] ? rowToEntry(rows[0]) : null
}

/**
 * 仅按模型名称查找定价(跨供应商),优先匹配指定币种与 user 来源。
 * @param model 模型名称
 * @param preferredCurrency 首选币种(可选)
 * @returns 最优匹配的定价条目,无匹配返回 null
 */
export function findPricingByModel(
  model: string,
  preferredCurrency?: string,
  billingScope?: string
): PricingEntry | null {
  const db = getDb()
  const normalizedScope = normalizeBillingScope(billingScope)
  const normalizedModel = model.trim().toLowerCase()
  const modelLeaf = normalizedModel.split('/').at(-1) ?? normalizedModel
  const canonicalModel = modelLeaf === 'k3' ? 'kimi-k3' : modelLeaf
  const prefixedCanonicalModel = `%/${canonicalModel}`
  const rows = db
    .prepare(
      `
      SELECT * FROM pricing_entries
      WHERE billing_scope IN (?, 'default')
        AND (
          model = ?
          OR LOWER(model) = ?
          OR LOWER(model) = ?
          OR LOWER(model) LIKE ?
        )
      ORDER BY
        CASE
          WHEN model = ? THEN 0
          WHEN LOWER(model) = ? THEN 1
          WHEN LOWER(model) = ? THEN 2
          ELSE 3
        END,
        CASE WHEN billing_scope = ? THEN 0 ELSE 1 END,
        CASE WHEN currency = ? THEN 0 ELSE 1 END,
        CASE WHEN source = 'user' THEN 0 ELSE 1 END,
        catalog_active DESC,
        updated_at DESC
      LIMIT 1
    `
    )
    .all(
      normalizedScope,
      model,
      normalizedModel,
      canonicalModel,
      prefixedCanonicalModel,
      model,
      normalizedModel,
      canonicalModel,
      normalizedScope,
      preferredCurrency ?? ''
    ) as DbRow[]
  return rows[0] ? rowToEntry(rows[0]) : null
}

/**
 * 新增或更新定价条目(按 provider_id+billing_scope+model+currency 唯一键 upsert)。
 * @param entry 不含 id/updatedAt 的定价数据
 * @returns 持久化后的完整 PricingEntry 对象
 */
export function setPricing(entry: Omit<PricingEntry, 'id' | 'updatedAt'>): PricingEntry {
  const db = getDb()
  const now = new Date().toISOString()
  const billingScope = normalizeBillingScope(entry.billingScope)
  return db.transaction(() => {
    db.prepare(
      `
    INSERT INTO pricing_entries (
      provider_id, billing_scope, model, prompt_price_per_mtok, completion_price_per_mtok,
      cache_read_price_per_mtok, cache_creation_price_per_mtok, currency, source,
      catalog_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT (provider_id, billing_scope, model, currency) DO UPDATE SET
      prompt_price_per_mtok = excluded.prompt_price_per_mtok,
      completion_price_per_mtok = excluded.completion_price_per_mtok,
      cache_read_price_per_mtok = excluded.cache_read_price_per_mtok,
      cache_creation_price_per_mtok = excluded.cache_creation_price_per_mtok,
      source = excluded.source,
      catalog_active = 1,
      updated_at = excluded.updated_at
      `
    ).run(
      entry.providerId,
      billingScope,
      entry.model,
      entry.promptPricePerMtok,
      entry.completionPricePerMtok,
      entry.cacheReadPricePerMtok ?? null,
      entry.cacheCreationPricePerMtok ?? null,
      entry.currency,
      entry.source,
      now
    )
    const row = db
      .prepare(
        'SELECT * FROM pricing_entries WHERE provider_id = ? AND billing_scope = ? AND model = ? AND currency = ?'
      )
      .get(entry.providerId, billingScope, entry.model, entry.currency) as DbRow
    markSyncV2Dirty()
    return rowToEntry(row)
  })()
}

/** 删除指定定价条目。 */
export function deletePricing(id: number): void {
  const db = getDb()
  db.transaction(() => {
    const result = db.prepare('DELETE FROM pricing_entries WHERE id = ?').run(id)
    if (result.changes > 0) markSyncV2Dirty()
  })()
}

/** 写入一次目录差异审计记录；blocked 记录只允许在用户确认后重新应用。 */
export function recordPricingHistory(
  changes: PricingDiffEntry[],
  status: PricingHistoryEntry['status'],
  detectedAt: string,
  appliedAt?: string
): void {
  if (changes.length === 0) return
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO pricing_change_history (
      provider_id, billing_scope, model, currency, change_kind,
      before_json, after_json, change_ratio, status, detected_at, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.transaction((rows: PricingDiffEntry[]) => {
    for (const change of rows) {
      const item = change.after ?? change.before
      if (!item) continue
      stmt.run(
        item.providerId,
        normalizeBillingScope(item.billingScope),
        item.model,
        item.currency,
        change.kind,
        change.before ? JSON.stringify(change.before) : null,
        change.after ? JSON.stringify(change.after) : null,
        change.changeRatio ?? null,
        status,
        detectedAt,
        appliedAt ?? null
      )
    }
  })(changes)
}

export function listPricingHistory(limit = 100): PricingHistoryEntry[] {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
  const rows = getDb()
    .prepare(
      `SELECT * FROM pricing_change_history
       ORDER BY detected_at DESC, id DESC LIMIT ?`
    )
    .all(safeLimit) as HistoryRow[]
  return rows.map(rowToHistory)
}

/**
 * Bulk upsert catalog entries (source='catalog') in a single transaction.
 *
 * Only overwrites rows that are themselves source='catalog' — existing
 * source='user' rows are preserved so user-configured prices always win over
 * the catalog. This guard runs in the ON CONFLICT clause: when the conflicting
 * existing row is a user entry, the DO UPDATE is skipped via the WHERE clause.
 * 仅覆盖 source='catalog' 的行,保留 source='user' 的用户自定义定价;冲突时通过 ON CONFLICT WHERE 子句跳过用户行。(glm-5.2)
 */
export function upsertCatalogBatch(
  entries: PricingEntry[],
  options: {
    deactivateMissing?: boolean
    managedScopes?: ReadonlyArray<{ providerId: string; billingScope: string }>
  } = {}
): {
  updated: number
  skipped: number
} {
  if (entries.length === 0) return { updated: 0, skipped: 0 }
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO pricing_entries (
      provider_id, billing_scope, model, prompt_price_per_mtok, completion_price_per_mtok,
      cache_read_price_per_mtok, cache_creation_price_per_mtok, currency, source,
      catalog_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT (provider_id, billing_scope, model, currency) DO UPDATE SET
      prompt_price_per_mtok = excluded.prompt_price_per_mtok,
      completion_price_per_mtok = excluded.completion_price_per_mtok,
      cache_read_price_per_mtok = excluded.cache_read_price_per_mtok,
      cache_creation_price_per_mtok = excluded.cache_creation_price_per_mtok,
      source = excluded.source,
      catalog_active = 1,
      updated_at = excluded.updated_at
    WHERE pricing_entries.source = 'catalog'
  `)
  let updated = 0
  let skipped = 0
  const tx = db.transaction((rows: PricingEntry[]) => {
    let deactivated = 0
    if (options.deactivateMissing) {
      const touchedScopes = new Set(
        (options.managedScopes ?? rows).map(
          (row) => `${row.providerId}\u0000${normalizeBillingScope(row.billingScope)}`
        )
      )
      const deactivate = db.prepare(`
        UPDATE pricing_entries
        SET catalog_active = 0, updated_at = ?
        WHERE source = 'catalog' AND provider_id = ? AND billing_scope = ?
      `)
      for (const key of touchedScopes) {
        const [providerId, billingScope] = key.split('\u0000')
        deactivated += deactivate.run(now, providerId, billingScope).changes
      }
    }
    for (const r of rows) {
      const res = stmt.run(
        r.providerId,
        normalizeBillingScope(r.billingScope),
        r.model,
        r.promptPricePerMtok,
        r.completionPricePerMtok,
        r.cacheReadPricePerMtok ?? null,
        r.cacheCreationPricePerMtok ?? null,
        r.currency,
        'catalog',
        now
      )
      // changes == 1 means a row was inserted or updated; 0 means the ON
      // CONFLICT WHERE clause skipped it (a user row already holds that key).
      if (res.changes > 0) {
        updated++
      } else skipped++
    }
    if (updated > 0 || deactivated > 0) markSyncV2Dirty()
  })
  tx(entries)
  // SQLite doesn't distinguish insert-vs-update in changes; we report all
  // applied rows as "updated" for simplicity. "skipped" = user-owned rows
  // that were protected from overwrite.
  return { updated, skipped }
}
