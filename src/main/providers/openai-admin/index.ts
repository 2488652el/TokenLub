/**
 * OpenAI Admin 供应商实现:通过组织级 API 查询成本(costs)与用量(usage completions)。
 * 该模块属于 main 进程的 providers 模块,使用 admin/org 密钥访问 OpenAI 的 /organization 端点。
 * (glm-5.2)
 */
import type {
  ProviderImpl,
  ProviderCredentials,
  ProviderCapabilities,
  BalanceSnapshot,
  UsageSlice
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** 供应商清单:标识、显示名、分类(admin-org)、特性(balance/usage/cost)及文档地址。 */
const MANIFEST = {
  id: 'openai-admin',
  displayName: 'OpenAI Admin',
  category: 'admin-org' as const,
  features: ['balance', 'usage', 'cost'] as const,
  docsUrl: 'https://platform.openai.com/docs/api-reference/usage'
}

/** 单个用量桶(bucket):包含起止时间戳与各模型的 token 统计结果数组。 */
interface UsageBucket {
  object?: string
  start_time: number // unix seconds
  end_time: number
  results: Array<{
    object: string
    input_tokens: number
    output_tokens: number
    input_cached_tokens?: number
    num_model_requests: number
    project_id?: string
    user_id?: string
    model: string
  }>
}

/** usage completions 接口返回结构,含分页信息。 */
interface UsageResp {
  object: string
  data: UsageBucket[]
  has_more: boolean
  next_page?: string
}

/** 单个成本桶:包含起止时间戳与各条目的金额/币种/项目。 */
interface CostBucket {
  start_time: number
  end_time: number
  results: Array<{
    object: string
    amount: { value: number; currency: string }
    line_item: string | null
    project_id: string | null
  }>
}

/** costs 接口返回结构,含分页信息。 */
interface CostResp {
  object: string
  data: CostBucket[]
  has_more: boolean
  next_page?: string
}

/** 将 Unix 秒级时间戳转换为 ISO 8601 字符串。 */
function unixToISO(s: number): string {
  return new Date(s * 1000).toISOString()
}

/**
 * OpenAI Admin 供应商实现对象。
 * - hasBalanceApi: 支持(通过 costs 端点)
 * - hasUsageApi: 支持(通过 usage completions 端点)
 * - build: 使用 adminKey 或 apiKey 构造能力对象
 */
export const openaiAdminProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: true,
  /** 构造供应商能力对象,优先使用 extra.adminKey 作为鉴权令牌。 */
  build(creds: ProviderCredentials): ProviderCapabilities {
    const adminKey = creds.extra?.['adminKey'] ?? creds.apiKey
    const http = new ProviderHttpClient({
      baseUrl: creds.baseUrl || 'https://api.openai.com/v1',
      auth: { type: 'bearer', token: adminKey },
      providerId: MANIFEST.id
    })

    return {
      balance: async (): Promise<BalanceSnapshot> => {
        const now = Math.floor(Date.now() / 1000)
        const startOfMonth = Math.floor(
          new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000
        )
        const body = await http.getJSON<CostResp>(
          `/organization/costs?start_time=${startOfMonth}&end_time=${now}&bucket_width=1d`
        )
        const total = (body.data ?? []).reduce(
          (sum, b) =>
            sum +
            (b.results ?? []).reduce((s, r) => {
              const v = r.amount?.value
              return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0)
            }, 0),
          0
        )
        return {
          providerId: MANIFEST.id,
          capturedAt: new Date().toISOString(),
          used: total,
          currency: 'USD',
          raw: body
        }
      },
      usage: async (fromISO: string, toISO: string): Promise<UsageSlice[]> => {
        const fromUnix = Math.floor(new Date(fromISO).getTime() / 1000)
        const toUnix = Math.floor(new Date(toISO).getTime() / 1000)
        const body = await http.getJSON<UsageResp>(
          `/organization/usage/completions?start_time=${fromUnix}&end_time=${toUnix}&bucket_width=1d`
        )
        return (body.data ?? []).flatMap((bucket) =>
          (bucket.results ?? []).map((r, index) => {
            const slice: UsageSlice = {
              providerId: MANIFEST.id,
              periodStart: unixToISO(bucket.start_time),
              periodEnd: unixToISO(bucket.end_time),
              model: r.model,
              source: 'vendor-api',
              upstreamDimension: openaiResultDimension(r, index),
              promptTokens: r.input_tokens,
              completionTokens: r.output_tokens,
              raw: r
            }
            if (typeof r.input_cached_tokens === 'number') {
              slice.cacheReadTokens = r.input_cached_tokens
            }
            return slice
          })
        )
      },
      testConnection: async () => {
        try {
          const now = Math.floor(Date.now() / 1000)
          await http.getJSON<UsageResp>(
            `/organization/usage/completions?start_time=${now - 86400}&end_time=${now}&bucket_width=1d`
          )
          return { ok: true, message: 'OpenAI Admin usage endpoint reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}

function openaiResultDimension(
  result: Pick<UsageBucket['results'][number], 'project_id' | 'user_id'>,
  index: number
): string {
  const dimensions = [
    result.project_id ? `project:${result.project_id}` : null,
    result.user_id ? `user:${result.user_id}` : null
  ].filter((value): value is string => value !== null)
  return dimensions.length > 0 ? dimensions.join('|') : `result:${index}`
}
