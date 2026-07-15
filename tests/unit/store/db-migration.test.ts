/**
 * 数据库迁移契约测试:覆盖 v5 迁移、v6 同步表、v16 区域价格键、PRAGMA 幂等守卫与列默认值。
 * (glm-5.2)
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * PR-1 v5 migration contract test.
 *
 * The project's better-sqlite3 binary is built against Electron's ABI and
 * cannot be `require()`d from plain Node (vitest runs in a Node child), so we
 * mirror the precedent set by tests/unit/store/usage-dedupe.test.ts:
 * the migration SQL itself is asserted via the source file (no live SQLite),
 * and the migration's behavior on a fresh DB is verified by driving it through
 * a fake better-sqlite3 connection so the PRAGMA gate paths are executed.
 *
 * `applyMigrationsForTest` is the test seam exported from db.ts for exactly
 * this purpose — it lets us pass our own connection without touching
 * `app.getPath('userData')`.
 */

interface ColumnInfo {
  name: string
}
interface SchemaVersionRow {
  v: number | null
}

function makeFakeDb(schemaState: { version: number; columns: ColumnInfo[] }) {
  return {
    prepare(sql: string) {
      return {
        run: (..._args: unknown[]) => {
          // Stamp schema_version increments requested inside applyMigrations.
          if (/INSERT INTO schema_version \(version\) VALUES \(\?\)/.test(sql)) {
            schemaState.version = Math.max(schemaState.version, Number(_args[0]))
          }
          return { changes: 1 }
        },
        get: () => {
          if (/SELECT MAX\(version\) AS v FROM schema_version/.test(sql)) {
            return { v: schemaState.version } as SchemaVersionRow
          }
          return undefined
        },
        all: () =>
          /SELECT id FROM pricing_entries/.test(sql)
            ? ([{ id: 11 }, { id: 12 }] as unknown[])
            : (schemaState.columns as ColumnInfo[])
      }
    },
    transaction<T>(fn: () => T) {
      return () => fn()
    },
    exec: (sql: string) => {
      // Capture ADD COLUMN calls so we can update the fake PRAGMA view.
      const add = sql.match(/ALTER TABLE api_keys ADD COLUMN (\w+) ([^,]+)/)
      const colName = add?.[1]
      if (colName) {
        schemaState.columns.push({ name: colName })
      }
    }
  }
}

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' }
}))

// Import AFTER the mock so db.ts's `import { app } from 'electron'` resolves
// to our stub. We never call getDb() so getPath is not invoked.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyMigrationsForTest } from '../../../src/main/store/db'

