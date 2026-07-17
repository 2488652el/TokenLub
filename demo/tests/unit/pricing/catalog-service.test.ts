/** 价格目录同步状态持久化、ETag 复用和 24 小时新鲜度测试。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  syncCatalog: vi.fn(),
  upsertCatalogBatch: vi.fn(),
  listPricing: vi.fn(() => []),
  recordPricingHistory: vi.fn(),
  scheduleSyncAfterChange: vi.fn()
}))

vi.mock('../../../../code/src/main/store/settings-store', () => ({
  getSetting: (key: string) => mocks.settings.get(key) ?? null,
  setSetting: (key: string, value: unknown) => mocks.settings.set(key, value)
}))

vi.mock('../../../../code/src/main/store/pricing-repo', () => ({
  upsertCatalogBatch: mocks.upsertCatalogBatch,
  listPricing: mocks.listPricing,
  recordPricingHistory: mocks.recordPricingHistory
}))

vi.mock('../../../../code/src/main/pricing/catalog', () => ({
  syncCatalog: mocks.syncCatalog,
  CATALOG_MANAGED_SCOPES: [
    { providerId: 'moonshot', billingScope: 'global' },
    { providerId: 'deepseek', billingScope: 'default' }
  ]
}))

vi.mock('../../../../code/src/main/sync/service', () => ({
  scheduleSyncAfterChange: mocks.scheduleSyncAfterChange
}))

import {
  applyCatalogPreview,
  getCatalogSyncStatus,
  previewCatalogNow,
  refreshCatalogIfStale,
  setCatalogAutoUpdate,
  syncCatalogNow
} from '../../../../code/src/main/pricing/catalog-service'

beforeEach(() => {
  mocks.settings.clear()
  mocks.syncCatalog.mockReset()
  mocks.upsertCatalogBatch.mockReset()
  mocks.upsertCatalogBatch.mockReturnValue({ updated: 0, skipped: 0 })
  mocks.listPricing.mockReset()
  mocks.listPricing.mockReturnValue([])
  mocks.recordPricingHistory.mockReset()
  mocks.scheduleSyncAfterChange.mockReset()
})

describe('catalog-service', () => {
  it('defaults auto update to enabled and persists successful sync metadata', async () => {
    mocks.settings.set('pricing_catalog_etag', '"old"')
    mocks.syncCatalog.mockResolvedValue({
      synced: 12,
      skipped: 3,
      protected: 2,
      notModified: false,
      checkedAt: '2026-07-15T12:00:00.000Z',
      etag: '"new"'
    })

    expect(getCatalogSyncStatus()).toMatchObject({ state: 'idle', autoUpdate: true })
    await expect(syncCatalogNow()).resolves.toMatchObject({ synced: 12, protected: 2 })
    expect(mocks.syncCatalog).toHaveBeenCalledWith(expect.any(Function), { etag: '"old"' })
    expect(getCatalogSyncStatus()).toMatchObject({
      state: 'idle',
      autoUpdate: true,
      lastSuccessAt: '2026-07-15T12:00:00.000Z',
      lastResult: { synced: 12, protected: 2 }
    })
    expect(mocks.settings.get('pricing_catalog_etag')).toBe('"new"')
    expect(mocks.scheduleSyncAfterChange).toHaveBeenCalledOnce()
  })

  it('records an error without discarding prior success metadata', async () => {
    mocks.settings.set('pricing_catalog_last_success_at', '2026-07-14T12:00:00.000Z')
    mocks.syncCatalog.mockRejectedValue(new Error('offline'))
    await expect(syncCatalogNow()).rejects.toThrow('offline')
    expect(getCatalogSyncStatus()).toMatchObject({
      state: 'error',
      lastSuccessAt: '2026-07-14T12:00:00.000Z',
      lastError: 'offline'
    })
  })

  it('does not schedule cloud sync for an unchanged ETag response', async () => {
    mocks.syncCatalog.mockResolvedValue({
      synced: 0,
      skipped: 0,
      protected: 0,
      notModified: true,
      checkedAt: '2026-07-15T12:00:00.000Z',
      etag: '"same"'
    })

    await syncCatalogNow()

    expect(mocks.scheduleSyncAfterChange).not.toHaveBeenCalled()
  })

  it('reconciles every models.dev-managed provider scope after a full download', async () => {
    mocks.syncCatalog.mockImplementation(async (upsert: (entries: unknown[]) => unknown) => {
      upsert([])
      return {
        synced: 0,
        skipped: 0,
        protected: 0,
        notModified: false,
        checkedAt: '2026-07-15T12:00:00.000Z'
      }
    })

    await syncCatalogNow()

    expect(mocks.upsertCatalogBatch).toHaveBeenCalledWith([], {
      deactivateMissing: true,
      managedScopes: expect.arrayContaining([
        { providerId: 'moonshot', billingScope: 'global' },
        { providerId: 'deepseek', billingScope: 'default' }
      ])
    })
  })

  it('stores a diff preview without writing pricing rows', async () => {
    const entry = {
      providerId: 'deepseek',
      model: 'deepseek-chat',
      promptPricePerMtok: 1,
      completionPricePerMtok: 2,
      currency: 'USD',
      source: 'catalog' as const
    }
    mocks.syncCatalog.mockImplementation(async (capture: (entries: unknown[]) => unknown) => {
      capture([entry])
      return {
        synced: 1,
        skipped: 0,
        protected: 0,
        notModified: false,
        checkedAt: '2026-07-15T12:00:00.000Z'
      }
    })

    const preview = await previewCatalogNow()

    expect(preview).toMatchObject({ entries: [entry], changes: [{ kind: 'added' }] })
    expect(mocks.upsertCatalogBatch).not.toHaveBeenCalled()
    expect(getCatalogSyncStatus().pendingPreview).toMatchObject({ added: 1 })

    mocks.upsertCatalogBatch.mockReturnValue({ updated: 1, skipped: 0 })
    expect(applyCatalogPreview(preview!.id)).toMatchObject({
      synced: 1,
      applied: true
    })
    expect(getCatalogSyncStatus().pendingPreview).toBeUndefined()
  })

  it('skips fresh or disabled automatic refreshes', async () => {
    mocks.settings.set('pricing_catalog_last_success_at', new Date().toISOString())
    await expect(refreshCatalogIfStale()).resolves.toBeNull()
    expect(mocks.syncCatalog).not.toHaveBeenCalled()

    setCatalogAutoUpdate(false)
    mocks.settings.delete('pricing_catalog_last_success_at')
    await expect(refreshCatalogIfStale()).resolves.toBeNull()
    expect(getCatalogSyncStatus().autoUpdate).toBe(false)
    expect(mocks.scheduleSyncAfterChange).not.toHaveBeenCalled()
  })
})
