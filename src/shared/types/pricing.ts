/**
 * 定价条目类型:描述某个 (provider, model) 的每百万 token 单价,
 * 含 prompt/completion 与缓存读写单价。来源分目录(catalog)与用户(user)两种。
 * (glm-5.2)
 */

/** 定价条目:与 pricing_entries 表对应,用于费用估算。 */
export interface PricingEntry {
  id?: number
  providerId: string
  model: string
  promptPricePerMtok: number
  completionPricePerMtok: number
  cacheReadPricePerMtok?: number
  cacheCreationPricePerMtok?: number
  currency: string
  source: 'catalog' | 'user'
  updatedAt?: string
}