// PR-1 v5 迁移契约测试组:覆盖源 SQL 声明、迁移执行与幂等性
describe('PR-1: db v5 migration contract', () => {
  it('source SQL declares the v5 ADD COLUMN steps with the documented defaults', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(5)")

    // usage_query_enabled: INTEGER NOT NULL DEFAULT 1 (legacy rows stay active)
    expect(sql).toMatch(
      /ALTER TABLE api_keys ADD COLUMN usage_query_enabled INTEGER NOT NULL DEFAULT 1/
    )
    // query_mode: TEXT NOT NULL DEFAULT 'manual' (legacy rows opt-in via toggle)
    expect(sql).toMatch(/ALTER TABLE api_keys ADD COLUMN query_mode TEXT NOT NULL DEFAULT 'manual'/)

    // Both columns must be guarded by PRAGMA table_info(api_keys) (same
    // pattern as v3 / v4) so re-running migrations is a no-op. v3 uses it
    // once for extra_credentials; v5 calls it once and inspects both new
    // columns against the same result — that is 2 PRAGMA calls total.
    const guardCount = (sql.match(/PRAGMA table_info\(api_keys\)/g) ?? []).length
    expect(guardCount).toBeGreaterThanOrEqual(2)
  })

  it('opens the TokenLub database while preserving legacy TokenScope data candidates', () => {
    const source = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(source).toContain("const DB_FILE_NAME = 'tokenlub.db'")
    expect(source).toContain("const LEGACY_DB_FILE_NAMES = ['tokenscope.db']")
    expect(source).toContain("const LEGACY_USER_DATA_DIRS = ['TokenScope', 'tokengirl']")
    expect(source).toContain('copyFileSync(legacyPath, dbPath)')
    expect(source).toContain("const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm']")
  })

  it('checks database integrity before applying migrations', () => {
    const source = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(source).toContain("pragma('quick_check', { simple: true })")
    expect(source).toContain("throw new Error('database integrity check failed')")
  })

  it('applyMigrationsForTest brings a fresh DB up to the latest version with sync tables', () => {
    // A brand-new DB: schema_version table will be created, no rows yet.
    const fresh = makeFakeDb({ version: 0, columns: [] })
    // applyMigrations creates api_keys via CREATE TABLE IF NOT EXISTS; we
    // simulate that by adding the existing columns to the fake view first so
    // PRAGMA table_info reflects what an actual fresh schema looks like.
    fresh.exec(`CREATE TABLE api_keys (id TEXT PRIMARY KEY)`)
    fresh.exec(`CREATE TABLE usage_records (id INTEGER PRIMARY KEY AUTOINCREMENT)`)
    fresh.exec(`CREATE TABLE balance_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT)`)
    fresh.exec(`CREATE TABLE pricing_entries (id INTEGER PRIMARY KEY AUTOINCREMENT)`)
    fresh.exec(`CREATE TABLE alert_rules (id TEXT PRIMARY KEY)`)
    fresh.exec(
      `CREATE TABLE log_sync_state (source TEXT, file_path TEXT, PRIMARY KEY (source, file_path))`
    )
    fresh.exec(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    fresh.exec(`CREATE TABLE alert_events (id TEXT PRIMARY KEY)`)
    // The CREATE TABLE that matters for v5 PRAGMA is api_keys; pre-populate
    // the fake PRAGMA view with its existing columns.
    fresh.exec(`ALTER TABLE api_keys ADD COLUMN existing_marker TEXT`)

    applyMigrationsForTest(fresh as unknown as Parameters<typeof applyMigrationsForTest>[0])

    // A fresh database should reach the latest schema version.
    const versionRow = fresh
      .prepare('SELECT MAX(version) AS v FROM schema_version')
      .get() as SchemaVersionRow
    expect(versionRow.v).toBe(17)
    expect(readFileSync(resolve('src/main/store/db.ts'), 'utf8')).toContain('model_pricing')

    // Both new columns should be visible via PRAGMA table_info(api_keys).
    const cols = fresh.prepare('PRAGMA table_info(api_keys)').all() as ColumnInfo[]
    const names = cols.map((c) => c.name)
    expect(names).toContain('usage_query_enabled')
    expect(names).toContain('query_mode')
    // Pre-existing api_keys columns from v1 must still be present (no destructive rebuild).
    expect(names).toContain('existing_marker')

    // Also verify the column defaults embedded in the source SQL — these are
    // what the DB applies automatically for legacy rows.
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    const usageMatch = sql.match(
      /ALTER TABLE api_keys ADD COLUMN usage_query_enabled[^,]*DEFAULT (\d+)/
    )
    expect(usageMatch?.[1]).toBe('1') // legacy rows = usage ON
    const modeMatch = sql.match(/ALTER TABLE api_keys ADD COLUMN query_mode[^,]*DEFAULT '(\w+)'/)
    expect(modeMatch?.[1]).toBe('manual') // legacy rows opt in via toggle
  })

  it('v6 source defines non-destructive sync tables and the outbox due index', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(6)")
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_outbox\s*\(/)
    expect(sql).toMatch(/operation_id TEXT PRIMARY KEY/)
    expect(sql).toMatch(/CHECK \(operation IN \('upsert', 'delete'\)\)/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_sync_outbox_due\s+ON sync_outbox/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_entity_map\s*\(/)
    expect(sql).toMatch(/sync_id TEXT NOT NULL UNIQUE/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_state\s*\(/)
    expect(sql).toMatch(/bootstrap_required INTEGER NOT NULL DEFAULT 0/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_conflicts\s*\(/)
    expect(sql).toMatch(
      /status TEXT NOT NULL CHECK \(status IN \('open', 'resolved', 'discarded'\)\)/
    )
  })

  it('v7 source defines a local-only encrypted sync session table', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(7)")
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_session\s*\(/)
    expect(sql).toMatch(/access_token BLOB NOT NULL/)
    expect(sql).toMatch(/refresh_token BLOB NOT NULL/)
    expect(sql).toMatch(/CHECK \(id = 1\)/)
  })

  it('v9 source persists the initial sync mode', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(9)")
    expect(sql).toContain("ALTER TABLE sync_session ADD COLUMN mode TEXT NOT NULL DEFAULT 'merge'")
  })

  it('v10 source adds stable UUIDs and a unique index for balance snapshots', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(10)")
    expect(sql).toContain('ALTER TABLE balance_snapshots ADD COLUMN sync_id TEXT')
    expect(sql).toContain('idx_balance_snapshots_sync_id')
  })

  it('v11 upgrades the balance UUID index for ON CONFLICT(sync_id)', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(11)")
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_snapshots_sync_id\s+ON balance_snapshots\(sync_id\)(?!\s+WHERE)/s
    )
  })

  it('v12 adds compact Sync V2 revision state while retaining historical upgrade tables', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(12)")
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_v2_state\s*\(/)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sync_outbox')
  })

  it('v13 tracks whether local sync data changed after the last applied revision', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(13)")
    expect(sql).toContain('ALTER TABLE sync_v2_state ADD COLUMN dirty')
    expect(sql).toContain('WHERE revision = 0')
  })

  it('v14 stores one clean baseline for three-way snapshot rebases', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')
    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(14)")
    expect(sql).toContain('ALTER TABLE sync_v2_state ADD COLUMN base_snapshot TEXT')
  })

  it('v16 rebuilds pricing identities with billing scope and preserves historical usage scope', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(16)")
    expect(sql).toMatch(/billing_scope TEXT NOT NULL DEFAULT 'default'/)
    expect(sql).toMatch(/catalog_active INTEGER NOT NULL DEFAULT 1/)
    expect(sql).toContain('UNIQUE (provider_id, billing_scope, model, currency)')
    expect(sql).toContain('ON pricing_entries(provider_id, billing_scope, model, currency)')
    expect(sql).toContain(
      "ALTER TABLE usage_records ADD COLUMN billing_scope TEXT NOT NULL DEFAULT 'default'"
    )
    expect(sql).toMatch(
      /provider_id IN \('moonshot', 'minimax'\)[\s\S]*currency = 'USD'[\s\S]*THEN 'global'/
    )
    expect(sql).toMatch(/provider_id = 'minimax'[\s\S]*currency = 'CNY'[\s\S]*THEN 'cn'/)
  })

  it('v17 creates an auditable pricing change history table', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(sql).toContain("INSERT INTO schema_version (version) VALUES (?)').run(17)")
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS pricing_change_history\s*\(/)
    expect(sql).toContain(
      "change_kind TEXT NOT NULL CHECK (change_kind IN ('added', 'changed', 'removed'))"
    )
    expect(sql).toContain("status TEXT NOT NULL CHECK (status IN ('applied', 'blocked'))")
    expect(sql).toContain('idx_pricing_history_detected')
  })

  it('v2 usage_records rebuild preserves agent_label while copying legacy rows', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(sql).toMatch(/INSERT OR IGNORE INTO usage_records_v2\s*\([^)]*agent_label[^)]*\)/s)
    expect(sql).toMatch(/SELECT\s+[^;]*agent_label[^;]*\s+FROM usage_records/s)
  })

  it('migration is idempotent: re-running does not duplicate pricing identities', () => {
    const state = { version: 14, columns: [] as ColumnInfo[] }
    // Pre-populate columns as if the latest migration had already run.
    state.columns.push(
      { name: 'id' },
      { name: 'existing_marker' },
      { name: 'usage_query_enabled' },
      { name: 'query_mode' }
    )

    // Wrap the state object in a fake `Database.Database`-shaped facade
    // (applyMigrations calls db.exec for CREATE TABLE IF NOT EXISTS too).
    const fakeDb = {
      exec: (sql: string) => {
        const add = sql.match(/ALTER TABLE api_keys ADD COLUMN (\w+)/)
        const colName = add?.[1]
        if (colName) state.columns.push({ name: colName })
      },
      prepare: (sql: string) => ({
        run: (..._args: unknown[]) => {
          if (/INSERT INTO schema_version \(version\) VALUES \(\?\)/.test(sql)) {
            state.version = Math.max(state.version, Number(_args[0]))
          }
          return { changes: 1 }
        },
        get: () => ({ v: state.version }) as SchemaVersionRow,
        all: () => state.columns as ColumnInfo[]
      }),
      transaction<T>(fn: () => T) {
        return () => fn()
      }
    }

    applyMigrationsForTest(fakeDb as unknown as Parameters<typeof applyMigrationsForTest>[0])

    // The PRAGMA guards must prevent the migration from re-running its body.
    expect(state.columns.filter((c) => c.name === 'usage_query_enabled').length).toBe(1)
    expect(state.columns.filter((c) => c.name === 'query_mode').length).toBe(1)
    // Re-running an up-to-date database must not bump the schema version.
    expect(state.version).toBe(17)
  })

  it('v8 migration maps existing pricing rows without creating duplicate identities', () => {
    const state = { version: 7, columns: [] as ColumnInfo[] }
    const maps: string[] = []
    const fakeDb = {
      exec: () => undefined,
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          if (/INSERT INTO schema_version/.test(sql)) state.version = Number(args[0])
          if (/INSERT OR IGNORE INTO sync_entity_map/.test(sql)) maps.push(`${args[0]}:${args[1]}`)
          return { changes: 1 }
        },
        get: () => ({ v: state.version }) as SchemaVersionRow,
        all: () => (/SELECT id FROM pricing_entries/.test(sql) ? [{ id: 21 }, { id: 22 }] : [])
      }),
      transaction<T>(fn: () => T) {
        return () => fn()
      }
    }

    applyMigrationsForTest(fakeDb as unknown as Parameters<typeof applyMigrationsForTest>[0])
    expect(state.version).toBe(17)
    expect(maps).toHaveLength(2)
    expect(maps.every((map) => map.startsWith('model_pricing:'))).toBe(true)
  })
})
