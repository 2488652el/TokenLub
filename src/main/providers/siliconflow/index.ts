/**
 * SiliconFlow 供应商实现:通过多个候选端点探测账户余额。
 * 该模块属于 main 进程的 providers 模块,SiliconFlow 为第三方模型聚合平台,以 CNY 计费。
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
  id: 'siliconflow',
  displayName: 'SiliconFlow',
  category: 'third-party' as const,
  features: ['balance'] as const,
  docsUrl: 'https://docs.siliconflow.cn'
}

/**
 * SiliconFlow 余额接口可能返回的多种形态(字符串或数字)。
 * 包含 data 嵌套对象与平铺两种结构。
 */
interface BalanceResp {
  // several variants in the wild
  data?: {
    balance?: number | string
    chargeBalance?: number | string
    totalBalance?: number | string
    currency?: string
  }
  chargeBalance?: number | string
  balance?: number | string
  totalBalance?: number | string
  currency?: string
}

/**
 * SiliconFlow 供应商实现对象。
 * - hasBalanceApi: 支持
 * - hasUsageApi: 不支持
 * - build: 构造余额查询能力
 */
export const siliconflowProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  /** 构造供应商能力对象,创建指向 SiliconFlow API 的 HTTP 客户端。 */
  build(creds: ProviderCredentials): ProviderCapabilities {
    const http = new ProviderHttpClient({
      baseUrl: creds.baseUrl || 'https://api.siliconflow.cn',
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    /** 将字符串或数字安全转换为有限数字,无法转换时返回 0。 */
    function toFiniteNum(v: number | string | undefined): number {
      if (v === undefined) return 0
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : 0
    }

    /** 按优先级从返回体中选取余额数值(平铺优先,其次 data 嵌套)。 */
    function pickNumber(body: BalanceResp): number {
      if (body.balance !== undefined) return toFiniteNum(body.balance)
      if (body.data) {
        if (body.data.balance !== undefined) return toFiniteNum(body.data.balance)
        if (body.data.chargeBalance !== undefined) return toFiniteNum(body.data.chargeBalance)
        if (body.data.totalBalance !== undefined) return toFiniteNum(body.data.totalBalance)
      }
      if (body.chargeBalance !== undefined) return toFiniteNum(body.chargeBalance)
      return 0
    }

    /** 依次尝试多个余额端点,返回第一个成功的标准化快照。 */
    async function tryBalance(): Promise<BalanceSnapshot> {
      const candidates = ['/v1/user/balance', '/v1/account/balance', '/v1/user/info']
      let lastErr: unknown
      for (const path of candidates) {
        try {
          const body = await http.getJSON<BalanceResp>(path)
          const remaining = pickNumber(body)
          return {
            providerId: MANIFEST.id,
            capturedAt: new Date().toISOString(),
            remaining,
            currency: body.data?.currency ?? body.currency ?? 'CNY',
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
          return { ok: true, message: 'SiliconFlow balance reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
