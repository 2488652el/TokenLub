/** Kimi Code / Coding Plan provider implementation. */
import type {
  BalanceSnapshot,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderImpl,
  ProviderTestResult
} from '@shared/types/provider'
import { ProviderHttpClient } from '../http-client'

const MANIFEST = {
  id: 'kimi-coding',
  displayName: 'Kimi Coding Plan',
  category: 'token-plan' as const,
  features: ['balance'] as const,
  docsUrl: 'https://www.kimi.com/code/docs/'
}

type KimiUsage = {
  limit?: string | number
  used?: string | number
  remaining?: string | number
  resetTime?: string
  reset_at?: string
}

type KimiUsageResponse = {
  usage?: KimiUsage
  limits?: Array<{
    window?: { duration?: number; timeUnit?: string }
    detail?: KimiUsage
  }>
}

export const kimiCodingProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: true,
  hasUsageApi: false,
  build(creds: ProviderCredentials): ProviderCapabilities {
    const configuredBase = (creds.baseUrl || 'https://api.kimi.com/coding/v1').replace(/\/+$/, '')
    // The Anthropic-compatible template ends at `/coding/`, but the documented
    // usage and model endpoints live under the OpenAI-compatible `/coding/v1`.
    const base = configuredBase.endsWith('/coding') ? `${configuredBase}/v1` : configuredBase
    const http = new ProviderHttpClient({
      baseUrl: base,
      auth: { type: 'bearer', token: creds.apiKey },
      providerId: MANIFEST.id
    })

    async function fetchUsage(): Promise<BalanceSnapshot> {
      const body = await http.getJSON<KimiUsageResponse>('/usages')
      const weekly = body.usage
      const weeklyLimit = toFiniteNumber(weekly?.limit)
      const weeklyUsed = toFiniteNumber(weekly?.used)
      const weeklyRemaining = toFiniteNumber(weekly?.remaining)
      const weeklyPercent = percentage(weeklyLimit, weeklyUsed, weeklyRemaining)
      return {
        providerId: MANIFEST.id,
        capturedAt: new Date().toISOString(),
        total: 100,
        ...(weeklyPercent !== undefined
          ? { remaining: 100 - weeklyPercent, used: weeklyPercent }
          : {}),
        currency: 'PERCENT',
        raw: body
      }
    }

    async function testConnection(): Promise<ProviderTestResult> {
      try {
        await http.getJSON<{ data?: unknown[] }>('/models')
        return { ok: true, message: 'Kimi Coding Plan API key valid (models reachable)' }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    }

    return { balance: fetchUsage, testConnection }
  }
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

function percentage(limit?: number, used?: number, remaining?: number): number | undefined {
  if (limit === undefined || limit <= 0) return undefined
  if (used !== undefined) return clamp((used / limit) * 100)
  if (remaining !== undefined) return clamp(((limit - remaining) / limit) * 100)
  return undefined
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value))
}
