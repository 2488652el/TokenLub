/**
 * 应用设置仓库:管理 app_settings 表的键值读写。
 * 该模块属于 main 进程的 store 模块,值以 JSON 字符串存储,读取时自动反序列化。
 * (glm-5.2)
 */
import { getDb } from './db'

/**
 * 读取指定键的设置值,值以 JSON 存储,无法反序列化时回退为原始字符串。
 * @param key 设置键名
 * @returns 反序列化后的值;键不存在返回 null
 */
export function getSetting<T = unknown>(key: string): T | null {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    { value: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return row.value as unknown as T
  }
}

/**
 * 写入指定键的设置值(序列化为 JSON),键存在时更新。
 * @param key 设置键名
 * @param value 任意可序列化的值
 */
export function setSetting(key: string, value: unknown): void {
  const db = getDb()
  db.prepare(
    `
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `
  ).run(key, JSON.stringify(value))
}

/**
 * 读取所有设置项,返回键值映射对象。
 * @returns 所有设置键值对,值已反序列化;无法反序列化的值保留原始字符串
 */
export function getAllSettings(): Record<string, unknown> {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string
    value: string
  }>
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value)
    } catch {
      out[r.key] = r.value
    }
  }
  return out
}
