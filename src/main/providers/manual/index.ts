/**
 * Manual(用户手动录入)Provider 实现:无远端端点,仅提供占位的连接测试,
 * 余额由用户在 UI 手动录入。
 * (glm-5.2)
 */
import type { ProviderImpl, ProviderCapabilities } from '@shared/types/provider'

/** manual Provider 的清单常量。 (glm-5.2) */
const MANIFEST = {
  id: 'manual',
  displayName: 'Manual (user-entered)',
  category: 'manual' as const,
  features: ['balance'] as const
}

/** manual Provider 实现,仅提供 testConnection。 (glm-5.2) */
export const manualProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: false,
  hasUsageApi: false,
  build(): ProviderCapabilities {
    return {
      testConnection: async () => ({
        ok: true,
        message: 'Manual provider — no remote endpoint'
      })
    }
  }
}
