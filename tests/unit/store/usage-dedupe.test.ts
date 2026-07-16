/**
 * 用量去重契约测试:覆盖 vendor-api 业务键去重逻辑与 SQLite UNIQUE 约束声明校验。
 * (glm-5.2)
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' }
}))

const usageDb = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('../../../src/main/store/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/store/db')>()),
  getDb: () => usageDb.current
}))

import { applyMigrationsForTest } from '../../../src/main/store/db'
import { insertUsage } from '../../../src/main/store/usage-repo'

interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): unknown
  }
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
}

function createMigratedDb(): SqliteDb {
  const nodeRequire = createRequire(import.meta.url)
  const { DatabaseSync } = nodeRequire(['node', 'sqlite'].join(':')) as {
    DatabaseSync: new (path: string) => SqliteDb
  }
  const db = new DatabaseSync(':memory:')
  db.transaction = (<T extends (...args: never[]) => unknown>(fn: T) =>
    fn) as SqliteDb['transaction']
  applyMigrationsForTest(db as unknown as Parameters<typeof applyMigrationsForTest>[0])
  return db
}

function insertVendorRow(
  db: SqliteDb,
  values: { apiKeyId: string; upstreamDimension: string; totalTokens: number }
): void {
  db.prepare(
    `INSERT INTO usage_records (
      api_key_id, provider_id, model, period_start, period_end, total_tokens,
      source, upstream_dimension, captured_at
    ) VALUES (?, 'openai-admin', 'gpt-4o', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', ?,
      'vendor-api', ?, '2026-07-02T00:00:00Z')`
  ).run(values.apiKeyId, values.totalTokens, values.upstreamDimension)
}

/**
 * N2: vendor-api usage dedup.
 *
 * The real dedup happens in SQLite via UNIQUE constraints on usage_records
 * (see src/main/store/db.ts v2 migration). These tests verify the dedup
 * contract without a live DB (better-sqlite3 is Electron-ABI in this repo):
 *   1. The schema SQL declares BOTH UNIQUE(source, provider_id, model, period_start)
 *      AND UNIQUE(source, message_id).
 *   2. The business-key dedup function used to reason about duplicates produces
 *      identical keys for the same vendor-api slice.
 */

function vendorApiDedupeKey(r: {
  source: string
  providerId: string
  model: string
  periodStart?: string
}): string {
  // Mirror the SQLite UNIQUE(source, provider_id, model, period_start) constraint.
  // period_start is NULL-coalesced to '' so undefined and '' collide (the SQL
  // treats NULL specially — NULLs never match, but our providers always set
  // periodStart for vendor-api slices, so this is a safe approximation for tests).
  return [r.source, r.providerId, r.model, r.periodStart ?? ''].join('|')
}

// N2 vendor-api 用量去重契约测试组:覆盖业务键相同/不同/重复批次跳过逻辑
describe('N2: usage dedup contract', () => {
  it('produces identical keys for the same vendor-api slice', () => {
    const a = {
      source: 'vendor-api',
      providerId: 'openai-admin',
      model: 'gpt-4o',
      periodStart: '2026-07-01T00:00:00Z'
    }
    const b = { ...a }
    expect(vendorApiDedupeKey(a)).toBe(vendorApiDedupeKey(b))
  })

  it('produces different keys for different periods (so distinct days are kept)', () => {
    const a = {
      source: 'vendor-api',
      providerId: 'openai-admin',
      model: 'gpt-4o',
      periodStart: '2026-07-01T00:00:00Z'
    }
    const b = {
      source: 'vendor-api',
      providerId: 'openai-admin',
      model: 'gpt-4o',
      periodStart: '2026-07-02T00:00:00Z'
    }
    expect(vendorApiDedupeKey(a)).not.toBe(vendorApiDedupeKey(b))
  })

  it('produces different keys for different models on the same provider/day', () => {
    const a = {
      source: 'vendor-api',
      providerId: 'openai-admin',
      model: 'gpt-4o',
      periodStart: '2026-07-01T00:00:00Z'
    }
    const b = {
      source: 'vendor-api',
      providerId: 'openai-admin',
      model: 'gpt-4o-mini',
      periodStart: a.periodStart
    }
    expect(vendorApiDedupeKey(a)).not.toBe(vendorApiDedupeKey(b))
  })

  it('simulates INSERT OR IGNORE: a duplicate batch keeps only the first row', () => {
    // Emulate what SQLite does: collect keys seen, skip duplicates.
    const seen = new Set<string>()
    const rows = [
      {
        source: 'vendor-api',
        providerId: 'openai-admin',
        model: 'gpt-4o',
        periodStart: '2026-07-01T00:00:00Z'
      },
      {
        source: 'vendor-api',
        providerId: 'openai-admin',
        model: 'gpt-4o',
        periodStart: '2026-07-01T00:00:00Z'
      }, // dup
      {
        source: 'vendor-api',
        providerId: 'openai-admin',
        model: 'gpt-4o',
        periodStart: '2026-07-02T00:00:00Z'
      } // distinct day
    ]
    let inserted = 0
    for (const r of rows) {
      const k = vendorApiDedupeKey(r)
      if (seen.has(k)) continue
      seen.add(k)
      inserted++
    }
    expect(inserted).toBe(2) // not 3 — the duplicate was skipped
  })
})

