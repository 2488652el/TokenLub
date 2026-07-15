/**
 * 用量记录仓库:管理 usage_records 表的写入、查询、仪表盘汇总与多维度消费统计。
 * 该模块属于 main 进程的 store 模块,是仪表盘数据与消费分析的核心数据访问层。
 * (glm-5.2)
 */
import { getDb } from './db'
import { findPricing, findPricingByModel } from './pricing-repo'
import { calcCost, convertSpendToCny } from '@shared/utils/money'
import type {
  UsageRecord,
  UsageLogPage,
  TotalSpendSummary,
  KeySpendSummary,
  ModelSpendAggregate
} from '@shared/types/usage'
import { normalizeBillingScope, resolveBillingScope } from '@shared/pricing-scope'

/**
 * Compute a provider's cost share of the grand total.
 * Returns 0 when grandTotal is 0 or negative (N5: avoid meaningless pct when
 * there is no spend, which would otherwise make the pie chart lie).
 * 总额为 0 或负时返回 0,避免无消费时饼图显示无意义百分比。(glm-5.2)
 */
export function computeProviderPct(providerCost: number, grandTotal: number): number {
  return grandTotal > 0 ? providerCost / grandTotal : 0
}

/** usage_records 表的数据库行结构映射。 */
interface DbRow {
  id: number
  api_key_id: string | null
  provider_id: string
  billing_scope: string
  model: string
  period_start: string | null
  period_end: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  cache_creation_tokens: number | null
  cache_read_tokens: number | null
  total_tokens: number | null
  cost: number | null
  currency: string | null
  source: string
  session_id: string | null
  message_id: string | null
  agent_label: string | null
  captured_at: string
}

/** 按供应商+模型分组的聚合行(含各类 token 与存储成本)。 */
interface SpendGroupRow {
  provider_id: string
  billing_scope: string
  model: string
  pt: number
  ct: number
  crt: number
  cct: number
  n: number
  stored_cost?: number | null | undefined
}

/** 待定价的用量分组(含 token 数量与已存储成本、首选币种)。 */
interface PricedUsageGroup {
  providerId: string
  model: string
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  storedCost?: number | null | undefined
  preferredCurrency?: string | null | undefined
  billingScope?: string | null | undefined
}

/** 查找用量分组的定价:先按供应商+模型,再仅按模型回退。(内部辅助函数) */
function findPricingForUsage(
  providerId: string,
  model: string,
  preferredCurrency?: string,
  billingScope?: string
) {
  return (
    findPricing(providerId, model, preferredCurrency, billingScope) ??
    findPricingByModel(model, preferredCurrency, billingScope)
  )
}

/** 按 token 用量与定价配置计算成本,无定价时回退存储成本。(内部辅助函数) */
function priceUsageGroup(group: PricedUsageGroup): {
  cost: number | null
  currency: string | null
  priced: boolean
} {
  const pricing = findPricingForUsage(
    group.providerId,
    group.model,
    group.preferredCurrency ?? undefined,
    group.billingScope ?? undefined
  )
  if (!pricing) {
    return {
      cost: group.storedCost ?? null,
      currency: group.preferredCurrency ?? null,
      priced: false
    }
  }
  return {
    cost: calcCost(
      group.promptTokens,
      group.completionTokens,
      pricing.promptPricePerMtok,
      pricing.completionPricePerMtok,
      group.cacheReadTokens,
      group.cacheCreationTokens,
      pricing.cacheReadPricePerMtok,
      pricing.cacheCreationPricePerMtok
    ),
    currency: pricing.currency,
    priced: true
  }
}

/** 从按币种汇总的 Map 中取金额最大的币种作为主币种,无数据时默认 CNY。(内部辅助函数) */
function primaryCurrencyAmount(byCurrency: Map<string, number>): {
  currency: string
  total: number
} {
  const primary = [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, total: amount }))
    .sort((a, b) => b.total - a.total)[0]
  return primary ?? { currency: 'CNY', total: 0 }
}

