/**
 * 告警规则仓库:管理 alert_rules 与 alert_events 表的 CRUD 操作。
 * 该模块属于 main 进程的 store 模块,提供告警规则的增删改查与事件持久化能力。
 * (glm-5.2)
 */
import { randomUUID } from 'node:crypto'
import { getDb } from './db'
import type { AlertRule, AlertEvent } from '@shared/types/alert'

/** alert_rules 表的数据库行结构映射。 */
interface DbRow {
  id: string
  scope: string
  provider_id: string | null
  threshold: number
  metric: string
  enabled: number
  last_triggered_at: string | null
  created_at: string
}

/** 将数据库行映射为 AlertRule 对象,处理可选字段的条件展开。 */
function rowToRule(r: DbRow): AlertRule {
  return {
    id: r.id,
    scope: r.scope as AlertRule['scope'],
    threshold: r.threshold,
    metric: r.metric as AlertRule['metric'],
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    ...(r.provider_id !== null ? { providerId: r.provider_id } : {}),
    ...(r.last_triggered_at !== null ? { lastTriggeredAt: r.last_triggered_at } : {})
  }
}

/** 查询所有告警规则,按创建时间降序排列。 */
export function listAlerts(): AlertRule[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as DbRow[]
  return rows.map(rowToRule)
}

/**
 * 新增一条告警规则,enabled 默认为 true。
 * @param input 不含 id/createdAt/enabled/lastTriggeredAt 的规则数据
 * @returns 完整的 AlertRule 对象(含生成的 id 与时间戳)
 */
export function addAlert(
  input: Omit<AlertRule, 'id' | 'createdAt' | 'enabled' | 'lastTriggeredAt'> & {
    enabled?: boolean
  }
): AlertRule {
  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO alert_rules (id, scope, provider_id, threshold, metric, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    input.scope,
    input.providerId ?? null,
    input.threshold,
    input.metric,
    input.enabled === false ? 0 : 1,
    now
  )
  return { id, enabled: input.enabled !== false, createdAt: now, ...input }
}

/** 切换告警规则的启用状态。 */
export function toggleAlert(id: string, enabled: boolean): void {
  const db = getDb()
  db.prepare('UPDATE alert_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
}

/** 删除指定告警规则。 */
export function deleteAlert(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
}

/** Update last_triggered_at after a rule fires (N3). */
/**
 * 规则触发后更新 last_triggered_at 时间戳。
 * @param ruleId 规则 ID
 * @param firedAt 触发时间(ISO 字符串)
 * (glm-5.2)
 */
export function markAlertTriggered(ruleId: string, firedAt: string): void {
  const db = getDb()
  db.prepare('UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?').run(firedAt, ruleId)
}

/** Persist an alert event (N3). The alert_events table is created by schema migrations in store/db. */
/**
 * 持久化一条告警触发事件。
 * alert_events 表由 store/db 的 schema 迁移创建。
 * @param event 不含 id 的事件数据
 * (glm-5.2)
 */
export function insertAlertEvent(event: Omit<AlertEvent, 'id'>): void {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO alert_events (id, rule_id, fired_at, value, threshold, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(randomUUID(), event.ruleId, event.firedAt, event.value, event.threshold, event.message)
}
