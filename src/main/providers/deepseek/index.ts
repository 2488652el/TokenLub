/**
 * DeepSeek Provider 实现:通过 DeepSeek 平台 API 读取账户余额,
 * 支持余额查询与连接测试(无用量 API)。
 * (glm-5.2)
 */
import type {
  ProviderImpl,
  ProviderCredentials,
  ProviderCapabilities,
  BalanceSnapshot
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** DeepSeek Provider 的清单常量。 (glm-5.2) */
const MANIFEST = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  category: 'third-party' as const,
  features: ['balance'] as const,
  docsUrl: 'https://platform.deepseek.com/api-docs/'
}

/** DeepSeek 余额 API 响应结构。 (glm-5.2) */
interface BalanceResp {
  is_available: boolean
  balance_infos: Array<{ currency: string; total_balance: string }>
}

/** DeepSeek Provider 实现,提供 balance 与连接测试。 (glm-5.2) */
export const deepseekProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  build(creds: ProviderCredentials): ProviderCapabilities {
    const http = new ProviderHttpClient({
      baseUrl: creds.baseUrl || 'https://api.deepseek.com',
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })
    return {
      balance: async (): Promise<BalanceSnapshot> => {
        const body = await http.getJSON<BalanceResp>('/user/balance')
        const info = body.balance_infos?.[0]
        const rawTotal = info ? Number(info.total_balance) : 0
        const total = Number.isFinite(rawTotal) ? rawTotal : 0
        return {
          providerId: MANIFEST.id,
          capturedAt: new Date().toISOString(),
          total,
          remaining: total,
          currency: info?.currency ?? 'CNY',
          raw: body
        }
      },
      testConnection: async () => {
        try {
          const snap = await http.getJSON<BalanceResp>('/user/balance')
          return { ok: !!snap.is_available, message: 'DeepSeek balance reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