/** 将数据库行映射为 UsageRecord 对象,可选按定价配置重新计算成本。(内部辅助函数) */
function rowToRecord(r: DbRow, options: { priceFromConfig?: boolean } = {}): UsageRecord {
  const priced = options.priceFromConfig
    ? priceUsageGroup({
        providerId: r.provider_id,
        billingScope: r.billing_scope,
        model: r.model,
        promptTokens: r.prompt_tokens ?? 0,
        completionTokens: r.completion_tokens ?? 0,
        cacheReadTokens: r.cache_read_tokens ?? 0,
        cacheCreationTokens: r.cache_creation_tokens ?? 0,
        storedCost: r.cost,
        preferredCurrency: r.currency
      })
    : null
  const cost = priced?.cost ?? r.cost
  const currency = priced?.currency ?? r.currency
  return {
    providerId: r.provider_id,
    billingScope: normalizeBillingScope(r.billing_scope),
    model: r.model,
    source: r.source as UsageRecord['source'],
    capturedAt: r.captured_at,
    ...(r.id !== null ? { id: r.id } : {}),
    ...(r.api_key_id !== null ? { apiKeyId: r.api_key_id } : {}),
    ...(r.period_start !== null ? { periodStart: r.period_start } : {}),
    ...(r.period_end !== null ? { periodEnd: r.period_end } : {}),
    ...(r.prompt_tokens !== null ? { promptTokens: r.prompt_tokens } : {}),
    ...(r.completion_tokens !== null ? { completionTokens: r.completion_tokens } : {}),
    ...(r.cache_creation_tokens !== null ? { cacheCreationTokens: r.cache_creation_tokens } : {}),
    ...(r.cache_read_tokens !== null ? { cacheReadTokens: r.cache_read_tokens } : {}),
    ...(r.total_tokens !== null ? { totalTokens: r.total_tokens } : {}),
    ...(cost !== null ? { cost } : {}),
    ...(currency !== null ? { currency } : {}),
    ...(r.session_id !== null ? { sessionId: r.session_id } : {}),
    ...(r.message_id !== null ? { messageId: r.message_id } : {}),
    ...(r.agent_label !== null ? { agentLabel: r.agent_label } : {})
  }
}

/**
 * 批量插入用量记录(INSERT OR IGNORE 去重),依赖 v2 schema 的两条 UNIQUE 约束:
 *   - UNIQUE(source, provider_id, model, period_start) 对 vendor-api 去重
 *   - UNIQUE(source, message_id) 对 session-log 去重(message_id 为 NULL 时该约束不生效)
 * 重新刷新不会插入重复行,避免仪表盘 SUM(cost) 虚高。(glm-5.2)
 * @param records 待插入的用量记录数组
 * @returns 插入数与跳过数(去重命中)
 */
