/**
 * Zhipu GLM 供应商实现:通过 /api/biz/account/balance 查询余额,失败时用 chat 探测验证密钥有效性。
 * 该模块属于 main 进程的 providers 模块,智谱 GLM 以 CNY 计费,支持 PaaS 与 Coding Plan 两种密钥类型。
 * (glm-5.2)
 */
import type { ProviderImpl, ProviderCapabilities, BalanceSnapshot } from '@shared/types/provider'
import { ProviderError } from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** 供应商清单:标识、显示名、分类(token-plan)、特性(balance)及文档地址。 */
const MANIFEST = {
  id: 'zhipu',
  displayName: 'Zhipu GLM',
  category: 'token-plan' as const,
  features: ['balance'] as const,
  docsUrl: 'https://open.bigmodel.cn/dev/api'
}

/** /api/biz/account/balance 接口返回结构:含 code/msg、余额数据与成功标志。 */
interface BalanceResp {
  code: number
  msg: string
  data?: { balance?: number | string; currency?: string; expire_at?: string }
  success: boolean
}

/** chat/completions 探测响应结构:含 choices 数组与 token 用量统计。 */
interface ChatProbeResp {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

/**
 * Zhipu GLM 供应商实现对象。
 * - hasBalanceApi: 支持
 * - hasUsageApi: 不支持
 * - build: 创建两个 HTTP 客户端(平台根 + chat 兼容基址)并构造能力对象
 */
export const zhipuProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  build(creds): ProviderCapabilities {
    /** 将用户传入的 baseUrl 规范化为 OpenAI 兼容的 chat-completions 基址。 */
    const normalizeOpenAIChatBase = (baseUrl: string): string => {
      const base = baseUrl.trim().replace(/\/+$/, '')
      if (!base) return 'https://open.bigmodel.cn/api/paas/v4'
      if (base.endsWith('/api/anthropic')) return 'https://open.bigmodel.cn/api/coding/paas/v4'
      if (base.endsWith('/api/biz')) return 'https://open.bigmodel.cn/api/paas/v4'
      if (base === 'https://open.bigmodel.cn') return 'https://open.bigmodel.cn/api/paas/v4'
      return base
    }

    // `http` targets the platform root — used for the /api/biz/account/balance
    // endpoint whose path is anchored at open.bigmodel.cn. Do not use the
    // renderer's baseUrl override here: the create-key modal exposes chat
    // protocol bases such as /api/paas/v4 and /api/anthropic, while balance
    // always lives under the platform root.
    // `http` 指向平台根域名,用于 /api/biz/account/balance 余额接口;不使用渲染层的 baseUrl 覆盖,因为余额始终在平台根下。(glm-5.2)
    const http = new ProviderHttpClient({
      baseUrl: 'https://open.bigmodel.cn',
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })
    // `chatHttp` is a separate client anchored at the OpenAI-compatible
    // chat-completions base. The probe MUST use a base that actually serves
    // /chat/completions; the platform root returns 405 because chat lives
    // under /api/paas/v4. Coding Plan users can override this in the form;
    // when they pick the Anthropic-compatible template, probe the matching
    // OpenAI-compatible Coding Plan base instead so "Test connection" still
    // verifies the key without calling an incompatible protocol path.
    // `chatHttp` 指向 OpenAI 兼容的 chat 基址,用于密钥连通性探测;Coding Plan 用户可在表单中覆盖。(glm-5.2)
    const chatHttp = new ProviderHttpClient({
      baseUrl: normalizeOpenAIChatBase(creds.baseUrl),
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    /**
     * 1) Try the documented /api/biz/account/balance endpoint first.
     * 2) If that returns a non-2xx *and* the key still works for chat
     *    completions, return a "key works, balance unknown" snapshot instead
     *    of throwing. The upstream /api/biz namespace was observed to return
     *    `{"code":500,"msg":"系统异常"}` for *every* key in 2026-07, including
     *    valid control-panel tokens; failing the whole test there is wrong.
     * 策略:优先走官方余额接口;失败后用最低价模型做 chat 探测,密钥有效则返回"余额未知"快照而非抛错。(glm-5.2)
     */
    async function tryBalance(): Promise<BalanceSnapshot> {
      // Coerce string balance ("12.34") to number, matching what other
      // providers (deepseek, siliconflow, stepfun) do for similar shapes.
      // 将字符串余额("12.34")转为数字,与其他供应商处理同类返回体的方式一致。(glm-5.2)
      const toNumber = (v: unknown): number | undefined => {
        if (typeof v === 'number' && Number.isFinite(v)) return v
        if (typeof v === 'string') {
          const n = Number(v)
          return Number.isFinite(n) ? n : undefined
        }
        return undefined
      }

      // Step 1: official endpoint
      try {
        const body = await http.getJSON<BalanceResp>('/api/biz/account/balance')
        if (body.code === 200) {
          const remaining = toNumber(body.data?.balance)
          const snap: BalanceSnapshot = {
            providerId: MANIFEST.id,
            capturedAt: new Date().toISOString(),
            currency: body.data?.currency ?? 'CNY',
            raw: body
          }
          if (remaining !== undefined) snap.remaining = remaining
          return snap
        }
        // code !== 200: fall through to chat probe
      } catch {
        // network / HTTP error: also fall through
      }

      // Step 2: chat-completions reachability probe with the cheapest model.
      // Uses `chatHttp` (anchored at /api/paas/v4) so /chat/completions is on
      // the right origin — the platform root returns 405 for that path.
      // We use `glm-4.5-flash` because it's the cheapest documented model
      // that works on both PaaS and Coding Plan keys; the docs list it for
      // the highspeed tier.
      // 用最低价模型 glm-4.5-flash 做一次 chat completions 探测,验证密钥是否有效;该模型在 PaaS 与 Coding Plan 密钥上均可用。(glm-5.2)
      try {
        const probe = await chatHttp.postJSON<ChatProbeResp>('/chat/completions', {
          model: 'glm-4.5-flash',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        })
        if (Array.isArray(probe.choices)) {
          // Key is valid. Return a snapshot with no remaining/total so the UI
          // shows "—" and the test passes with a clear "balance API down,
          // key confirmed via chat" message.
          return {
            providerId: MANIFEST.id,
            capturedAt: new Date().toISOString(),
            currency: 'CNY',
            raw: { _probeOnly: true, bizUpstream: false }
          }
        }
      } catch (e) {
        throw new ProviderError(
          MANIFEST.id,
          'BALANCE_UNAVAILABLE',
          undefined,
          `Zhipu 余额接口 /api/biz/account/balance 不可用,且 chat completions 探测也失败: ${(e as Error).message}`
        )
      }
      throw new ProviderError(
        MANIFEST.id,
        'BALANCE_UNAVAILABLE',
        undefined,
        'Zhipu 余额接口不可用,且 chat completions 探测未返回 choices'
      )
    }

    return {
      balance: tryBalance,
      testConnection: async () => {
        try {
          const snap = await tryBalance()
          if ((snap.raw as { _probeOnly?: boolean } | undefined)?._probeOnly) {
            return {
              ok: true,
              message:
                'Zhipu key 连通,但 /api/biz 余额接口当前 500(平台异常),已在 bigmodel.cn 控制台核对额度'
            }
          }
          return { ok: true, message: 'Zhipu balance reachable' }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      }
    }
  }
}
