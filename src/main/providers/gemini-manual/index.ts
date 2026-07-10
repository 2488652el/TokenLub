/**
 * Google Gemini(免费层、手动录入)Provider 实现:无余额/用量 API,
 * 仅提供连接测试,余额需用户在余额查询页手动录入。
 * (glm-5.2)
 */
import type { ProviderImpl, ProviderCapabilities } from '@shared/types/provider'

/** Gemini-manual Provider 的清单常量。 (glm-5.2) */
const MANIFEST = {
  id: 'gemini-manual',
  displayName: 'Google Gemini (free tier, manual)',
  category: 'manual' as const,
  features: [] as const,
  docsUrl: 'https://ai.google.dev/gemini-api/docs'
}

/** Gemini-manual Provider 实现,仅提供 testConnection。 (glm-5.2) */
export const geminiManualProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: false,
  hasUsageApi: false,
  build(): ProviderCapabilities {
    return {
      testConnection: async () => ({
        ok: true,
        message: 'Gemini 免费层无余额 API — 请在余额查询页手动录入'
      })
    }
  }
}
