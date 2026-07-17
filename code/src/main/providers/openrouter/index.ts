/**
 * OpenRouter 供应商实现:通过 /auth/key 接口查询密钥的额度限制与用量。
 * 该模块属于 main 进程的 providers 模块,OpenRouter 为第三方模型路由服务,以 USD 计费。
 * (glm-5.2)
 */
import type {
  ProviderImpl,
  ProviderCredentials,
  ProviderCapabilities,
  BalanceSnapshot
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** 供应商清单:标识、显示名、分类(third-party)、特性(balance)及文档地址。 */
const MANIFEST = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  category: 'third-party' as const,
  features: ['balance'] as const,
  docsUrl: 'https://openrouter.ai/docs'
}

/** /auth/key 接口返回结构:含额度上限、剩余额度、累计用量及是否免费层。 */
interface AuthKeyResp {
  data?: {
    limit?: number | null
    limit_remaining?: number | null
    usage?: number
    is_free_tier?: boolean
  }
}

/**
 * OpenRouter 供应商实现对象。
 * - hasBalanceApi: 支持
 * - hasUsageApi: 不支持
 * - build: 构造余额查询能力
 */
export const openrouterProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  /** 构造供应商能力对象,创建指向 OpenRouter API 的 HTTP 客户端。 */
  build(creds: ProviderCredentials): ProviderCapabilities {
    const http = new ProviderHttpClient({
      baseUrl: creds.baseUrl || 'https://openrouter.ai/api/v1',
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    return {
      balance: async (): Promise<BalanceSnapshot> => {
        const body = await http.getJSON<AuthKeyResp>('/auth/key')
        const d = body.data
        const snap: BalanceSnapshot = {
          providerId: MANIFEST.id,
          capturedAt: new Date().toISOString(),
          currency: 'USD',
          raw: body
        }
        // OpenRouter semantics:
        // - `limit` is the credit cap; null means unlimited
        // - `limit_remaining` is current credits left
        // - `usage` is the lifetime USD spend — always set, even on free tier
        if (d?.limit != null) snap.total = d.limit
        if (d?.limit_remaining != null) snap.remaining = d.limit_remaining
        if (typeof d?.usage === 'number') snap.used = d.usage
        return snap
      },
      testConnection: async () => {
        try {
          await http.getJSON<AuthKeyResp>('/auth/key')
          return { ok: true, message: 'OpenRouter auth/key reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
