/**
 * 数据库迁移契约测试:覆盖 PR-1 v5、同步 v6、PRAGMA 幂等守卫与 v2 usage_records 重建。
 * (glm-5.2)
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * PR-1 v5 and sync v6 migration contract test.
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
        all: () => schemaState.columns as ColumnInfo[]
      }
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

// 数据库迁移契约测试组:覆盖源 SQL 声明、迁移执行与幂等性
describe('database migration contract', () => {
  it('v6 creates the local sync tables and stamps schema version 6', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sync_outbox')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sync_entity_map')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sync_state')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sync_conflicts')

    const state = { version: 5, columns: [] as ColumnInfo[] }
    const fakeDb = makeFakeDb(state)
    applyMigrationsForTest(fakeDb as unknown as Parameters<typeof applyMigrationsForTest>[0])

    expect(state.version).toBe(6)
  })

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

  it('applyMigrationsForTest brings a fresh DB up to version 6 with both new columns', () => {
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

    // After all migrations, schema_version should have reached 6.
    const versionRow = fresh
      .prepare('SELECT MAX(version) AS v FROM schema_version')
      .get() as SchemaVersionRow
    expect(versionRow.v).toBe(6)

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

  it('v2 usage_records rebuild preserves agent_label while copying legacy rows', () => {
    const sql = readFileSync(resolve('src/main/store/db.ts'), 'utf8')

    expect(sql).toMatch(/INSERT OR IGNORE INTO usage_records_v2\s*\([^)]*agent_label[^)]*\)/s)
    expect(sql).toMatch(/SELECT\s+[^;]*agent_label[^;]*\s+FROM usage_records/s)
  })

  it('v6 migration is idempotent: re-running does not duplicate columns or bump the schema version', () => {
    const state = { version: 6, columns: [] as ColumnInfo[] }
    // Pre-populate columns as if the v5 migration had already run.
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
      })
    }

    applyMigrationsForTest(fakeDb as unknown as Parameters<typeof applyMigrationsForTest>[0])

    // The PRAGMA guards must prevent the migration from re-running its body.
    expect(state.columns.filter((c) => c.name === 'usage_query_enabled').length).toBe(1)
    expect(state.columns.filter((c) => c.name === 'query_mode').length).toBe(1)
    // schema_version should NOT be bumped past 6 (all migration blocks are skipped).
    expect(state.version).toBe(6)
  })
})
