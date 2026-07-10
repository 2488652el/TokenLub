/**
 * 定价仓库:管理 pricing_entries 表的 CRUD 与批量 upsert。
 * 该模块属于 main 进程的 store 模块,提供按供应商/模型/币种查询定价与用户定价覆盖能力。
 * (glm-5.2)
 */
import { getDb } from './db'
import type { PricingEntry } from '@shared/types/pricing'

/** pricing_entries 表的数据库行结构映射。 */
interface DbRow {
  id: number
  provider_id: string
  model: string
  prompt_price_per_mtok: number
  completion_price_per_mtok: number
  cache_read_price_per_mtok: number | null
  cache_creation_price_per_mtok: number | null
  currency: string
  source: string
  updated_at: string
}

/** 将数据库行映射为 PricingEntry 对象,处理可选缓存价格字段的条件展开。 */
function rowToEntry(r: DbRow): PricingEntry {
  return {
    id: r.id,
    providerId: r.provider_id,
    model: r.model,
    promptPricePerMtok: r.prompt_price_per_mtok,
    completionPricePerMtok: r.completion_price_per_mtok,
    currency: r.currency,
    source: r.source as PricingEntry['source'],
    updatedAt: r.updated_at,
    ...(r.cache_read_price_per_mtok !== null
      ? { cacheReadPricePerMtok: r.cache_read_price_per_mtok }
      : {}),
    ...(r.cache_creation_price_per_mtok !== null
      ? { cacheCreationPricePerMtok: r.cache_creation_price_per_mtok }
      : {})
  }
}

/** 查询所有定价条目,按供应商与模型排序。 */
export function listPricing(): PricingEntry[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM pricing_entries ORDER BY provider_id, model')
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
  preferredCurrency?: string
): PricingEntry | null {
  const db = getDb()
  const rows = db
    .prepare(
      `
      SELECT * FROM pricing_entries
      WHERE provider_id = ? AND model = ?
      ORDER BY
        CASE WHEN currency = ? THEN 0 ELSE 1 END,
        CASE WHEN source = 'user' THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
    `
    )
    .all(providerId, model, preferredCurrency ?? '') as DbRow[]
  return rows[0] ? rowToEntry(rows[0]) : null
}

/**
 * 仅按模型名称查找定价(跨供应商),优先匹配指定币种与 user 来源。
 * @param model 模型名称
 * @param preferredCurrency 首选币种(可选)
 * @returns 最优匹配的定价条目,无匹配返回 null
 */
export function findPricingByModel(model: string, preferredCurrency?: string): PricingEntry | null {
  const db = getDb()
  const rows = db
    .prepare(
      `
      SELECT * FROM pricing_entries
      WHERE model = ?
      ORDER BY
        CASE WHEN currency = ? THEN 0 ELSE 1 END,
        CASE WHEN source = 'user' THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
    `
    )
    .all(model, preferredCurrency ?? '') as DbRow[]
  return rows[0] ? rowToEntry(rows[0]) : null
}

/**
 * 新增或更新定价条目(按 provider_id+model+currency 唯一键 upsert)。
 * @param entry 不含 id/updatedAt 的定价数据
 * @returns 持久化后的完整 PricingEntry 对象
 */
export function setPricing(entry: Omit<PricingEntry, 'id' | 'updatedAt'>): PricingEntry {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO pricing_entries (
      provider_id, model, prompt_price_per_mtok, completion_price_per_mtok,
      cache_read_price_per_mtok, cache_creation_price_per_mtok, currency, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider_id, model, currency) DO UPDATE SET
      prompt_price_per_mtok = excluded.prompt_price_per_mtok,
      completion_price_per_mtok = excluded.completion_price_per_mtok,
      cache_read_price_per_mtok = excluded.cache_read_price_per_mtok,
      cache_creation_price_per_mtok = excluded.cache_creation_price_per_mtok,
      source = excluded.source,
      updated_at = excluded.updated_at
  `
  ).run(
    entry.providerId,
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
    .prepare('SELECT * FROM pricing_entries WHERE provider_id = ? AND model = ? AND currency = ?')
    .get(entry.providerId, entry.model, entry.currency) as DbRow
  return rowToEntry(row)
}

/** 删除指定定价条目。 */
export function deletePricing(id: number): void {
  const db = getDb()
  db.prepare('DELETE FROM pricing_entries WHERE id = ?').run(id)
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
export function upsertCatalogBatch(entries: PricingEntry[]): {
  updated: number
  skipped: number
} {
  if (entries.length === 0) return { updated: 0, skipped: 0 }
  const db = getDb()
  const now = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT INTO pricing_entries (
      provider_id, model, prompt_price_per_mtok, completion_price_per_mtok,
      cache_read_price_per_mtok, cache_creation_price_per_mtok, currency, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider_id, model, currency) DO UPDATE SET
      prompt_price_per_mtok = excluded.prompt_price_per_mtok,
      completion_price_per_mtok = excluded.completion_price_per_mtok,
      cache_read_price_per_mtok = excluded.cache_read_price_per_mtok,
      cache_creation_price_per_mtok = excluded.cache_creation_price_per_mtok,
      source = excluded.source,
      updated_at = excluded.updated_at
    WHERE pricing_entries.source = 'catalog'
  `)
  let updated = 0
  let skipped = 0
  const tx = db.transaction((rows: PricingEntry[]) => {
    for (const r of rows) {
      const res = stmt.run(
        r.providerId,
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
      if (res.changes > 0) updated++
      else skipped++
    }
  })
  tx(entries)
  // SQLite doesn't distinguish insert-vs-update in changes; we report all
  // applied rows as "updated" for simplicity. "skipped" = user-owned rows
  // that were protected from overwrite.
  return { updated, skipped }
}
