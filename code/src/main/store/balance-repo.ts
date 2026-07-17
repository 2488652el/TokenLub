/**
 * 余额快照仓库:管理 balance_snapshots 表的写入与查询。
 * 该模块属于 main 进程的 store 模块,提供余额快照的持久化与最新快照查询能力。
 * (glm-5.2)
 */
import { getDb } from './db'
import { randomUUID } from 'node:crypto'
import type { BalanceSnapshot } from '@shared/types/provider'
import { markSyncV2Dirty } from './sync-v2-repo'

/** balance_snapshots 表的数据库行结构映射。 */
interface DbRow {
  id: number
  api_key_id: string | null
  provider_id: string
  total: number | null
  used: number | null
  remaining: number | null
  currency: string | null
  captured_at: string
  raw_json: string | null
  sync_id: string | null
}

/** 将数据库行映射为 BalanceSnapshot 对象,处理可选字段与 raw_json 反序列化。 */
function rowToSnapshot(r: DbRow): BalanceSnapshot & { id: number; apiKeyId?: string } {
  const base = {
    id: r.id,
    providerId: r.provider_id,
    capturedAt: r.captured_at
  } as BalanceSnapshot & { id: number; apiKeyId?: string }
  if (r.api_key_id !== null) base.apiKeyId = r.api_key_id
  if (r.total !== null) base.total = r.total
  if (r.used !== null) base.used = r.used
  if (r.remaining !== null) base.remaining = r.remaining
  if (r.currency !== null) base.currency = r.currency
  if (r.raw_json) base.raw = JSON.parse(r.raw_json) as unknown
  return base
}

/**
 * 插入一条余额快照记录。
 * @param snap 含 apiKeyId 的余额快照,空值字段以 null 存储,raw 以 JSON 字符串存储
 */
export function insertBalance(snap: BalanceSnapshot & { apiKeyId: string }): void {
  const db = getDb()
  const syncId = randomUUID()
  db.transaction(() => {
    db.prepare(
      `
          INSERT INTO balance_snapshots (
            api_key_id, provider_id, total, used, remaining, currency, captured_at, raw_json, sync_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
    ).run(
      snap.apiKeyId,
      snap.providerId,
      snap.total ?? null,
      snap.used ?? null,
      snap.remaining ?? null,
      snap.currency ?? null,
      snap.capturedAt,
      snap.raw !== undefined ? JSON.stringify(snap.raw) : null,
      syncId
    )
    markSyncV2Dirty()
  })()
}

/**
 * 查询每个 api_key 的最新余额快照。
 * 对每个 api_key 取 captured_at 最大的记录,按时间降序返回。
 * @returns 含 id 与可选 apiKeyId 的余额快照数组
 */
export function latestBalances(): Array<BalanceSnapshot & { id: number; apiKeyId?: string }> {
  const db = getDb()
  // For each api_key, take the most recent snapshot
  // 对每个 api_key 取最新快照。(glm-5.2)
  const rows = db
    .prepare(
      `
    SELECT b.* FROM balance_snapshots b
    INNER JOIN (
      SELECT api_key_id, provider_id, MAX(captured_at) AS mx
      FROM balance_snapshots
      GROUP BY api_key_id, provider_id
    ) m ON b.api_key_id IS m.api_key_id
      AND b.provider_id = m.provider_id
      AND b.captured_at = m.mx
    ORDER BY b.captured_at DESC
  `
    )
    .all() as DbRow[]
  return rows.map(rowToSnapshot)
}
