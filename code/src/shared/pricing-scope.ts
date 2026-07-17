/** 价格渠道标识与 API Base URL 到结算区域的安全映射。 */
export const DEFAULT_BILLING_SCOPE = 'default'

export function normalizeBillingScope(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase()
  return normalized || DEFAULT_BILLING_SCOPE
}

function isDomainOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

/**
 * 根据 Provider 和 Base URL 推断价格渠道。只对已知存在区域价差的官方域名
 * 做映射；自建网关回退 default，由用户自定义价格覆盖。
 */
export function resolveBillingScope(providerId: string, baseUrlOverride?: string | null): string {
  let hostname = ''
  if (baseUrlOverride) {
    try {
      hostname = new URL(baseUrlOverride).hostname.toLowerCase()
    } catch {
      return DEFAULT_BILLING_SCOPE
    }
  }

  if (providerId === 'moonshot') {
    if (isDomainOrSubdomain(hostname, 'moonshot.ai')) return 'global'
    if (!hostname || isDomainOrSubdomain(hostname, 'moonshot.cn')) return 'cn'
  }
  if (providerId === 'minimax') {
    if (isDomainOrSubdomain(hostname, 'minimax.io')) return 'global'
    if (!hostname || isDomainOrSubdomain(hostname, 'minimaxi.com')) return 'cn'
  }
  return DEFAULT_BILLING_SCOPE
}
