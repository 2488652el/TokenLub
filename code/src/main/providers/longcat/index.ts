/**
 * LongCat(美团)Provider 实现:通过 OpenAI 兼容 API 校验密钥,
 * 并使用平台 Cookie 读取 Token 资源包余额(剩余/总量/已用)。
 * (glm-5.2)
 */
import type {
  ProviderImpl,
  ProviderCredentials,
  ProviderCapabilities,
  BalanceSnapshot
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** LongCat 平台站点基础地址。 (glm-5.2) */
const PLATFORM_BASE_URL = 'https://longcat.chat'
/** LongCat 平台请求所需的 m-appkey 标识。 (glm-5.2) */
const PLATFORM_APP_KEY = 'fe_com.sankuai.friday.longcat.platform'

/** LongCat Provider 的清单常量。 (glm-5.2) */
const MANIFEST = {
  id: 'longcat',
  displayName: 'LongCat (美团)',
  category: 'token-plan' as const,
  features: ['balance'] as const,
  docsUrl: 'https://longcat.chat/platform'
}

/** 单个 Token 资源包批次信息。 (glm-5.2) */
interface TokenPackLot {
  remainingToken?: number
  totalToken?: number
  consumedToken?: number
  frozenToken?: number
  consumedRatio?: number
  effectiveTime?: string
  expireTime?: string
  grantCategory?: string
  source?: string
  status?: string
}

/** LongCat Token 资源包汇总接口响应结构。 (glm-5.2) */
interface TokenPackSummaryResp {
  code?: number
  msg?: string
  data?: {
    currentLot?: TokenPackLot
    otherLots?: TokenPackLot[]
    estimate?: {
      dailyAverageToken?: number
      exhaustedAfterDays?: number
      windowDays?: number
    }
  } | null
}

/** 规范化 baseUrl:去除尾部 /openai 或 /anthropic 后缀,默认用官方地址。 (glm-5.2) */
function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || 'https://api.longcat.chat').replace(/\/(?:openai|anthropic)\/?$/, '')
}

/** 规范化平台 Cookie:去除可能的 "cookie:" 前缀并 trim,空值返回 null。 (glm-5.2) */
function normalizePlatformCookie(raw: string | undefined): string | null {
  const cookie = raw?.trim()
  if (!cookie) return null
  return cookie.replace(/^cookie:\s*/i, '').trim()
}

/** 将任意值安全转为有限数字,非有限数返回 0。 (glm-5.2) */
function finiteOrZero(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/** LongCat Provider 实现:密钥校验 + Token 资源包余额(需平台 Cookie)。 (glm-5.2) */
export const longcatProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  build(creds: ProviderCredentials): ProviderCapabilities {
    const http = new ProviderHttpClient({
      baseUrl: normalizeBaseUrl(creds.baseUrl),
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })
    const platformCookie = normalizePlatformCookie(creds.extra?.longcatPlatformCookie)

    /** 通过平台 Cookie 调用 Token 资源包汇总接口,返回余额快照。 (glm-5.2) */
    async function fetchTokenPackBalance(): Promise<BalanceSnapshot> {
      if (!platformCookie) {
        throw new Error('LongCat 平台 Cookie 未配置,无法读取 Token 资源包余额')
      }
      const res = await fetch(`${PLATFORM_BASE_URL}/api/pay/quota/metering/token-packs/summary`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: platformCookie,
          'm-appkey': PLATFORM_APP_KEY,
          'x-client-language': 'zh',
          'x-requested-with': 'XMLHttpRequest',
          origin: PLATFORM_BASE_URL,
          referer: `${PLATFORM_BASE_URL}/platform/usage`
        },
        body: '{}'
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`LongCat Token Pack 查询失败: HTTP ${res.status} ${text.slice(0, 160)}`)
      }
      const body = (await res.json()) as TokenPackSummaryResp
      if (body.code !== 0 || !body.data?.currentLot) {
        throw new Error(`LongCat Token Pack 查询失败: ${body.msg ?? 'missing currentLot'}`)
      }
      const lot = body.data.currentLot
      const remaining = finiteOrZero(lot.remainingToken)
      const total = finiteOrZero(lot.totalToken)
      const used = finiteOrZero(lot.consumedToken)
      return {
        providerId: MANIFEST.id,
        capturedAt: new Date().toISOString(),
        remaining,
        total,
        used,
        currency: 'TOKENS',
        raw: body.data
      }
    }

    return {
      ...(platformCookie ? { balance: fetchTokenPackBalance } : {}),
      testConnection: async () => {
        try {
          await http.getJSON<{ data?: unknown[] }>('/openai/v1/models')
          const suffix = platformCookie ? '；平台 Cookie 已配置,可读取 Token 资源包' : ''
          return { ok: true, message: `LongCat API key valid (models reachable)${suffix}` }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
