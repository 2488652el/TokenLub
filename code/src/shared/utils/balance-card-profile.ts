import type { ApiKeyRecord } from '../types/api-key'

export type BalanceCardProfile =
  'api-balance' | 'coding-plan' | 'token-pack' | 'admin-usage' | 'gateway' | 'manual'

function isZhipuCodingPlan(baseUrl: string | undefined): boolean {
  const normalized = baseUrl?.toLowerCase() ?? ''
  return normalized.includes('/api/coding/') || normalized.includes('/api/anthropic')
}

/** 根据凭据用途决定余额卡片的信息结构，而不是按同一套金额字段硬套。 */
export function getBalanceCardProfile(
  key: Pick<ApiKeyRecord, 'providerId' | 'baseUrlOverride' | 'source'>
): BalanceCardProfile {
  if (key.providerId === 'kimi-coding' || key.providerId === 'minimax') return 'coding-plan'
  if (key.providerId === 'zhipu' && isZhipuCodingPlan(key.baseUrlOverride)) {
    return 'coding-plan'
  }
  if (key.providerId === 'longcat') return 'token-pack'
  if (key.providerId === 'openai-admin' || key.providerId === 'anthropic-admin') {
    return 'admin-usage'
  }
  if (key.providerId === 'newapi-generic' || key.providerId === 'openrouter') {
    return 'gateway'
  }
  if (
    key.source === 'manual' ||
    key.providerId === 'manual' ||
    key.providerId === 'qwen-manual' ||
    key.providerId === 'gemini-manual'
  ) {
    return 'manual'
  }
  return 'api-balance'
}