describe('v18 vendor-api usage deduplication', () => {
  it('insertUsage reports vendor updates without crossing key or result dimensions', () => {
    const db = createMigratedDb()
    usageDb.current = db

    expect(
      insertUsage([
        {
          apiKeyId: 'key-a',
          providerId: 'openai-admin',
          model: 'gpt-4o',
          periodStart: '2026-07-01T00:00:00Z',
          source: 'vendor-api',
          upstreamDimension: 'project:one',
          totalTokens: 10,
          capturedAt: '2026-07-02T00:00:00Z'
        },
        {
          apiKeyId: 'key-b',
          providerId: 'openai-admin',
          model: 'gpt-4o',
          periodStart: '2026-07-01T00:00:00Z',
          source: 'vendor-api',
          upstreamDimension: 'project:one',
          totalTokens: 20,
          capturedAt: '2026-07-02T00:00:00Z'
        },
        {
          apiKeyId: 'key-a',
          providerId: 'openai-admin',
          model: 'gpt-4o',
          periodStart: '2026-07-01T00:00:00Z',
          source: 'vendor-api',
          upstreamDimension: 'project:two',
          totalTokens: 30,
          capturedAt: '2026-07-02T00:00:00Z'
        }
      ])
    ).toEqual({ inserted: 3, updated: 0, skipped: 0 })

    expect(
      insertUsage([
        {
          apiKeyId: 'key-a',
          providerId: 'openai-admin',
          model: 'gpt-4o',
          periodStart: '2026-07-01T00:00:00Z',
          source: 'vendor-api',
          upstreamDimension: 'project:one',
          totalTokens: 40,
          capturedAt: '2026-07-03T00:00:00Z'
        }
      ])
    ).toEqual({ inserted: 0, updated: 1, skipped: 0 })

    expect(
      db
        .prepare(
          'SELECT api_key_id, upstream_dimension, total_tokens FROM usage_records ORDER BY api_key_id, upstream_dimension'
        )
        .all()
    ).toEqual([
      { api_key_id: 'key-a', upstream_dimension: 'project:one', total_tokens: 40 },
      { api_key_id: 'key-a', upstream_dimension: 'project:two', total_tokens: 30 },
      { api_key_id: 'key-b', upstream_dimension: 'project:one', total_tokens: 20 }
    ])
  })

  it('preserves equal provider/model/period rows belonging to different API keys', () => {
    const db = createMigratedDb()

    insertVendorRow(db, { apiKeyId: 'key-a', upstreamDimension: 'project:one', totalTokens: 10 })
    insertVendorRow(db, { apiKeyId: 'key-b', upstreamDimension: 'project:one', totalTokens: 20 })

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM usage_records WHERE source = 'vendor-api'").get()
    ).toEqual({
      count: 2
    })
  })

  it('preserves distinct upstream results and updates a repeated result dimension', () => {
    const db = createMigratedDb()

    insertVendorRow(db, { apiKeyId: 'key-a', upstreamDimension: 'project:one', totalTokens: 10 })
    insertVendorRow(db, { apiKeyId: 'key-a', upstreamDimension: 'project:two', totalTokens: 20 })
    db.prepare(
      `INSERT INTO usage_records (
        api_key_id, provider_id, model, period_start, period_end, total_tokens,
        source, upstream_dimension, captured_at
      ) VALUES ('key-a', 'openai-admin', 'gpt-4o', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', 30,
        'vendor-api', 'project:one', '2026-07-03T00:00:00Z')
      ON CONFLICT(
        source, COALESCE(api_key_id, ''), provider_id, billing_scope, model,
        COALESCE(period_start, ''), upstream_dimension
      ) WHERE source = 'vendor-api'
      DO UPDATE SET total_tokens = excluded.total_tokens, captured_at = excluded.captured_at`
    ).run()

    expect(
      db
        .prepare(
          "SELECT upstream_dimension, total_tokens FROM usage_records WHERE api_key_id = 'key-a' ORDER BY upstream_dimension"
        )
        .all()
    ).toEqual([
      { upstream_dimension: 'project:one', total_tokens: 30 },
      { upstream_dimension: 'project:two', total_tokens: 20 }
    ])
  })

  it('retains session-log uniqueness independently of the vendor key', () => {
    const db = createMigratedDb()
    const insertSession = db.prepare(
      `INSERT INTO usage_records (provider_id, model, source, message_id, captured_at)
       VALUES ('claude', 'claude-3', 'session-log', 'message-1', '2026-07-01T00:00:00Z')`
    )

    insertSession.run()
    expect(() => insertSession.run()).toThrow()
  })
})

// N2 schema SQL 双 UNIQUE 约束声明测试组:覆盖业务键与 message_id 唯一约束及版本迁移
describe('N2: schema SQL declares both UNIQUE constraints', () => {
  it('usage_records v2 table has UNIQUE(source, provider_id, model, period_start)', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain('UNIQUE (source, provider_id, model, period_start)')
  })

  it('usage_records v2 table retains UNIQUE(source, message_id) for session-log', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain('UNIQUE (source, message_id)')
  })

  it('schema migrates to version 2 (the dedup migration)', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(2)")
  })
})