export function insertUsage(records: UsageRecord[]): { inserted: number; skipped: number } {
  const db = getDb()
  // INSERT OR IGNORE relies on two UNIQUE constraints (added in schema v2, N2):
  //   - UNIQUE(source, provider_id, model, period_start) dedupes vendor-api
  //     slices (which have no message_id) so re-running a usage refresh does
  //     not insert duplicate rows and inflate dashboard SUM(cost).
  //   - UNIQUE(source, message_id) dedupes session-log entries by message id.
  //     When message_id is NULL (vendor-api), this constraint is a no-op
  //     (NULL != NULL in SQLite), so the business-key constraint above governs.
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO usage_records (
      api_key_id, provider_id, billing_scope, model, period_start, period_end,
      prompt_tokens, completion_tokens, cache_creation_tokens, cache_read_tokens,
      total_tokens, cost, currency, source, session_id, message_id, agent_label, captured_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  let inserted = 0
  let skipped = 0
  const tx = db.transaction((rows: UsageRecord[]) => {
    for (const r of rows) {
      const res = stmt.run(
        r.apiKeyId ?? null,
        r.providerId,
        normalizeBillingScope(r.billingScope),
        r.model,
        r.periodStart ?? null,
        r.periodEnd ?? null,
        r.promptTokens ?? null,
        r.completionTokens ?? null,
        r.cacheCreationTokens ?? null,
        r.cacheReadTokens ?? null,
        r.totalTokens ?? null,
        r.cost ?? null,
        r.currency ?? null,
        r.source,
        r.sessionId ?? null,
        r.messageId ?? null,
        r.agentLabel ?? null,
        r.capturedAt
      )
      if (res.changes > 0) inserted++
      else skipped++
    }
  })
  tx(records)
  return { inserted, skipped }
}

/**
 * 按条件查询用量记录(支持供应商/时间/来源/模型模糊匹配),结果按时间降序,读取时按定价配置重算成本。
 * @param filter 过滤条件(均为可选)
 * @param filter.providerId 供应商 ID
 * @param filter.fromISO 起始时间(ISO)
 * @param filter.toISO 截止时间(ISO)
 * @param filter.source 来源
 * @param filter.limit 返回上限(默认 500)
 * @param filter.modelContains 模型名模糊匹配(不区分大小写)
 * @returns 用量记录数组
 */
export function queryUsage(filter: {
  providerId?: string
  fromISO?: string
  toISO?: string
  source?: string
  limit?: number
  modelContains?: string
}): UsageRecord[] {
  const db = getDb()
  const clauses: string[] = []
  const args: unknown[] = []
  if (filter.providerId) {
    clauses.push('provider_id = ?')
    args.push(filter.providerId)
  }
  if (filter.fromISO) {
    clauses.push('captured_at >= ?')
    args.push(filter.fromISO)
  }
  if (filter.toISO) {
    clauses.push('captured_at <= ?')
    args.push(filter.toISO)
  }
  if (filter.source) {
    clauses.push('source = ?')
    args.push(filter.source)
  }
  if (filter.modelContains?.trim()) {
    clauses.push('LOWER(model) LIKE LOWER(?)')
    args.push(`%${filter.modelContains.trim()}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const limit = filter.limit ?? 500
  const rows = db
    .prepare(`SELECT * FROM usage_records ${where} ORDER BY captured_at DESC LIMIT ?`)
    .all(...args, limit) as DbRow[]
  return rows.map((r) => rowToRecord(r, { priceFromConfig: true }))
}

/**
 * 分页查询用量记录,返回分页结构(含 total/limit/offset)。
 * @param filter 过滤条件(同 queryUsage,额外支持 offset)
 * @returns 分页结果对象(rows + total + limit + offset)
 */
export function queryUsagePage(filter: {
  providerId?: string
  fromISO?: string
  toISO?: string
  source?: string
  limit?: number
  offset?: number
  modelContains?: string
}): UsageLogPage {
  const db = getDb()
  const clauses: string[] = []
  const args: unknown[] = []
  if (filter.providerId) {
    clauses.push('provider_id = ?')
    args.push(filter.providerId)
  }
  if (filter.fromISO) {
    clauses.push('captured_at >= ?')
    args.push(filter.fromISO)
  }
  if (filter.toISO) {
    clauses.push('captured_at <= ?')
    args.push(filter.toISO)
  }
  if (filter.source) {
    clauses.push('source = ?')
    args.push(filter.source)
  }
  if (filter.modelContains?.trim()) {
    clauses.push('LOWER(model) LIKE LOWER(?)')
    args.push(`%${filter.modelContains.trim()}%`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const limit = filter.limit ?? 100
  const offset = filter.offset ?? 0
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM usage_records ${where}`)
    .get(...args) as { total: number }
  const rows = db
    .prepare(`SELECT * FROM usage_records ${where} ORDER BY captured_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as DbRow[]
  return {
    rows: rows.map((r) => rowToRecord(r, { priceFromConfig: true })),
    total: totalRow.total,
    limit,
    offset
  }
}

/**
 * 仪表盘汇总:计算指定天数内的总成本、token 总量、按供应商占比与每日趋势。
 * @param days 统计天数(<=0 表示全部历史),默认 30
 * @returns 含总成本/token/供应商占比/每日趋势的汇总对象
 */
export function getDashboardSummary(days = 30): {
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalRequests: number
  providers: Array<{ providerId: string; cost: number; tokens: number; pct: number }>
  daily: Array<{ date: string; cost: number; tokens: number }>
} {
  const db = getDb()
  const allTime = days <= 0
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const where = allTime ? '' : 'WHERE captured_at >= ?'
  const args = allTime ? [] : [since]

  const totals = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(prompt_tokens), 0) AS totalInputTokens,
      COALESCE(SUM(completion_tokens), 0) AS totalOutputTokens,
      COALESCE(SUM(cache_read_tokens), 0) AS totalCacheReadTokens,
      COUNT(*) AS totalRequests
    FROM usage_records ${where}
  `
    )
    .get(...args) as {
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalRequests: number
  }

  const costGroups = db
    .prepare(
      `
    SELECT provider_id, billing_scope, model,
           COALESCE(SUM(prompt_tokens), 0) AS pt,
           COALESCE(SUM(completion_tokens), 0) AS ct,
           COALESCE(SUM(cache_read_tokens), 0) AS crt,
           COALESCE(SUM(cache_creation_tokens), 0) AS cct,
           COALESCE(SUM(cost), 0) AS stored_cost,
           COUNT(*) AS n
    FROM usage_records ${where}
    GROUP BY provider_id, billing_scope, model
  `
    )
    .all(...args) as SpendGroupRow[]

  const providerTotals = new Map<string, { cost: number; tokens: number }>()
  let totalCost = 0
  for (const g of costGroups) {
    const priced = priceUsageGroup({
      providerId: g.provider_id,
      billingScope: g.billing_scope,
      model: g.model,
      promptTokens: g.pt,
      completionTokens: g.ct,
      cacheReadTokens: g.crt,
      cacheCreationTokens: g.cct,
      storedCost: g.stored_cost
    })
    const cost = priced.cost ?? 0
    totalCost += cost
    const cur = providerTotals.get(g.provider_id) ?? { cost: 0, tokens: 0 }
    cur.cost += cost
    cur.tokens += g.pt + g.ct
    providerTotals.set(g.provider_id, cur)
  }

  const providers = [...providerTotals.entries()]
    .map(([providerId, p]) => ({
      providerId,
      cost: p.cost,
      tokens: p.tokens,
      pct: computeProviderPct(p.cost, totalCost)
    }))
    .sort((a, b) => b.cost - a.cost)

  const dailyGroups = db
    .prepare(
      `
    SELECT substr(captured_at, 1, 10) AS date,
           provider_id,
           billing_scope,
           model,
           COALESCE(SUM(prompt_tokens), 0) AS pt,
           COALESCE(SUM(completion_tokens), 0) AS ct,
           COALESCE(SUM(cache_read_tokens), 0) AS crt,
           COALESCE(SUM(cache_creation_tokens), 0) AS cct,
           COALESCE(SUM(cost), 0) AS stored_cost
    FROM usage_records ${where}
    GROUP BY date, provider_id, billing_scope, model ORDER BY date ASC
  `
    )
    .all(...args) as Array<SpendGroupRow & { date: string }>

  const dailyMap = new Map<string, { date: string; cost: number; tokens: number }>()
  for (const g of dailyGroups) {
    const priced = priceUsageGroup({
      providerId: g.provider_id,
      billingScope: g.billing_scope,
      model: g.model,
      promptTokens: g.pt,
      completionTokens: g.ct,
      cacheReadTokens: g.crt,
      cacheCreationTokens: g.cct,
      storedCost: g.stored_cost
    })
    const cur = dailyMap.get(g.date) ?? { date: g.date, cost: 0, tokens: 0 }
    cur.cost += priced.cost ?? 0
    cur.tokens += g.pt + g.ct
    dailyMap.set(g.date, cur)
  }

  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))

  return {
    totalCost,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalCacheReadTokens: totals.totalCacheReadTokens,
    totalRequests: totals.totalRequests,
    providers,
    daily
  }
}

