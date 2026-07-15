/**
 * 汇率转换服务:调用外部 API 将非 CNY 币种消费转换为人民币,失败时回退到默认汇率。
 * 该模块属于 main 进程的 services 模块,为仪表盘提供按币种汇总的 CNY 换算能力。
 * (glm-5.2)
 */
import { convertSpendToCny, DEFAULT_CNY_RATES, normalizeCurrency } from '@shared/utils/money'
import type { TotalSpendSummary } from '@shared/types/usage'
import type { CnyRateQuote } from '@shared/types/pricing'
import type { PricingExchangePolicy, PricingExchangePolicyConfig } from '@shared/types/pricing'
import { getSetting, setSetting } from '../store/settings-store'

/** 外部汇率 API 地址、公共演示账号 ID 与密钥。 */
const API_URL = 'https://cn.apihz.cn/api/jinrong/huilv.php'
const PUBLIC_DOC_ID = '88888888'
const PUBLIC_DOC_KEY = '88888888'
const FETCH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FALLBACK_CACHE_TTL_MS = 15 * 60 * 1000
const POLICY_KEY = 'pricing_exchange_policy'
const FIXED_RATES_KEY = 'pricing_exchange_fixed_rates'

const rateCache = new Map<string, { quote: CnyRateQuote; expiresAt: number }>()
const pendingRates = new Map<string, Promise<CnyRateQuote>>()

function readPolicy(): PricingExchangePolicyConfig {
  try {
    const policy = getSetting<PricingExchangePolicy>(POLICY_KEY)
    const fixedRates = getSetting<Record<string, number>>(FIXED_RATES_KEY)
    return {
      policy: policy === 'fallback' || policy === 'fixed' ? policy : 'realtime',
      fixedRates: fixedRates && typeof fixedRates === 'object' ? fixedRates : {}
    }
  } catch {
    return { policy: 'realtime', fixedRates: {} }
  }
}

export function getPricingExchangePolicy(): PricingExchangePolicyConfig {
  return readPolicy()
}

export function setPricingExchangePolicy(
  config: PricingExchangePolicyConfig
): PricingExchangePolicyConfig {
  const fixedRates = Object.fromEntries(
    Object.entries(config.fixedRates).filter(([, value]) => Number.isFinite(value) && value > 0)
  )
  setSetting(POLICY_KEY, config.policy)
  setSetting(FIXED_RATES_KEY, fixedRates)
  rateCache.clear()
  return { policy: config.policy, fixedRates }
}

/** 汇率 API 返回结构:含状态码、消息、更新时间与汇率值(数字或字符串)。 */
interface ExchangeApiResponse {
  code?: number
  msg?: string
  uptime?: string
  result?: number | string
  rate?: number | string
}

/**
 * 调用外部 API 获取指定币种到 CNY 的汇率。
 * @param currency 源币种代码(如 USD)
 * @returns 汇率数值与可选的更新时间;API 不可用时抛错
 */
async function fetchRateToCny(currency: string): Promise<{ rate: number; updatedAt?: string }> {
  const id = process.env.TOKENLUB_EXCHANGE_ID ?? process.env.TOKENSCOPE_EXCHANGE_ID ?? PUBLIC_DOC_ID
  const key =
    process.env.TOKENLUB_EXCHANGE_KEY ?? process.env.TOKENSCOPE_EXCHANGE_KEY ?? PUBLIC_DOC_KEY
  const url = new URL(API_URL)
  url.searchParams.set('id', id)
  url.searchParams.set('key', key)
  url.searchParams.set('from', currency)
  url.searchParams.set('to', 'CNY')
  url.searchParams.set('money', '1')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    throw new Error(`exchange rate API HTTP ${res.status}`)
  }
  const body = (await res.json()) as ExchangeApiResponse
  if (body.code !== 200) {
    throw new Error(body.msg ?? `exchange rate API code ${body.code ?? 'unknown'}`)
  }
  const rate = Number(body.rate ?? body.result)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`invalid exchange rate for ${currency}`)
  }
  return body.uptime !== undefined ? { rate, updatedAt: body.uptime } : { rate }
}

