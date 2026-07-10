/**
 * MiniMax Provider 实现:通过 OpenAI 兼容的 /v1/models 校验密钥,
 * 并读取 Token Plan 剩余额度(/v1/token_plan/remains)作为余额。
 * (glm-5.2)
 */
import type {
  ProviderImpl,
  ProviderCredentials,
  ProviderCapabilities,
  ProviderTestResult,
  BalanceSnapshot
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

/** MiniMax Provider 的清单常量。 (glm-5.2) */
const MANIFEST = {
  id: 'minimax',
  displayName: 'MiniMax',
  category: 'token-plan' as const,
  features: ['balance'] as const,
  docsUrl: 'https://platform.minimaxi.com/docs/guides/pricing-paygo'
}

/**
 * MiniMax provider.
 *
 * OpenAI-compatible Chat Completions live at `https://api.minimaxi.com/v1`
 * (note the `minimaxi` domain - the legacy `api.minimax.chat` was for the
 * retired abab6.5 era). The same base also exposes an Anthropic-compatible
 * `/anthropic/v1/messages` path and an OpenAI Responses API.
 *
 * `testConnection` validates the key by calling the public `/v1/models`
 * endpoint - that route returns 401 on a bad key and 200 on a valid one,
 * without spending any tokens. The current Token Plan quota snapshot lives at
 * `/v1/token_plan/remains`.
 *
 * 中文说明:MiniMax 兼容 OpenAI 协议;testConnection 用 /v1/models 校验密钥(零开销),余额取自 /v1/token_plan/remains。 (glm-5.2)
 */
export const minimaxProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  build(creds: ProviderCredentials): ProviderCapabilities {
    // The catalog default baseUrl is `https://api.minimaxi.com/v1` (the
    // OpenAI-compat root). Strip a trailing `/v1` so that requesting
    // `/v1/models` does not double up to `/v1/v1/models`. A bare host or an
    // already-root base is left untouched.
    const raw = creds.baseUrl || 'https://api.minimaxi.com'
    const base = raw.replace(/\/v1\/?$/, '')
    const http = new ProviderHttpClient({
      baseUrl: base,
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    /** 读取 Token Plan 剩余额度,优先取通用模型的周/区间剩余百分比。 (glm-5.2) */
    async function fetchTokenPlanRemains(): Promise<BalanceSnapshot> {
      const body = await http.getJSON<Record<string, unknown>>('/v1/token_plan/remains')
      const payload = asRecord(body.data) ?? body
      const preferredModelRemain = pickPreferredModelRemain(payload)
      const remaining = firstFinite(
        payload.current_weekly_remaining_percent,
        payload.currentWeeklyRemainingPercent,
        payload.current_five_hour_remaining_percent,
        payload.currentFiveHourRemainingPercent,
        preferredModelRemain?.current_weekly_remaining_percent,
        preferredModelRemain?.currentWeeklyRemainingPercent,
        preferredModelRemain?.current_interval_remaining_percent,
        preferredModelRemain?.currentIntervalRemainingPercent
      )
      return {
        providerId: MANIFEST.id,
        capturedAt: new Date().toISOString(),
        total: 100,
        currency: 'CNY',
        raw: body,
        ...(remaining !== undefined ? { remaining } : {})
      }
    }

    async function testConnection(): Promise<ProviderTestResult> {
      try {
        // /v1/models is a public, zero-cost key-validation endpoint. A bad key
        // 401s; a good key returns the model list. We do not parse the body —
        // reachability + auth is all we need here.
        await http.getJSON<{ data?: unknown[] }>('/v1/models')
        return { ok: true, message: 'MiniMax API key valid (models reachable)' }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    }

    return {
      balance: fetchTokenPlanRemains,
      testConnection
    }
  }
}

function firstFinite(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function pickPreferredModelRemain(
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  const rows = Array.isArray(payload.model_remains)
    ? payload.model_remains
    : Array.isArray(payload.modelRemains)
      ? payload.modelRemains
      : null
  if (!rows || rows.length === 0) return null

  const preferred =
    rows.find(
      (row) =>
        row &&
        typeof row === 'object' &&
        ((row as Record<string, unknown>).model_name === 'general' ||
          (row as Record<string, unknown>).modelName === 'general')
    ) ?? rows[0]

  return asRecord(preferred)
}
