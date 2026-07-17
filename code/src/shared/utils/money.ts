/**
 * 金额与 Token 计数工具:基于 decimal.js 提供高精度货币换算与格式化,
 * 避免浮点累加误差。供 Dashboard / ProviderSummary / ModelCompare 等页面使用。
 * (glm-5.2)
 */
import Decimal from 'decimal.js'

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })

/** 将任意数值/字符串安全转为 Decimal,null/undefined 视为 0。 */
export function toDecimal(n: number | string | null | undefined): Decimal {
  if (n === null || n === undefined) return new Decimal(0)
  return new Decimal(n)
}

/** 按币种格式化金额:¥/$/€ 等,保留两位小数。 */
export function fmtMoney(n: number | string, currency = 'CNY'): string {
  const d = toDecimal(n)
  const symbols: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' }
  const sym = symbols[currency] ?? `${currency} `
  return `${sym}${d.toFixed(2)}`
}

/** 汇率来源类型:实时 API / 兜底默认值 / 混合 / 无可用汇率。 */
export type ExchangeRateSource = 'api' | 'fallback' | 'mixed' | 'none'

/** 转换为 CNY 的输入:按币种分组的金额 + 可选汇率表与来源。 */
export interface CnyConversionInput {
  byCurrency: Array<{ currency: string; amount: number }>
  ratesToCny?: Record<string, number | undefined>
  rateSource?: ExchangeRateSource
  updatedAt?: string | undefined
}

/** 转换为 CNY 的结果:总 CNY、逐币种明细、未转换币种列表。 */
export interface CnyConversionResult {
  cnyTotal: number
  convertedByCurrency: Array<{
    currency: string
    amount: number
    rateToCny: number
    cnyAmount: number
  }>
  exchangeRateSource: ExchangeRateSource
  exchangeRateUpdatedAt?: string
  unconvertedCurrencies: string[]
}

/** 默认 CNY 汇率兜底表(无实时汇率时使用)。 */
export const DEFAULT_CNY_RATES: Record<string, number> = {
  CNY: 1,
  RMB: 1,
  USD: 7.0511,
  EUR: 8.1
}

/** 规范化币种代码:去空白、转大写,空值默认 CNY。 */
export function normalizeCurrency(currency: string | null | undefined): string {
  return (currency ?? 'CNY').trim().toUpperCase() || 'CNY'
}

/** 把多币种花费按汇率统一换算为 CNY,返回汇总与明细。 */
export function convertSpendToCny(input: CnyConversionInput): CnyConversionResult {
  const rates = input.ratesToCny ?? DEFAULT_CNY_RATES
  const convertedByCurrency: CnyConversionResult['convertedByCurrency'] = []
  const unconvertedCurrencies: string[] = []
  let total = new Decimal(0)

  for (const row of input.byCurrency) {
    const currency = normalizeCurrency(row.currency)
    const rate = currency === 'CNY' || currency === 'RMB' ? 1 : rates[currency]
    if (!Number.isFinite(rate)) {
      if (row.amount !== 0 && !unconvertedCurrencies.includes(currency)) {
        unconvertedCurrencies.push(currency)
      }
      continue
    }
    const cnyAmount = toDecimal(row.amount).mul(rate!).toDecimalPlaces(8).toNumber()
    convertedByCurrency.push({
      currency,
      amount: row.amount,
      rateToCny: rate!,
      cnyAmount
    })
    total = total.plus(cnyAmount)
  }

  const result: CnyConversionResult = {
    cnyTotal: Number(total.toDecimalPlaces(8).toString()),
    convertedByCurrency,
    exchangeRateSource: input.rateSource ?? (convertedByCurrency.length ? 'fallback' : 'none'),
    unconvertedCurrencies
  }
  if (input.updatedAt !== undefined) {
    result.exchangeRateUpdatedAt = input.updatedAt
  }
  return result
}

/**
 * 根据各分项 token 数量与每百万 token 单价计算总费用。
 * 支持 prompt / completion / 缓存读 / 缓存创建四档计价,负值视为 0。
 */
export function calcCost(
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
  promptPerMtok: number | string | null | undefined,
  completionPerMtok: number | string | null | undefined,
  cacheReadTokens?: number | null,
  cacheCreationTokens?: number | null,
  cacheReadPerMtok?: number | string | null,
  cacheCreationPerMtok?: number | string | null
): number {
  const pt = promptTokens ?? 0
  const ct = completionTokens ?? 0
  const crt = cacheReadTokens ?? 0
  const cct = cacheCreationTokens ?? 0
  if (pt < 0 || ct < 0 || crt < 0 || cct < 0) return 0
  const p = toDecimal(pt)
    .mul(toDecimal(promptPerMtok ?? 0))
    .div(1_000_000)
  const c = toDecimal(ct)
    .mul(toDecimal(completionPerMtok ?? 0))
    .div(1_000_000)
  const cr = toDecimal(crt)
    .mul(toDecimal(cacheReadPerMtok ?? 0))
    .div(1_000_000)
  const cc = toDecimal(cct)
    .mul(toDecimal(cacheCreationPerMtok ?? 0))
    .div(1_000_000)
  return Number(p.plus(c).plus(cr).plus(cc).toFixed(8))
}

/** ponytail: percentage formatter — never returns "NaN%".
 *  - `null/undefined/NaN` → "—"
 *  - else → `${n.toFixed(1)}%`  (e.g. 12.345 → "12.3%")
 *  Used by ProviderSummary trend column. */
export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

/**
 ponytail: compact human-readable formatter for big token counts.
   - >= 1e8 → "1.23 亿"
   - >= 1e4 → "1.23 万"
   - else plain integer (e.g. 4321)
   Used by Dashboard hero card and ModelCompare / AgentDetail tiles.
 */
export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (abs >= 1e4) return `${(n / 1e4).toFixed(2)} 万`
  return Math.round(n).toLocaleString('en-US')
}
