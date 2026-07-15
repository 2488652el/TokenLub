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
  /** 同一 Provider 下的计费区域或渠道，如 default/cn/global。 */
  billingScope?: string
  source: 'catalog' | 'user'
  /** models.dev 已移除的目录项保留但标记为 false，供历史记录继续估算。 */
  catalogActive?: boolean
  updatedAt?: string
}

/** models.dev 目录同步结果。 */
export interface PricingCatalogSyncResult {
  synced: number
  skipped: number
  protected: number
  notModified: boolean
  checkedAt: string
  added?: number
  changed?: number
  removed?: number
  blocked?: number
  pendingPreviewId?: string
  applied?: boolean
}

export type PricingChangeKind = 'added' | 'changed' | 'removed'

export interface PricingDiffEntry {
  key: string
  kind: PricingChangeKind
  before?: PricingEntry
  after?: PricingEntry
  changeRatio?: number
  blocked: boolean
}

export interface PricingCatalogPreview {
  id: string
  checkedAt: string
  entries: PricingEntry[]
  changes: PricingDiffEntry[]
  maxChangeRatio: number
}

export interface PricingCatalogPreviewSummary {
  id: string
  checkedAt: string
  added: number
  changed: number
  removed: number
  blocked: number
}

export interface PricingHistoryEntry {
  id: number
  providerId: string
  billingScope: string
  model: string
  currency: string
  kind: PricingChangeKind
  before?: PricingEntry
  after?: PricingEntry
  changeRatio?: number
  status: 'applied' | 'blocked'
  detectedAt: string
  appliedAt?: string
}

/** 价格目录自动更新与最近一次同步状态。 */
export interface PricingCatalogStatus {
  state: 'idle' | 'syncing' | 'error'
  autoUpdate: boolean
  lastAttemptAt?: string
  lastSuccessAt?: string
  lastError?: string
  lastResult?: PricingCatalogSyncResult
  pendingPreview?: PricingCatalogPreviewSummary
}

/** 单一币种兑人民币的参考汇率。 */
export interface CnyRateQuote {
  currency: string
  rateToCny: number
  source: 'api' | 'fallback'
  updatedAt?: string
}

export type PricingExchangePolicy = 'realtime' | 'fallback' | 'fixed'

export interface PricingExchangePolicyConfig {
  policy: PricingExchangePolicy
  fixedRates: Record<string, number>
}
