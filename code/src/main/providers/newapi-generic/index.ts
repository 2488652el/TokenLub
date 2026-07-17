/**
 * NewAPI / OneAPI 通用供应商实现:通过 /api/user/self 接口查询用户配额与已用额度。
 * 该模块属于 main 进程的 providers 模块,支持自建 OneAPI/NewAPI 网关的余额查询。
 * (glm-5.2)
 */
import type {
  ProviderImpl,
  ProviderCredentials,
  ProviderCapabilities,
  BalanceSnapshot
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** 供应商清单:标识、显示名、分类、特性及文档地址(指向 OneAPI 仓库)。 */
const MANIFEST = {
  id: 'newapi-generic',
  displayName: 'NewAPI / OneAPI Generic',
  category: 'newapi-generic' as const,
  features: ['balance'] as const,
  docsUrl: 'https://github.com/songquanpeng/one-api'
}

/**
 * /api/user/self 接口返回结构。
 * quota 为剩余配额(1 quota = 0.002 USD),used_quota 为累计消费,余额为旧字段。
 */
interface UserSelfResp {
  id: number
  username: string
  display_name?: string
  role: number
  quota: number // 1 quota = $0.002 in OneAPI
  used_quota: number
  // legacy: topup/balance fields
  balance?: number
}

/**
 * NewAPI 通用供应商实现对象。
 * - hasBalanceApi: 支持
 * - hasUsageApi: 不支持
 * - build: 校验必填 baseUrl 后构造余额查询能力
 */
export const newapiGenericProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  /** 构造供应商能力对象,要求提供 baseUrl。 */
  build(creds: ProviderCredentials): ProviderCapabilities {
    if (!creds.baseUrl) {
      throw new Error('newapi-generic requires a baseUrl (e.g. https://your-newapi.example.com)')
    }
    const http = new ProviderHttpClient({
      baseUrl: creds.baseUrl,
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    return {
      balance: async (): Promise<BalanceSnapshot> => {
        const body = await http.getJSON<UserSelfResp>('/api/user/self')
        // OneAPI semantics (from source):
        //   - `quota`      = user's REMAINING credit balance (in quota units)
        //   - `used_quota` = LIFETIME cumulative spend (grows forever)
        //   - 1 quota = 0.002 USD
        // We display:
        //   - remaining = quota * 0.002
        //   - used      = used_quota * 0.002  (lifetime; not the same as monthly cap)
        //   - total     = omitted — OneAPI has no fixed cap concept; users top up freely
        const QUOTA_TO_USD = 0.002
        const remainingUsd = body.quota * QUOTA_TO_USD
        const usedUsd = body.used_quota * QUOTA_TO_USD
        return {
          providerId: MANIFEST.id,
          capturedAt: new Date().toISOString(),
          remaining: remainingUsd,
          used: usedUsd,
          currency: 'USD',
          raw: body
        }
      },
      testConnection: async () => {
        try {
          const body = await http.getJSON<UserSelfResp>('/api/user/self')
          return { ok: !!body.username, message: `NewAPI user=${body.username}` }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