/**
 * On-demand total spend computed from raw request logs × current pricing config
 * (rather than the stored `cost` column, which is 0 when pricing wasn't applied
 * at ingest time). Groups usage by (provider, model), prices each group via
 * findPricing + calcCost, and aggregates by currency. The "primary" currency is
 * whichever accumulates the largest amount (default 'CNY' when nothing priced).
 * 按原始用量×当前定价实时计算总消费(而非入库时存储的 cost 列),按币种汇总;主币种为金额最大者。(glm-5.2)
 */
export function computeTotalSpend(days = 30): TotalSpendSummary {
  const db = getDb()
  const allTime = days <= 0
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const where = allTime ? '' : 'WHERE captured_at >= ?'
  const args = allTime ? [] : [since]

  const groups = db
    .prepare(
      `
    SELECT provider_id, billing_scope, model,
           COALESCE(SUM(prompt_tokens), 0) AS pt,
           COALESCE(SUM(completion_tokens), 0) AS ct,
           COALESCE(SUM(cache_read_tokens), 0) AS crt,
           COALESCE(SUM(cache_creation_tokens), 0) AS cct,
           COUNT(*) AS n
    FROM usage_records ${where}
    GROUP BY provider_id, billing_scope, model
  `
    )
    .all(...args) as Array<{
    provider_id: string
    billing_scope: string
    model: string
    pt: number
    ct: number
    crt: number
    cct: number
    n: number
  }>

  const byCurrency = new Map<string, number>()
  let pricedRequests = 0
  let unpricedRequests = 0
  let totalRequests = 0

  for (const g of groups) {
    totalRequests += g.n
    const p = findPricingForUsage(g.provider_id, g.model, undefined, g.billing_scope)
    if (!p) {
      unpricedRequests += g.n
      continue
    }
    const cost = calcCost(
      g.pt,
      g.ct,
      p.promptPricePerMtok,
      p.completionPricePerMtok,
      g.crt,
      g.cct,
      p.cacheReadPricePerMtok,
      p.cacheCreationPricePerMtok
    )
    byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? 0) + cost)
    pricedRequests += g.n
  }

  const sorted = [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount)

  const primary = sorted[0]
  const conversion = convertSpendToCny({ byCurrency: sorted })
  return {
    total: primary?.amount ?? 0,
    currency: primary?.currency ?? 'CNY',
    byCurrency: sorted,
    ...conversion,
    pricedRequests,
    unpricedRequests,
    totalRequests
  }
}

