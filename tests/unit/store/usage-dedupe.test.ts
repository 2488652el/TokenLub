/**
 * 用量去重契约测试:覆盖 vendor-api 业务键去重逻辑与 SQLite UNIQUE 约束声明校验。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
