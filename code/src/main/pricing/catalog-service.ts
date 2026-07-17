/** models.dev 目录同步状态、ETag 与启动时过期检查。 */
import { randomUUID } from 'node:crypto'
import type {
  PricingCatalogPreview,
  PricingCatalogPreviewSummary,
  PricingCatalogStatus,
  PricingCatalogSyncResult,
  PricingEntry
} from '@shared/types/pricing'
import { getSetting, setSetting } from '../store/settings-store'
import { listPricing, recordPricingHistory, upsertCatalogBatch } from '../store/pricing-repo'
import { scheduleSyncAfterChange } from '../sync/service'
import { CATALOG_MANAGED_SCOPES, syncCatalog, type CatalogFetchResult } from './catalog'
import {
  buildPricingCatalogDiff,
  DEFAULT_MAX_PRICE_CHANGE_RATIO,
  pricingNaturalKey,
  summarizePricingDiff
} from '@shared/pricing-diff'

const AUTO_UPDATE_KEY = 'pricing_catalog_auto_update'
const APPROVAL_REQUIRED_KEY = 'pricing_catalog_approval_required'
const ETAG_KEY = 'pricing_catalog_etag'
const LAST_ATTEMPT_KEY = 'pricing_catalog_last_attempt_at'
const LAST_SUCCESS_KEY = 'pricing_catalog_last_success_at'
const LAST_ERROR_KEY = 'pricing_catalog_last_error'
const LAST_RESULT_KEY = 'pricing_catalog_last_result'
const PENDING_PREVIEW_KEY = 'pricing_catalog_pending_preview'
const MAX_CHANGE_RATIO_KEY = 'pricing_catalog_max_change_ratio'
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
const STALE_CHECK_INTERVAL_MS = 60 * 60 * 1000

let activeSync: Promise<PricingCatalogSyncResult> | null = null
let refreshTimer: NodeJS.Timeout | null = null

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function publicResult(result: CatalogFetchResult): PricingCatalogSyncResult {
  return {
    synced: result.synced,
    skipped: result.skipped,
    protected: result.protected,
    notModified: result.notModified,
    checkedAt: result.checkedAt
  }
}

function getMaxChangeRatio(): number {
  const value = getSetting<number>(MAX_CHANGE_RATIO_KEY)
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_MAX_PRICE_CHANGE_RATIO
}

function isCatalogApprovalRequired(): boolean {
  return getSetting<boolean>(APPROVAL_REQUIRED_KEY) !== false
}

function previewSummary(preview: PricingCatalogPreview): PricingCatalogPreviewSummary {
  const summary = summarizePricingDiff(preview.changes)
  return { id: preview.id, checkedAt: preview.checkedAt, ...summary }
}

function readPendingPreview(): PricingCatalogPreview | null {
  const preview = getSetting<PricingCatalogPreview>(PENDING_PREVIEW_KEY)
  return preview && typeof preview.id === 'string' && Array.isArray(preview.entries)
    ? preview
    : null
}

export function getCatalogSyncStatus(): PricingCatalogStatus {
  const lastAttemptAt = asNonEmptyString(getSetting(LAST_ATTEMPT_KEY))
  const lastSuccessAt = asNonEmptyString(getSetting(LAST_SUCCESS_KEY))
  const lastError = asNonEmptyString(getSetting(LAST_ERROR_KEY))
  const lastResult = getSetting<PricingCatalogSyncResult>(LAST_RESULT_KEY)
  return {
    state: activeSync ? 'syncing' : lastError ? 'error' : 'idle',
    autoUpdate: getSetting<boolean>(AUTO_UPDATE_KEY) !== false,
    approvalRequired: isCatalogApprovalRequired(),
    ...(lastAttemptAt ? { lastAttemptAt } : {}),
    ...(lastSuccessAt ? { lastSuccessAt } : {}),
    ...(lastError ? { lastError } : {}),
    ...(lastResult ? { lastResult } : {}),
    ...(readPendingPreview() ? { pendingPreview: previewSummary(readPendingPreview()!) } : {})
  }
}

