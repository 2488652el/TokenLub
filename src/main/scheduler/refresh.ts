/**
 * 调度器核心:定时刷新所有密钥的余额与用量,持久化快照,评估告警规则并写入心跳。
 * 该模块属于 main 进程的 scheduler 模块,协调 providers、store 多个子系统完成数据采集与持久化。
 * (glm-5.2)
 */
import { listKeys, getDecryptedExtraCredentials, getDecryptedKey } from '../store/keys-repo'
import { getProvider } from '../providers/registry'
import { insertBalance, latestBalances } from '../store/balance-repo'
import { insertUsage } from '../store/usage-repo'
import { findPricing } from '../store/pricing-repo'
import { getSetting, setSetting } from '../store/settings-store'
import { listAlerts, markAlertTriggered, insertAlertEvent } from '../store/alerts-repo'
import type { AlertRule } from '@shared/types/alert'
import type { BalanceSnapshot, UsageSlice } from '@shared/types/provider'
import type { RefreshFailure, UsageRecord } from '@shared/types/usage'
import type { PricingEntry } from '@shared/types/pricing'
import { calcCost } from '@shared/utils/money'

let timer: NodeJS.Timeout | null = null

/** 清除自动刷新定时器。(内部辅助函数)(glm-5.2) */
function clearAutoRefresh(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Minimum gap between repeat firings of the same rule (5 minutes). */
/** 同一规则重复触发的最小冷却间隔(5 分钟)。(glm-5.2) */
const ALERT_RETRIGGER_COOLDOWN_MS = 5 * 60 * 1000

/**
 * Pure evaluation of a single alert rule against a balance snapshot (N3).
 * Returns the metric value and whether the rule fires, or null when the rule
 * cannot be evaluated (e.g. remaining_pct needs total, which is missing).
 *
 * Fire condition:
 *   - remaining_amount: snap.remaining <= threshold
 *   - remaining_pct:    (remaining / total * 100) <= threshold
 * 触发条件:remaining_amount 时余额<=阈值;remaining_pct 时余额占比<=阈值。(glm-5.2)
 */
export function evaluateAlertRule(
  rule: AlertRule,
  snap: BalanceSnapshot
): { fires: boolean; value: number } | null {
  if (rule.metric === 'remaining_amount') {
    if (typeof snap.remaining !== 'number' || !Number.isFinite(snap.remaining)) return null
    return { fires: snap.remaining <= rule.threshold, value: snap.remaining }
  }
  // remaining_pct
  if (typeof snap.remaining !== 'number' || typeof snap.total !== 'number') return null
  if (!Number.isFinite(snap.remaining) || !Number.isFinite(snap.total)) return null
  if (snap.total <= 0) return null
  const pct = (snap.remaining / snap.total) * 100
  return { fires: pct <= rule.threshold, value: pct }
}

/**
 * Evaluate all enabled alert rules against the latest balance snapshots and
 * fire any that breach their threshold (N3). Writes an alert_events row and
 * updates last_triggered_at for each firing rule, with a 5-minute cooldown so
 * a refresh loop does not spam events.
 *
 * @param now override for deterministic tests; defaults to current time
 * @param now 用于测试的确定性时间覆盖,默认当前时间。(glm-5.2)
 */
export function evaluateAlerts(now: Date = new Date()): { fired: number; skipped: number } {
  const rules = listAlerts().filter((r) => r.enabled)
  if (rules.length === 0) return { fired: 0, skipped: 0 }

  const snaps = latestBalances()
  if (snaps.length === 0) return { fired: 0, skipped: rules.length }

  const nowMs = now.getTime()
  const nowISO = now.toISOString()
  let fired = 0
  let skipped = 0

  for (const rule of rules) {
    // Cooldown: skip if this rule fired within the last 5 minutes.
    if (rule.lastTriggeredAt) {
      const lastMs = new Date(rule.lastTriggeredAt).getTime()
      if (Number.isFinite(lastMs) && nowMs - lastMs < ALERT_RETRIGGER_COOLDOWN_MS) {
        skipped++
        continue
      }
    }

    // For provider-scoped rules, match the provider's snapshots. For global
    // rules, evaluate against every snapshot (fire once per breaching key).
    const matching =
      rule.scope === 'provider' && rule.providerId
        ? snaps.filter((s) => s.providerId === rule.providerId)
        : snaps

    let ruleFired = false
    for (const snap of matching) {
      const result = evaluateAlertRule(rule, snap)
      if (!result || !result.fires) continue
      ruleFired = true
      const message =
        rule.metric === 'remaining_amount'
          ? `[${rule.providerId ?? 'global'}] remaining ${result.value.toFixed(2)} <= threshold ${rule.threshold}`
          : `[${rule.providerId ?? 'global'}] remaining ${result.value.toFixed(1)}% <= threshold ${rule.threshold}%`
      try {
        insertAlertEvent({
          ruleId: rule.id,
          firedAt: nowISO,
          value: result.value,
          threshold: rule.threshold,
          message
        })
      } catch (e) {
        // alert_events table missing (ensureAlertTable not run) — log and continue
        console.error('[alerts] failed to insert event:', (e as Error).message)
      }
    }
    if (ruleFired) {
      try {
        markAlertTriggered(rule.id, nowISO)
        console.warn(`[alerts] rule ${rule.id} fired (${rule.metric} <= ${rule.threshold})`)
        fired++
      } catch (e) {
        console.error('[alerts] failed to mark triggered:', (e as Error).message)
      }
    } else {
      skipped++
    }
  }
  return { fired, skipped }
}

/** 若数字有限则返回该数字,否则返回 undefined。(内部辅助函数)(glm-5.2) */
function finiteOrUndefined(n: number | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** 汇总 usage slice 中的各类 token(prompt/completion/cache)之和。(内部辅助函数)(glm-5.2) */
function sumTokens(slice: UsageSlice): number {
  return (
    (finiteOrUndefined(slice.promptTokens) ?? 0) +
    (finiteOrUndefined(slice.completionTokens) ?? 0) +
    (finiteOrUndefined(slice.cacheCreationTokens) ?? 0) +
    (finiteOrUndefined(slice.cacheReadTokens) ?? 0)
  )
}

/**
 * 将供应商返回的 UsageSlice 转换为持久化的 UsageRecord,可选地按定价配置计算成本。
 * @param slice 供应商返回的用量切片
 * @param opts 包含 apiKeyId、采集时间与可选定价条目的选项
 * @returns 标准化后的 UsageRecord,含 token 数量与成本
 */
export function usageSliceToRecord(
  slice: UsageSlice,
  opts: {
    apiKeyId: string
    capturedAt?: string
    pricing?: PricingEntry | null
  }
): UsageRecord {
  const record: UsageRecord = {
    apiKeyId: opts.apiKeyId,
    providerId: slice.providerId,
    model: slice.model ?? '(unknown)',
    periodStart: slice.periodStart,
    periodEnd: slice.periodEnd,
    source: slice.source ?? 'vendor-api',
    ...(slice.upstreamDimension !== undefined
      ? { upstreamDimension: slice.upstreamDimension }
      : {}),
    capturedAt: slice.periodEnd ?? opts.capturedAt ?? new Date().toISOString()
  }
  const promptTokens = finiteOrUndefined(slice.promptTokens)
  const completionTokens = finiteOrUndefined(slice.completionTokens)
  const cacheCreationTokens = finiteOrUndefined(slice.cacheCreationTokens)
  const cacheReadTokens = finiteOrUndefined(slice.cacheReadTokens)
  if (promptTokens !== undefined) record.promptTokens = promptTokens
  if (completionTokens !== undefined) record.completionTokens = completionTokens
  if (cacheCreationTokens !== undefined) record.cacheCreationTokens = cacheCreationTokens
  if (cacheReadTokens !== undefined) record.cacheReadTokens = cacheReadTokens

  const totalTokens = finiteOrUndefined(slice.totalTokens) ?? sumTokens(slice)
  record.totalTokens = totalTokens

  const cost = finiteOrUndefined(slice.cost)
  if (cost !== undefined) {
    record.cost = cost
  } else if (opts.pricing) {
    record.cost = calcCost(
      record.promptTokens,
      record.completionTokens,
      opts.pricing.promptPricePerMtok,
      opts.pricing.completionPricePerMtok,
      record.cacheReadTokens,
      record.cacheCreationTokens,
      opts.pricing.cacheReadPricePerMtok,
      opts.pricing.cacheCreationPricePerMtok
    )
  }

  if (slice.currency) record.currency = slice.currency
  else if (opts.pricing?.currency) record.currency = opts.pricing.currency
  return record
}

/** Refresh all keys' balances, persist snapshots, evaluate alerts, and write a heartbeat. */
/**
 * 刷新所有密钥的余额与用量,持久化快照,评估告警规则并写入心跳。
 * 遍历所有密钥,跳过已禁用用量查询的密钥,采集余额与用量并写入数据库。
 * @returns 刷新结果统计:成功数、用量插入/跳过数、失败数及失败明细
 * (glm-5.2)
 */
export async function refreshAll(): Promise<{
  ok: boolean
  refreshed: number
  usageInserted: number
  usageSkipped: number
  failed: number
  failures: RefreshFailure[]
}> {
  const keys = listKeys()
  let refreshed = 0
  let usageInserted = 0
  let usageSkipped = 0
  let failed = 0
  const failures: RefreshFailure[] = []
  const now = new Date()
  const toISO = now.toISOString()
  const fromISO = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
  for (const k of keys) {
    const p = getProvider(k.providerId)
    if (!p) continue
    // PR-2: skip keys whose usage query is disabled. Uses strict `=== false`
    // so older fixtures (where usageQueryEnabled is undefined) still refresh.
    if (k.usageQueryEnabled === false) continue
    try {
      const apiKey = getDecryptedKey(k.id)
      const extra = getDecryptedExtraCredentials(k.id)
      const caps = p.build({ baseUrl: k.baseUrlOverride ?? '', apiKey, extra })
      let didRefresh = false
      if (p.hasBalanceApi && caps.balance) {
        const snap = await caps.balance()
        insertBalance({ ...snap, apiKeyId: k.id })
        didRefresh = true
      }
      if (p.hasUsageApi && caps.usage) {
        const slices = await caps.usage(fromISO, toISO)
        const records = slices.map((s) =>
          usageSliceToRecord(s, {
            apiKeyId: k.id,
            capturedAt: toISO,
            pricing: findPricing(s.providerId, s.model ?? '(unknown)', s.currency)
          })
        )
        const result = insertUsage(records)
        usageInserted += result.inserted
        usageSkipped += result.skipped
        didRefresh = true
      }
      if (didRefresh) refreshed++
    } catch (e) {
      const message = (e as Error).message
      console.error(`[refresh] ${k.alias} (${k.providerId}) failed:`, message)
      failures.push({ alias: k.alias, providerId: k.providerId, error: message })
      failed++
    }
  }
  // N3: evaluate alert rules against the freshly captured balances.
  try {
    evaluateAlerts()
  } catch (e) {
    console.error('[refresh] alert evaluation failed:', (e as Error).message)
  }
  setSetting('last_refresh_at', new Date().toISOString())
  return { ok: true, refreshed, usageInserted, usageSkipped, failed, failures }
}

/** Start the auto-refresh timer. Idempotent. */
/**
 * 启动自动刷新定时器,幂等(重复调用不会创建多个定时器)。
 * 间隔由 refresh_interval_min 设置决定,默认 30 分钟;间隔<=0 时不启动。
 * (glm-5.2)
 */
export function startAutoRefresh(): void {
  if (timer) return
  const intervalMin = getSetting<number>('refresh_interval_min') ?? 30
  if (intervalMin <= 0) return
  timer = setInterval(
    () => {
      void refreshAll()
    },
    intervalMin * 60 * 1000
  )
}

/** Restart the auto-refresh timer with the current settings value. */
/** 重启自动刷新定时器,使用当前设置值重新初始化。(glm-5.2) */
export function restartAutoRefresh(): void {
  clearAutoRefresh()
  startAutoRefresh()
}
