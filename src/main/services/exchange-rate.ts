/**
 * 汇率转换服务:调用外部 API 将非 CNY 币种消费转换为人民币,失败时回退到默认汇率。
 * 该模块属于 main 进程的 services 模块,为仪表盘提供按币种汇总的 CNY 换算能力。
 * (glm-5.2)
 */
import { convertSpendToCny, DEFAULT_CNY_RATES, normalizeCurrency } from '@shared/utils/money'
import type { TotalSpendSummary } from '@shared/types/usage'

/** 外部汇率 API 地址、公共演示账号 ID 与密钥。 */
const API_URL = 'https://cn.apihz.cn/api/jinrong/huilv.php'
const PUBLIC_DOC_ID = '88888888'
const PUBLIC_DOC_KEY = '88888888'

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

  const res = await fetch(url)
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
        const result = await fetchRateToCny(currency)
        rates[currency] = result.rate
        usedApi.add(currency)
        updatedAt = updatedAt ?? result.updatedAt
      } catch {
        // Keep the dashboard usable offline or when the public demo key is rate-limited.
        // 汇率获取失败时静默跳过,保持仪表盘在离线或公共密钥限流时仍可用。(glm-5.2)
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
