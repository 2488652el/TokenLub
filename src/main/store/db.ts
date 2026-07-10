/**
 * 数据库初始化与 schema 迁移:管理 SQLite 数据库连接、旧库迁移与 v1-v5 版本迁移。
 * 该模块属于 main 进程的 store 模块,是所有 repo 模块的数据库单例来源。
 * (glm-5.2)
 */
import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'

/** 数据库文件名与历史遗留文件名/目录名常量。 */
let dbInstance: Database.Database | null = null

const DB_FILE_NAME = 'tokenlub.db'
const LEGACY_DB_FILE_NAMES = ['tokenscope.db'] as const
const LEGACY_USER_DATA_DIRS = ['TokenScope', 'tokengirl'] as const
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm'] as const

/**
 * 获取数据库单例(懒初始化)。首次调用时创建连接、启用 WAL 模式、开启外键并执行 schema 迁移。
 * @returns better-sqlite3 数据库实例
 */
export function getDb(): Database.Database {
  if (dbInstance) return dbInstance

  const userData = app.getPath('userData')
  if (!existsSync(userData)) mkdirSync(userData, { recursive: true })
  const dbPath = join(userData, DB_FILE_NAME)
  copyLegacyDbIfNeeded(userData, dbPath)
  dbInstance = new Database(dbPath)
  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('foreign_keys = ON')
  applyMigrations(dbInstance)
  return dbInstance
}

/** 若目标库不存在,则从历史遗留路径复制数据库文件及 WAL 侧车文件。(内部辅助函数) */
function copyLegacyDbIfNeeded(userData: string, dbPath: string): void {
  if (existsSync(dbPath)) return

  for (const legacyPath of legacyDbCandidates(userData)) {
    if (!existsSync(legacyPath)) continue
    copyFileSync(legacyPath, dbPath)
    for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
      const legacySidecar = `${legacyPath}${suffix}`
      const targetSidecar = `${dbPath}${suffix}`
      if (existsSync(legacySidecar) && !existsSync(targetSidecar)) {
        copyFileSync(legacySidecar, targetSidecar)
      }
    }
    return
  }
}

/** 收集所有历史遗留数据库文件候选路径(userData 与旧目录)。(内部辅助函数) */
function legacyDbCandidates(userData: string): string[] {
  const roots = new Set<string>([userData])
  try {
    const appData = app.getPath('appData')
    for (const dir of LEGACY_USER_DATA_DIRS) roots.add(join(appData, dir))
  } catch {
    // getDb() is only called after app ready; keep the helper defensive for tests.
  }

  const candidates: string[] = []
  for (const root of roots) {
    for (const fileName of LEGACY_DB_FILE_NAMES) {
      candidates.push(join(root, fileName))
    }
  }
  return candidates
}

/**
 * Test-only migration runner. Accepts an externally-owned better-sqlite3
 * connection (e.g. `:memory:`) so {@link db-migration.test.ts} can assert the
 * v5 schema without touching the Electron `app.getPath('userData')` path used
 * by {@link getDb}. The migration logic itself lives in {@link applyMigrations}
 * - keep them in lockstep.
 * 测试专用迁移入口:接受外部连接(如 :memory:)以在测试中验证 v5 schema,不依赖 Electron 路径。(glm-5.2)
 */
export function applyMigrationsForTest(db: Database.Database): void {
  applyMigrations(db)
}