export function setCatalogAutoUpdate(enabled: boolean): PricingCatalogStatus {
  setSetting(AUTO_UPDATE_KEY, enabled)
  return getCatalogSyncStatus()
}

export function setCatalogApprovalRequired(enabled: boolean): PricingCatalogStatus {
  setSetting(APPROVAL_REQUIRED_KEY, enabled)
  const pending = readPendingPreview()
  if (!enabled && pending) applyCatalogPreview(pending.id)
  return getCatalogSyncStatus()
}

export function syncCatalogNow(): Promise<PricingCatalogSyncResult> {
  if (activeSync) return activeSync

  activeSync = (async () => {
    const attemptedAt = new Date().toISOString()
    setSetting(LAST_ATTEMPT_KEY, attemptedAt)
    try {
      const etag = asNonEmptyString(getSetting(ETAG_KEY))
      let fetchedEntries: PricingEntry[] | null = null
      const result = await syncCatalog(
        (entries) => {
          fetchedEntries = entries
          return { updated: entries.length, skipped: 0 }
        },
        etag ? { etag } : {}
      )
      if (result.notModified || fetchedEntries === null) {
        const visible = publicResult(result)
        setSetting(LAST_SUCCESS_KEY, result.checkedAt)
        setSetting(LAST_ERROR_KEY, null)
        setSetting(LAST_RESULT_KEY, visible)
        if (result.etag) setSetting(ETAG_KEY, result.etag)
        if (!result.notModified) scheduleSyncAfterChange()
        return visible
      }

      const entries = fetchedEntries as PricingEntry[]
      const current = listPricing()
      const changes = buildPricingCatalogDiff(current, entries, getMaxChangeRatio())
      const preview: PricingCatalogPreview = {
        id: randomUUID(),
        checkedAt: result.checkedAt,
        entries,
        changes,
        maxChangeRatio: getMaxChangeRatio()
      }
      const summary = summarizePricingDiff(changes)
      const currentUsers = new Set(
        current.filter((entry) => entry.source === 'user').map((entry) => pricingNaturalKey(entry))
      )
      const protectedCount = entries.filter((entry) =>
        currentUsers.has(pricingNaturalKey(entry))
      ).length
      if (summary.blocked > 0 && isCatalogApprovalRequired()) {
        setSetting(PENDING_PREVIEW_KEY, preview)
        recordPricingHistory(changes, 'blocked', result.checkedAt)
        const visible: PricingCatalogSyncResult = {
          synced: 0,
          skipped: result.skipped,
          protected: protectedCount,
          notModified: false,
          checkedAt: result.checkedAt,
          ...summary,
          pendingPreviewId: preview.id,
          applied: false
        }
        setSetting(LAST_SUCCESS_KEY, result.checkedAt)
        setSetting(LAST_ERROR_KEY, null)
        setSetting(LAST_RESULT_KEY, visible)
        if (result.etag) setSetting(ETAG_KEY, result.etag)
        return visible
      }

      const applied = upsertCatalogBatch(entries, {
        deactivateMissing: true,
        managedScopes: CATALOG_MANAGED_SCOPES
      })
      recordPricingHistory(changes, 'applied', result.checkedAt, new Date().toISOString())
      setSetting(PENDING_PREVIEW_KEY, null)
      const visible: PricingCatalogSyncResult = {
        synced: applied.updated,
        skipped: result.skipped,
        protected: protectedCount + applied.skipped,
        notModified: false,
        checkedAt: result.checkedAt,
        ...summary,
        applied: true
      }
      setSetting(LAST_SUCCESS_KEY, result.checkedAt)
      setSetting(LAST_ERROR_KEY, null)
      setSetting(LAST_RESULT_KEY, visible)
      if (result.etag) setSetting(ETAG_KEY, result.etag)
      if (!result.notModified) scheduleSyncAfterChange()
      return visible
    } catch (error) {
      setSetting(LAST_ERROR_KEY, (error as Error).message)
      throw error
    } finally {
      activeSync = null
    }
  })()
  return activeSync
}