/**
 * 按模型维度聚合消费统计:含各模型的供应商列表、token 用量、成本与已定价/未定价请求数。
 * @param filter 时间范围过滤(可选 fromISO/toISO)
 * @returns 按总成本降序排列的模型消费聚合数组
 */
export function computeModelSpend(
  filter: { fromISO?: string; toISO?: string } = {}
): ModelSpendAggregate[] {
  const db = getDb()
  const clauses: string[] = []
  const args: unknown[] = []
  if (filter.fromISO) {
    clauses.push('captured_at >= ?')
    args.push(filter.fromISO)
  }
  if (filter.toISO) {
    clauses.push('captured_at <= ?')
    args.push(filter.toISO)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  const groups = db
    .prepare(
      `
    SELECT provider_id, billing_scope, model,
           COALESCE(SUM(prompt_tokens), 0) AS pt,
           COALESCE(SUM(completion_tokens), 0) AS ct,
           COALESCE(SUM(cache_read_tokens), 0) AS crt,
           COALESCE(SUM(cache_creation_tokens), 0) AS cct,
           COALESCE(SUM(total_tokens), 0) AS tt,
           COALESCE(SUM(cost), 0) AS stored_cost,
           COUNT(*) AS n
    FROM usage_records ${where}
    GROUP BY provider_id, billing_scope, model
  `
    )
    .all(...args) as Array<SpendGroupRow & { tt: number }>

  const byModel = new Map<
    string,
    {
      providers: Set<string>
      byCurrency: Map<string, number>
      tokens: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreationTokens: number
      requests: number
      pricedRequests: number
      unpricedRequests: number
    }
  >()

  for (const g of groups) {
    const model = g.model || '(unknown)'
    const row = byModel.get(model) ?? {
      providers: new Set<string>(),
      byCurrency: new Map<string, number>(),
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      requests: 0,
      pricedRequests: 0,
      unpricedRequests: 0
    }
    row.providers.add(g.provider_id)
    row.tokens += g.tt || g.pt + g.ct
    row.inputTokens += g.pt
    row.outputTokens += g.ct
    row.cacheReadTokens += g.crt
    row.cacheCreationTokens += g.cct
    row.requests += g.n

    const priced = priceUsageGroup({
      providerId: g.provider_id,
      billingScope: g.billing_scope,
      model: g.model,
      promptTokens: g.pt,
      completionTokens: g.ct,
      cacheReadTokens: g.crt,
      cacheCreationTokens: g.cct,
      storedCost: g.stored_cost
    })
    if (priced.priced && priced.currency) {
      row.byCurrency.set(
        priced.currency,
        (row.byCurrency.get(priced.currency) ?? 0) + (priced.cost ?? 0)
      )
      row.pricedRequests += g.n
    } else {
      if (priced.cost !== null) {
        const currency = priced.currency ?? 'CNY'
        row.byCurrency.set(currency, (row.byCurrency.get(currency) ?? 0) + priced.cost)
      }
      row.unpricedRequests += g.n
    }
    byModel.set(model, row)
  }

  return [...byModel.entries()]
    .map(([model, row]) => {
      const primary = primaryCurrencyAmount(row.byCurrency)
      return {
        model,
        providers: [...row.providers].sort(),
        total: primary.total,
        currency: primary.currency,
        byCurrency: [...row.byCurrency.entries()]
          .map(([currency, amount]) => ({ currency, amount }))
          .sort((a, b) => b.amount - a.amount),
        tokens: row.tokens,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        requests: row.requests,
        pricedRequests: row.pricedRequests,
        unpricedRequests: row.unpricedRequests
      }
    })
    .sort((a, b) => b.total - a.total || b.tokens - a.tokens || a.model.localeCompare(b.model))
}

/**
 * Per-key spend estimate. Same algorithm as {@link computeTotalSpend} but
 * filtered to a single `apiKeyId` and a single window. Used by the API Keys
 * page to render a "本月消费估算 ¥xx.xx" card.
 *
 * Vendors that don't fill `model` on usage records (most admin endpoints,
 * some third-party gateways) will have their rows fall into `unpricedRequests`
 * because `findPricing` keys on (provider_id, billing_scope, model). The renderer should
 * surface this gap so users can either configure pricing or check the
 * provider's own dashboard.
 * 按密钥维度的消费估算:无直接归属行时,用该密钥所属供应商的定价表对未归属的 session-log 行进行估算。(glm-5.2)
 */
export function computeSpendByKey(apiKeyId: string, days = 30): KeySpendSummary {
  const db = getDb()
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  const key = db
    .prepare('SELECT provider_id, base_url_override FROM api_keys WHERE id = ?')
    .get(apiKeyId) as { provider_id: string; base_url_override: string | null } | undefined
  const keyBillingScope = key
    ? resolveBillingScope(key.provider_id, key.base_url_override)
    : 'default'

  let groups = db
    .prepare(
      `
    SELECT provider_id, billing_scope, model,
           COALESCE(SUM(prompt_tokens), 0) AS pt,
           COALESCE(SUM(completion_tokens), 0) AS ct,
           COALESCE(SUM(cache_read_tokens), 0) AS crt,
           COALESCE(SUM(cache_creation_tokens), 0) AS cct,
           COUNT(*) AS n
    FROM usage_records
    WHERE api_key_id = ? AND captured_at >= ?
    GROUP BY provider_id, billing_scope, model
  `
    )
    .all(apiKeyId, since) as SpendGroupRow[]

  // Local Claude/Codex session logs usually cannot know which stored API key
  // paid for the request, so api_key_id is NULL and provider_id is the log
  // source (`claude-code` / `codex`). If a key has no directly attributed
  // vendor rows, estimate spend by matching unassigned session-log models
  // against that key's provider pricing table. This is what makes MiniMax /
  // GLM / DeepSeek Coding Plan keys show a useful estimate after log sync.
  const useProviderModelFallback = groups.length === 0 && key?.provider_id
  if (useProviderModelFallback) {
    groups = (
      db
        .prepare(
          `
      SELECT ? AS provider_id, ? AS billing_scope, model,
             COALESCE(SUM(prompt_tokens), 0) AS pt,
             COALESCE(SUM(completion_tokens), 0) AS ct,
             COALESCE(SUM(cache_read_tokens), 0) AS crt,
             COALESCE(SUM(cache_creation_tokens), 0) AS cct,
             COUNT(*) AS n
      FROM usage_records
      WHERE api_key_id IS NULL
        AND source = 'session-log'
        AND captured_at >= ?
        AND EXISTS (
          SELECT 1 FROM pricing_entries p
          WHERE p.provider_id = ?
            AND p.model = usage_records.model
            AND p.billing_scope IN (?, 'default')
        )
      GROUP BY model
    `
        )
        .all(
          key.provider_id,
          keyBillingScope,
          since,
          key.provider_id,
          keyBillingScope
        ) as SpendGroupRow[]
    ).map((g) => ({
      ...g,
      provider_id: key.provider_id,
      billing_scope: keyBillingScope
    }))
  }

  const byCurrency = new Map<string, number>()
  const modelSet = new Set<string>()
  let pricedRequests = 0
  let unpricedRequests = 0
  let totalRequests = 0

  for (const g of groups) {
    totalRequests += g.n
    modelSet.add(g.model)
    const p = findPricingForUsage(g.provider_id, g.model, undefined, g.billing_scope)
    if (!p) {
      unpricedRequests += g.n
      continue
    }
    const cost = calcCost(
      g.pt,
      g.ct,
      p.promptPricePerMtok,
      p.completionPricePerMtok,
      g.crt,
      g.cct,
      p.cacheReadPricePerMtok,
      p.cacheCreationPricePerMtok
    )
    byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? 0) + cost)
    pricedRequests += g.n
  }

  const sorted = [...byCurrency.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount)
  const primary = sorted[0]

  return {
    apiKeyId,
    days,
    total: primary?.amount ?? 0,
    currency: primary?.currency ?? 'CNY',
    byCurrency: sorted,
    pricedRequests,
    unpricedRequests,
    totalRequests,
    models: Array.from(modelSet).sort()
  }
}