/** 执行 schema 迁移:创建表与索引,按版本号依次应用 v1-v5 迁移逻辑。(内部核心函数) */
function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `)

  // --- v1: initial schema (all tables; usage_records with UNIQUE(source, message_id)) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      encrypted_key BLOB NOT NULL,
      key_tail TEXT NOT NULL,
      base_url_override TEXT,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'api-key',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id TEXT,
      provider_id TEXT NOT NULL,
      total REAL,
      used REAL,
      remaining REAL,
      currency TEXT,
      captured_at TEXT NOT NULL,
      raw_json TEXT,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id TEXT,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cache_read_tokens INTEGER,
      total_tokens INTEGER,
      cost REAL,
      currency TEXT,
      source TEXT NOT NULL,
      session_id TEXT,
      message_id TEXT,
      agent_label TEXT,
      captured_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_source_provider
      ON usage_records(source, provider_id, captured_at);
    CREATE TABLE IF NOT EXISTS pricing_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_price_per_mtok REAL NOT NULL,
      completion_price_per_mtok REAL NOT NULL,
      cache_read_price_per_mtok REAL,
      cache_creation_price_per_mtok REAL,
      currency TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      updated_at TEXT NOT NULL,
      UNIQUE (provider_id, model, currency)
    );
    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      provider_id TEXT,
      threshold REAL NOT NULL,
      metric TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS log_sync_state (
      source TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mtime_ms INTEGER,
      byte_offset INTEGER,
      last_synced_at TEXT,
      PRIMARY KEY (source, file_path)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- alert_events schema lives here with the rest of the DDL (was previously
    -- created ad-hoc by scheduler/refresh.ensureAlertTable).
    CREATE TABLE IF NOT EXISTS alert_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      fired_at TEXT NOT NULL,
      value REAL NOT NULL,
      threshold REAL NOT NULL,
      message TEXT NOT NULL
    );
  `)

  // v1 may have created usage_records with the old UNIQUE(source, message_id)
  // constraint. Record v1 only if the table was just created without it; for
  // pre-existing v1 databases we detect the constraint in the v2 migration.
  let currentVersion = (
    db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  ).v
  if (currentVersion === null) currentVersion = 0

  if (currentVersion < 1) {
    // Fresh DB: stamp v1. The unique constraints are added in v2 for both
    // fresh and upgraded DBs so the logic is uniform.
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1)
    currentVersion = 1
  }

  // --- v2: dedupe vendor-api usage by business key (N2) ---
  // Problem: vendor-api slices have no message_id, so UNIQUE(source, message_id)
  // never deduped them — every refresh inserted duplicate rows, inflating
  // dashboard SUM(cost). Fix: add UNIQUE(source, provider_id, model, period_start)
  // for vendor-api dedup AND keep UNIQUE(source, message_id) for session-log.
  // SQLite cannot ALTER a table's constraints in place, so we rebuild the table.
  if (currentVersion < 2) {
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS usage_records_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          api_key_id TEXT,
          provider_id TEXT NOT NULL,
          model TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          cache_creation_tokens INTEGER,
          cache_read_tokens INTEGER,
          total_tokens INTEGER,
          cost REAL,
          currency TEXT,
          source TEXT NOT NULL,
          session_id TEXT,
          message_id TEXT,
          agent_label TEXT,
          captured_at TEXT NOT NULL,
          UNIQUE (source, provider_id, model, period_start),
          UNIQUE (source, message_id)
        );
        INSERT OR IGNORE INTO usage_records_v2 (
          id, api_key_id, provider_id, model, period_start, period_end,
          prompt_tokens, completion_tokens, cache_creation_tokens, cache_read_tokens,
          total_tokens, cost, currency, source, session_id, message_id, agent_label, captured_at
        )
          SELECT
            id, api_key_id, provider_id, model, period_start, period_end,
            prompt_tokens, completion_tokens, cache_creation_tokens, cache_read_tokens,
            total_tokens, cost, currency, source, session_id, message_id, agent_label, captured_at
          FROM usage_records;
        DROP TABLE usage_records;
        ALTER TABLE usage_records_v2 RENAME TO usage_records;
        CREATE INDEX IF NOT EXISTS idx_usage_source_provider
          ON usage_records(source, provider_id, captured_at);
        CREATE INDEX IF NOT EXISTS idx_usage_message_id
          ON usage_records(source, message_id) WHERE message_id IS NOT NULL;
      `)
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(2)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  // --- v3: extra_credentials on api_keys (admin-key fix) ---
  // Some providers (anthropic-admin, openai-admin) need a second credential
  // (an admin/org key) distinct from the primary apiKey. refreshAll() must
  // pass it through ProviderCredentials.extra so the admin providers don't
  // silently fall back to using apiKey as the admin key (which 401/403s).
  // SQLite has no ADD COLUMN IF NOT EXISTS, so guard with PRAGMA table_info.
  if (currentVersion < 3) {
    const cols = db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'extra_credentials')) {
      db.exec('ALTER TABLE api_keys ADD COLUMN extra_credentials TEXT')
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(3)
  }

  // --- v4: agent_label on usage_records (human-readable project/agent name) ---
  // Session logs only carry the raw sessionId UUID; agent_label stores the
  // derived project name (from the session's cwd or the encoded project dir)
  // so the UI can show a meaningful label. SQLite has no ADD COLUMN IF NOT
  // EXISTS, so guard with PRAGMA table_info.
  if (currentVersion < 4) {
    const cols = db.prepare('PRAGMA table_info(usage_records)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'agent_label')) {
      db.exec('ALTER TABLE usage_records ADD COLUMN agent_label TEXT')
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(4)
  }

  // --- v5: per-key usage controls on api_keys (PR-1) ---
  // Lets PR-3/4 toggle balance/usage polling on individual keys without
  // touching the key itself, and lets the scheduler infer whether a row
  // should be polled automatically (admin-org providers) or only when the
  // user opts in (everything else).
  //
  // - `usage_query_enabled`: legacy rows default to 1 so all pre-existing
  //   keys stay active after upgrade (backward-compatible). New rows are
  //   written through addKey() with an explicit value (default true on the
  //   repo layer; PR-3 handler may override to false on creation).
  // - `query_mode`: legacy rows default to 'manual' so the scheduler's
  //   PR-3/4 skip logic falls back to "user-controlled toggle" until the
  //   user re-saves the key with a real decision. addKey() recomputes
  //   this from deriveQueryMode(providerId) on insert.
  //
  // SQLite has no ADD COLUMN IF NOT EXISTS, so guard with PRAGMA table_info.
  if (currentVersion < 5) {
    const apiKeyCols = db.prepare('PRAGMA table_info(api_keys)').all() as Array<{
      name: string
    }>
    if (!apiKeyCols.some((c) => c.name === 'usage_query_enabled')) {
      db.exec('ALTER TABLE api_keys ADD COLUMN usage_query_enabled INTEGER NOT NULL DEFAULT 1')
    }
    if (!apiKeyCols.some((c) => c.name === 'query_mode')) {
      db.exec("ALTER TABLE api_keys ADD COLUMN query_mode TEXT NOT NULL DEFAULT 'manual'")
    }
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(5)
  }

  // --- v6: lossless vendor usage identity ---
  // v2 omitted api_key_id and a provider result dimension, allowing Admin API
  // rows from different keys or sibling results to overwrite one another.
  if (currentVersion < 6) {
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE usage_records_v6 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          api_key_id TEXT,
          provider_id TEXT NOT NULL,
          model TEXT NOT NULL,
          period_start TEXT,
          period_end TEXT,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          cache_creation_tokens INTEGER,
          cache_read_tokens INTEGER,
          total_tokens INTEGER,
          cost REAL,
          currency TEXT,
          source TEXT NOT NULL,
          upstream_dimension TEXT NOT NULL DEFAULT '',
          session_id TEXT,
          message_id TEXT,
          agent_label TEXT,
          captured_at TEXT NOT NULL,
          UNIQUE (source, message_id)
        );
        INSERT OR IGNORE INTO usage_records_v6 (
          id, api_key_id, provider_id, model, period_start, period_end,
          prompt_tokens, completion_tokens, cache_creation_tokens, cache_read_tokens,
          total_tokens, cost, currency, source, upstream_dimension, session_id,
          message_id, agent_label, captured_at
        ) SELECT
          id, api_key_id, provider_id, model, period_start, period_end,
          prompt_tokens, completion_tokens, cache_creation_tokens, cache_read_tokens,
          total_tokens, cost, currency, source, '', session_id,
          message_id, agent_label, captured_at
        FROM usage_records ORDER BY id;
        DROP TABLE usage_records;
        ALTER TABLE usage_records_v6 RENAME TO usage_records;
        CREATE INDEX idx_usage_source_provider
          ON usage_records(source, provider_id, captured_at);
        CREATE INDEX idx_usage_message_id
          ON usage_records(source, message_id) WHERE message_id IS NOT NULL;
        CREATE UNIQUE INDEX idx_usage_vendor_identity
          ON usage_records(
            source, COALESCE(api_key_id, ''), provider_id, model,
            COALESCE(period_start, ''), upstream_dimension
          ) WHERE source = 'vendor-api';
      `)
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(6)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