/** 获取兑人民币汇率；6 小时内复用缓存，远端失败时回退内置参考值。 */
export function getCnyRateQuote(currencyInput = 'USD'): Promise<CnyRateQuote> {
  const currency = normalizeCurrency(currencyInput)
  if (currency === 'CNY' || currency === 'RMB') {
    return Promise.resolve({ currency, rateToCny: 1, source: 'fallback' })
  }

  const policy = readPolicy()
  if (policy.policy === 'fallback') {
    const fallback = DEFAULT_CNY_RATES[currency]
    if (fallback && fallback > 0) {
      return Promise.resolve({ currency, rateToCny: fallback, source: 'fallback' })
    }
  }
  if (policy.policy === 'fixed') {
    const fixed = policy.fixedRates[currency]
    if (typeof fixed === 'number' && Number.isFinite(fixed) && fixed > 0) {
      return Promise.resolve({ currency, rateToCny: fixed, source: 'fallback' })
    }
    const fallback = DEFAULT_CNY_RATES[currency]
    if (fallback && fallback > 0) {
      return Promise.resolve({ currency, rateToCny: fallback, source: 'fallback' })
    }
  }

  const cached = rateCache.get(currency)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.quote)
  const pending = pendingRates.get(currency)
  if (pending) return pending

  const request = (async (): Promise<CnyRateQuote> => {
    let quote: CnyRateQuote
    try {
      const result = await fetchRateToCny(currency)
      quote = {
        currency,
        rateToCny: result.rate,
        source: 'api',
        ...(result.updatedAt ? { updatedAt: result.updatedAt } : {})
      }
    } catch {
      const fallback = DEFAULT_CNY_RATES[currency]
      if (!Number.isFinite(fallback) || fallback! <= 0) {
        throw new Error(`no CNY exchange rate available for ${currency}`)
      }
      quote = { currency, rateToCny: fallback!, source: 'fallback' }
    }
    rateCache.set(currency, {
      quote,
      expiresAt: Date.now() + (quote.source === 'api' ? CACHE_TTL_MS : FALLBACK_CACHE_TTL_MS)
    })
    return quote
  })().finally(() => pendingRates.delete(currency))

  pendingRates.set(currency, request)
  return request
}

/** 仅供测试清空模块级缓存。 */
export function clearExchangeRateCache(): void {
  rateCache.clear()
  pendingRates.clear()
}

/**
 * 为消费汇总追加 CNY 换算:对非 CNY 币种并发查询实时汇率,失败回退默认汇率。
 * @param summary 原始按币种汇总的消费数据
 * @returns 追加了 totalSpendCny、rateSource 等字段的汇总对象
 */
export async function withCnySpendConversion(
  summary: TotalSpendSummary
): Promise<TotalSpendSummary> {
  const currencies = summary.byCurrency
    .map((c) => normalizeCurrency(c.currency))
    .filter((currency) => currency !== 'CNY' && currency !== 'RMB')

  if (currencies.length === 0) {
    const conversion = convertSpendToCny({
      byCurrency: summary.byCurrency,
      ratesToCny: DEFAULT_CNY_RATES,
      rateSource: summary.byCurrency.length ? 'fallback' : 'none'
    })
    return { ...summary, ...conversion }
  }

  const rates: Record<string, number> = { ...DEFAULT_CNY_RATES }
  const usedApi = new Set<string>()
  let updatedAt: string | undefined

  await Promise.all(
    [...new Set(currencies)].map(async (currency) => {
      try {
        const result = await getCnyRateQuote(currency)
        rates[currency] = result.rateToCny
        if (result.source === 'api') usedApi.add(currency)
        updatedAt = updatedAt ?? result.updatedAt
      } catch {
        // Unknown currencies without a fallback remain unconverted.
      }
    })
  )

  const allNonCnyConvertedByApi =
    currencies.length > 0 && currencies.every((currency) => usedApi.has(currency))
  const conversion = convertSpendToCny({
    byCurrency: summary.byCurrency,
    ratesToCny: rates,
    rateSource: usedApi.size === 0 ? 'fallback' : allNonCnyConvertedByApi ? 'api' : 'mixed',
    updatedAt
  })
  return { ...summary, ...conversion }
}