export function getCatalogPreview(): PricingCatalogPreview | null {
  return readPendingPreview()
}

/** 只抓取并保存差异预览，不写入 pricing_entries。供人工确认流程使用。 */
export async function previewCatalogNow(): Promise<PricingCatalogPreview | null> {
  const attemptedAt = new Date().toISOString()
  setSetting(LAST_ATTEMPT_KEY, attemptedAt)
  try {
    const etag = asNonEmptyString(getSetting(ETAG_KEY))
    let fetchedEntries: PricingEntry[] | null = null
    const result = await syncCatalog(
      (entries) => {
        fetchedEntries = entries
        return { updated: entries.length, skipped: 0 }
      },
      etag ? { etag } : {}
    )
    if (result.notModified || fetchedEntries === null) return readPendingPreview()
    const entries = fetchedEntries as PricingEntry[]
    const changes = buildPricingCatalogDiff(listPricing(), entries, getMaxChangeRatio())
    const preview: PricingCatalogPreview = {
      id: randomUUID(),
      checkedAt: result.checkedAt,
      entries,
      changes,
      maxChangeRatio: getMaxChangeRatio()
    }
    setSetting(PENDING_PREVIEW_KEY, preview)
    setSetting(LAST_SUCCESS_KEY, result.checkedAt)
    setSetting(LAST_ERROR_KEY, null)
    if (result.etag) setSetting(ETAG_KEY, result.etag)
    return preview
  } catch (error) {
    setSetting(LAST_ERROR_KEY, (error as Error).message)
    throw error
  }
}

export function applyCatalogPreview(previewId: string): PricingCatalogSyncResult {
  const preview = readPendingPreview()
  if (!preview || preview.id !== previewId) throw new Error('pricing catalog preview expired')
  const applied = upsertCatalogBatch(preview.entries, {
    deactivateMissing: true,
    managedScopes: CATALOG_MANAGED_SCOPES
  })
  const appliedAt = new Date().toISOString()
  recordPricingHistory(preview.changes, 'applied', preview.checkedAt, appliedAt)
  setSetting(PENDING_PREVIEW_KEY, null)
  const summary = summarizePricingDiff(preview.changes)
  const result: PricingCatalogSyncResult = {
    synced: applied.updated,
    skipped: 0,
    protected: applied.skipped,
    notModified: false,
    checkedAt: preview.checkedAt,
    ...summary,
    applied: true
  }
  setSetting(LAST_RESULT_KEY, result)
  scheduleSyncAfterChange()
  return result
}

/** 应用启动时仅在自动更新开启且最近成功同步超过 24 小时时拉取。 */
export async function refreshCatalogIfStale(): Promise<PricingCatalogSyncResult | null> {
  if (getSetting<boolean>(AUTO_UPDATE_KEY) === false) return null
  const lastSuccessAt = asNonEmptyString(getSetting(LAST_SUCCESS_KEY))
  if (lastSuccessAt) {
    const lastSuccessMs = Date.parse(lastSuccessAt)
    if (Number.isFinite(lastSuccessMs) && Date.now() - lastSuccessMs < REFRESH_INTERVAL_MS) {
      return null
    }
  }
  return syncCatalogNow()
}

/** 启动后台检查；每小时判断一次，真正下载仍受 24 小时新鲜度限制。 */
export function startCatalogAutoRefresh(): void {
  void refreshCatalogIfStale().catch(() => undefined)
  if (refreshTimer) return
  refreshTimer = setInterval(() => {
    void refreshCatalogIfStale().catch(() => undefined)
  }, STALE_CHECK_INTERVAL_MS)
}
