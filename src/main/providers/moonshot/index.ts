/**
 * Moonshot (Kimi) 供应商实现:基于 OpenAI 兼容协议探测账户余额。
 * 该模块属于 main 进程的 providers 模块,负责构造余额查询的 HTTP 客户端并返回标准化 BalanceSnapshot。
 * (glm-5.2)
 */
import type {
  ProviderImpl,
  ProviderCredentials,
  ProviderCapabilities,
  BalanceSnapshot
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** 供应商清单:标识、显示名、分类、特性及文档地址。 */
const MANIFEST = {
  id: 'moonshot',
  displayName: 'Moonshot / Kimi',
  category: 'token-plan' as const,
  features: ['balance'] as const,
  docsUrl: 'https://platform.moonshot.cn/docs'
}

// Note: /v1/users/me is the documented Moonshot user-info endpoint but the
// balance probe list below already covers all known shapes; we keep this
// comment so future additions can wire the user-info call.
// 保留此注释以便后续接入 user-info 接口;当前余额探测候选列表已覆盖所有已知返回形态。(glm-5.2)

/**
 * Moonshot 余额接口可能返回的多种形态。
 * - OpenAI 兼容形态:remaining / total
 * - 原生形态:data.balance / data.currency
 * - 订阅形态兜底:hard_limit_usd / soft_limit_usd
 */
interface BalanceResp {
  // OpenAI-compat shape
  remaining?: number
  total?: number
  // Native shape (some deployments)
  data?: { balance?: number; currency?: string }
  // Fallback
  hard_limit_usd?: number
  soft_limit_usd?: number
}

/**
 * Moonshot 供应商实现对象。
 * - hasBalanceApi: 支持
 * - hasUsageApi: 不支持
 * - build: 根据凭据构造余额查询能力
 */
export const moonshotProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  /** 构造供应商能力对象,根据 baseUrl 判定币种并创建 HTTP 客户端。 */
  build(creds: ProviderCredentials): ProviderCapabilities {
    const base = creds.baseUrl || 'https://api.moonshot.cn'
    // Overseas endpoint api.moonshot.ai bills in USD; domestic api.moonshot.cn bills in CNY.
    // 海外端点 api.moonshot.ai 以 USD 计费,国内 api.moonshot.cn 以 CNY 计费。(glm-5.2)
    const currency: 'CNY' | 'USD' = base.includes('.ai') ? 'USD' : 'CNY'
    const http = new ProviderHttpClient({
      baseUrl: base,
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    /** 依次尝试多个余额探测端点,返回第一个成功的标准化快照。 */
    async function tryFetchBalance(): Promise<BalanceSnapshot> {
      const candidates = [
        '/v1/users/me/balance',
        '/v1/dashboard/billing/credit_grants',
        '/v1/dashboard/billing/subscription'
      ]
      let lastErr: unknown
      for (const path of candidates) {
        try {
          const body = await http.getJSON<BalanceResp>(path)
          // /v1/dashboard/billing/credit_grants uses OpenAI's shape:
          //   { total_granted, total_used, total_available, ... }
          // /v1/dashboard/billing/subscription uses:
          //   { hard_limit_usd, soft_limit_usd } — hard_limit is the cap, not the remaining
          // /v1/users/me/balance uses Moonshot's native shape.
          let remaining = 0
          let total = 0
          if (path === '/v1/dashboard/billing/credit_grants') {
            // Prefer the OpenAI credit-grants shape if present
            const cg = body as BalanceResp & {
              total_available?: number
              total_granted?: number
              total_used?: number
            }
            remaining = cg.total_available ?? 0
            total = cg.total_granted ?? 0
          } else if (path === '/v1/dashboard/billing/subscription') {
            // subscription shape: hard_limit is the CAP, soft_limit is the THRESHOLD
            const sub = body as BalanceResp & { hard_limit_usd?: number; soft_limit_usd?: number }
            total = sub.hard_limit_usd ?? 0
            // remaining can't be derived from subscription alone — set to 0 unless /me/balance overrides
          } else {
            remaining = body.remaining ?? body.data?.balance ?? 0
            total = body.total ?? 0
          }
          return {
            providerId: MANIFEST.id,
            capturedAt: new Date().toISOString(),
            remaining,
            total,
            currency,
            raw: body
          }
        } catch (e) {
          lastErr = e
        }
      }
      throw lastErr
    }

    return {
      balance: tryFetchBalance,
      testConnection: async () => {
        try {
          await tryFetchBalance()
          return { ok: true, message: 'Moonshot balance reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
