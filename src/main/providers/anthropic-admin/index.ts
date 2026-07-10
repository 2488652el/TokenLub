/**
 * Anthropic Admin(org/管理后台)Provider 实现:通过 Anthropic Admin API
 * 拉取组织级用量与成本报告,作为余额与用量数据来源。
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

/** Anthropic Admin Provider 的清单常量。 (glm-5.2) */
const MANIFEST = {
  id: 'anthropic-admin',
  displayName: 'Anthropic Admin',
  category: 'admin-org' as const,
  features: ['balance', 'usage', 'cost'] as const,
  docsUrl: 'https://docs.claude.com/en/api/admin-api/usage-cost'
}

/** Anthropic 用量 API 响应结构。 (glm-5.2) */
interface UsageResp {
  data: Array<{
    starting_at: string
    ending_at: string
    results: Array<{
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }>
  }>
  has_more: boolean
  next_page?: string
}

/** Anthropic 成本报告 API 响应结构。 (glm-5.2) */
interface CostResp {
  data: Array<{
    starting_at: string
    ending_at: string
    results: Array<{ amount: string; cost_type?: string }>
  }>
}

/** Anthropic Admin Provider 实现,提供 balance(当月成本合计)、usage 与连接测试。 (glm-5.2) */
export const anthropicAdminProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: true,
  build(creds: ProviderCredentials): ProviderCapabilities {
    const adminKey = creds.extra?.['adminKey'] ?? creds.apiKey
    const http = new ProviderHttpClient({
      baseUrl: creds.baseUrl || 'https://api.anthropic.com',
      auth: { type: 'x-api-key', header: 'x-api-key', token: adminKey },
      providerId: MANIFEST.id,
      extraHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'usage-cost-api-2025-05-20'
      }
    })

    return {
      balance: async (): Promise<BalanceSnapshot> => {
        // Anthropic has no native "balance" — return sum of cost_report for current month
        const now = new Date()
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const endOfMonth = now.toISOString()
        const body = await http.getJSON<CostResp>(
          `/v1/organizations/cost_report?start_time=${encodeURIComponent(startOfMonth)}&end_time=${encodeURIComponent(endOfMonth)}&bucket_width=1d`
        )
        const total = (body.data ?? []).reduce(
          (bucketSum, b) =>
            bucketSum +
            (b.results ?? []).reduce((s, r) => {
              const n = Number(r.amount)
              return s + (Number.isFinite(n) ? n : 0)
            }, 0),
          0
        )
        return {
          providerId: MANIFEST.id,
          capturedAt: now.toISOString(),
          used: total,
          currency: 'USD',
          raw: body
        }
      },
      usage: async (fromISO: string, toISO: string): Promise<UsageSlice[]> => {
        // Anthropic /v1/organizations/usage has no model in results.
        // Use a placeholder model label so dashboard GROUP BY model doesn't collapse to NULL.
        // Real model breakdown requires /v1/organizations/usage_by_model which we can add later.
        const body = await http.getJSON<UsageResp>(
          `/v1/organizations/usage?start_time=${encodeURIComponent(fromISO)}&end_time=${encodeURIComponent(toISO)}&bucket_width=1d`
        )
        return (body.data ?? []).flatMap((bucket) =>
          (bucket.results ?? []).map((r) => {
            const slice: UsageSlice = {
              providerId: MANIFEST.id,
              periodStart: bucket.starting_at,
              periodEnd: bucket.ending_at,
              model: 'anthropic-org-aggregate',
              source: 'vendor-api',
              raw: r
            }
            if (typeof r.input_tokens === 'number') slice.promptTokens = r.input_tokens
            if (typeof r.output_tokens === 'number') slice.completionTokens = r.output_tokens
            if (typeof r.cache_creation_input_tokens === 'number') {
              slice.cacheCreationTokens = r.cache_creation_input_tokens
            }
            if (typeof r.cache_read_input_tokens === 'number') {
              slice.cacheReadTokens = r.cache_read_input_tokens
            }
            return slice
          })
        )
      },
      testConnection: async () => {
        try {
          const now = new Date()
          const start = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
          await http.getJSON<UsageResp>(
            `/v1/organizations/usage?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(now.toISOString())}&bucket_width=1d`
          )
          return { ok: true, message: 'Anthropic Admin usage endpoint reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
