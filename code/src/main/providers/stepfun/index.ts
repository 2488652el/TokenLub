/**
 * StepFun 阶跃星辰供应商实现:通过多个候选端点探测账户余额。
 * 该模块属于 main 进程的 providers 模块,StepFun 为第三方大模型平台,以 CNY 计费。
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
  id: 'stepfun',
  displayName: 'StepFun 阶跃星辰',
  category: 'third-party' as const,
  features: ['balance'] as const,
  docsUrl: 'https://platform.stepfun.com/docs'
}

/**
 * StepFun 余额接口可能返回的多种形态(社区文档)。
 * 包含 code/msg 包裹的 data 嵌套结构与平铺结构,字段值可能为字符串或数字。
 */
interface BalanceResp {
  // community-documented shape
  code?: number
  msg?: string
  data?: {
    balance?: number | string
    total_balance?: number | string
    used_balance?: number | string
    currency?: string
  }
  // alt shape
  balance?: number | string
  total_balance?: number | string
}

/** 将未知类型值(数字/字符串)安全转换为有限数字,无法转换时返回 0。 */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : 0
  return Number.isFinite(n) ? n : 0
}

/**
 * StepFun 供应商实现对象。
 * - hasBalanceApi: 支持
 * - hasUsageApi: 不支持
 * - build: 构造余额查询能力
 */
export const stepfunProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  /** 构造供应商能力对象,创建指向 StepFun API 的 HTTP 客户端。 */
  build(creds: ProviderCredentials): ProviderCapabilities {
    const http = new ProviderHttpClient({
      baseUrl: creds.baseUrl || 'https://api.stepfun.com',
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    /** 依次尝试多个余额端点,返回第一个成功的标准化快照。 */
    async function tryBalance(): Promise<BalanceSnapshot> {
      const candidates = ['/v1/account/balance', '/v1/account', '/v1/user/balance']
      let lastErr: unknown
      for (const path of candidates) {
        try {
          const body = await http.getJSON<BalanceResp>(path)
          const d = body.data
          const remaining = num(d?.balance ?? body.balance)
          const total = num(d?.total_balance ?? body.total_balance)
          return {
            providerId: MANIFEST.id,
            capturedAt: new Date().toISOString(),
            remaining,
            total,
            currency: d?.currency ?? 'CNY',
            raw: body
          }
        } catch (e) {
          lastErr = e
        }
      }
      throw lastErr
    }

    return {
      balance: tryBalance,
      testConnection: async () => {
        try {
          await tryBalance()
          return { ok: true, message: 'StepFun balance reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
