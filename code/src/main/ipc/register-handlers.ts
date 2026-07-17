/**
 * IPC 处理器注册模块:将渲染进程通过 ipcMain.handle 发起的各类请求
 * (密钥管理、用量查询、价格配置、设置、告警、余额、Provider 列表、
 * 本地日志解析与 CLI 密钥导入等)转发到对应的 store/provider/log-parsers 层,
 * 并使用 zod schema 进行入参校验。
 * (glm-5.2)
 */
import { ipcMain, BrowserWindow, dialog, net, shell } from 'electron'
import { IPC } from '@shared/ipc-channels'
import {
  apiKeyCreateInputSchema,
  apiKeyUpdateInputSchema,
  usageFilterSchema,
  pricingSetInputSchema,
  pricingCatalogApplyInputSchema,
  pricingExchangePolicySetInputSchema,
  alertAddInputSchema,
  alertToggleInputSchema,
  settingsSetInputSchema,
  keysSetUsageQueryInputSchema,
  logOpenFolderInputSchema,
  logSyncInputSchema,
  syncLoginInputSchema,
  syncDeviceIdInputSchema,
  syncModeSchema
} from '@shared/ipc-schemas'
import type { ApiKeyCreateInput, ApiKeyUpdateInput } from '@shared/types/api-key'
import type { PricingEntry } from '@shared/types/pricing'
import type { AlertRule } from '@shared/types/alert'
import {
  listKeys,
  addKey,
  updateKey,
  deleteKey,
  getDecryptedExtraCredentials,
  getDecryptedKey,
  toggleUsageQuery,
  getKey
} from '../store/keys-repo'
import { validateProviderEndpoint } from '../providers/endpoint-policy'
import { latestBalances } from '../store/balance-repo'
import {
  queryUsage,
  queryUsagePage,
  getDashboardSummary,
  computeTotalSpend,
  computeModelSpend,
  computeSpendByKey
} from '../store/usage-repo'
import { listPricing, listPricingHistory, setPricing, deletePricing } from '../store/pricing-repo'
import { listAlerts, addAlert, toggleAlert, deleteAlert } from '../store/alerts-repo'
import { setSetting, getAllSettings } from '../store/settings-store'
import { SYNC_BACKUP_DIRECTORY_SETTING_KEY } from '@shared/sync-v2'
import { listProviders, getProvider } from '../providers/registry'
import { PROVIDER_CATALOG } from '@shared/provider-catalog'
import {
  getCatalogSyncStatus,
  previewCatalogNow,
  applyCatalogPreview,
  setCatalogAutoUpdate,
  syncCatalogNow
} from '../pricing/catalog-service'
import { refreshAll, restartAutoRefresh } from '../scheduler/refresh'
import {
  restartSessionAutoParse,
  SESSION_AUTO_PARSE_SETTING_KEY
} from '../scheduler/session-auto-parse'
import { fetchCodexUsage } from '../services/codex-usage'
import {
  getCnyRateQuote,
  getPricingExchangePolicy,
  setPricingExchangePolicy,
  withCnySpendConversion
} from '../services/exchange-rate'
import { syncAllSessions, discoverAllSessions } from '../log-parsers/sync'
import { detectClaudeKey, detectCodexKey } from '../log-parsers/cli-auth'
import { getCliDisplayPaths } from '../platform/paths'
import { statSync } from 'node:fs'
import {
  getSyncStatus,
  previewSync,
  listSyncDevices,
  loginSync,
  revokeSyncDevice,
  scheduleSyncAfterChange,
  syncNow
} from '../sync/service'

/**
 * Remove keys whose value is `undefined` so the object is assignable to types
 * declared with `exactOptionalPropertyTypes: true` (where `{ x?: string }` does
 * NOT accept an explicit `x: undefined`). Applied to zod parse output before
 * forwarding to store functions. Callers assert the target type - safe because
 * all undefined values have been dropped at runtime.
 *
 * 移除值为 undefined 的字段,使对象可赋值给 exactOptionalPropertyTypes 严格模式
 * 声明的类型;作用于 zod 解析后的输出后再传给 store 函数。 (glm-5.2)
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

/**
 * 注册全部 IPC 处理器:覆盖密钥、用量、价格、设置、告警、余额、Provider、
 * 本地日志同步与 CLI 密钥探测等模块。每个处理器使用 zod schema 校验入参。
 */
export function registerIpcHandlers(): void {
  // keys
  ipcMain.handle(IPC.keysList, () => listKeys())
  ipcMain.handle(IPC.keysAdd, (_e, input) => {
    const parsed = stripUndefined(
      apiKeyCreateInputSchema.parse(input)
    ) as unknown as ApiKeyCreateInput
    return addKey(parsed)
  })
  ipcMain.handle(IPC.keysUpdate, (_e, input) => {
    const parsed = stripUndefined(
      apiKeyUpdateInputSchema.parse(input)
    ) as unknown as ApiKeyUpdateInput
    const existing = getKey(parsed.id)
    if (!existing) throw new Error('api key not found')
    if (Object.prototype.hasOwnProperty.call(parsed, 'baseUrlOverride')) {
      const endpoint = validateProviderEndpoint(existing.providerId, parsed.baseUrlOverride)
      if (!endpoint.ok) throw new Error(endpoint.reason)
    }
    return updateKey(parsed)
  })
  ipcMain.handle(IPC.keysDelete, (_e, id: string) => {
    deleteKey(id)
    return { ok: true }
  })
  ipcMain.handle(IPC.keysTest, async (_e, id: string) => {
    const key = getDecryptedKey(id)
    const meta = listKeys().find((k) => k.id === id)
    if (!meta) throw new Error('key not found')
    const p = getProvider(meta.providerId)
    if (!p) throw new Error(`unknown provider: ${meta.providerId}`)
    const extra = getDecryptedExtraCredentials(id)
    const caps = p.build({ baseUrl: meta.baseUrlOverride ?? '', apiKey: key, extra })
    if (!caps.testConnection) return { ok: true, message: 'no test for this provider' }
    return caps.testConnection()
  })
  // PR-3: toggle per-row usage polling. The repo does not return the updated
  // record; the renderer refreshes via listKeys() to avoid a second round-trip
  // and to keep the store layer SELECT-only on read paths.
  ipcMain.handle(IPC.keysSetUsageQuery, (_e, args) => {
    const parsed = keysSetUsageQueryInputSchema.parse(args)
    toggleUsageQuery(parsed.id, parsed.enabled)
    return { ok: true }
  })
  // Import an existing CLI-installed key (Claude Code or Codex CLI) without
  // the full key ever crossing into the renderer. The renderer only learns
  // whether import succeeded; the decrypted key stays in the main process.
  ipcMain.handle(IPC.keysImportFromCLI, (_e, input: { source: 'claude' | 'codex' }) => {
    if (input.source === 'claude') {
      const d = detectClaudeKey()
      if (!d.found || !d.fullKey) {
        return { imported: false, reason: 'no Claude Code API key found on this machine' }
      }
      const record = addKey({
        providerId: 'anthropic-admin',
        alias: 'Claude Code (imported)',
        apiKey: d.fullKey,
        notes: `Imported from ${d.path} on ${new Date().toISOString().slice(0, 10)}`,
        source: 'api-key'
      })
      return { imported: true, key: record }
    }
    const d = detectCodexKey()
    if (!d.found || !d.fullKey) {
      return { imported: false, reason: 'no Codex CLI API key found on this machine' }
    }
    const record = addKey({
      providerId: 'openai-admin',
      alias: 'Codex CLI (imported)',
      apiKey: d.fullKey,
      notes: `Imported from ${d.path} on ${new Date().toISOString().slice(0, 10)}`,
      source: 'api-key'
    })
    return { imported: true, key: record }
  })

  // usage
  ipcMain.handle(IPC.usageGetDashboard, (_e, days?: number) => getDashboardSummary(days ?? 30))
  ipcMain.handle(IPC.usageGetTotalSpend, async (_e, days?: number) =>
    withCnySpendConversion(computeTotalSpend(days ?? 30))
  )
  ipcMain.handle(IPC.usageGetModelSpend, (_e, filter) => {
    const parsed = stripUndefined(usageFilterSchema.parse(filter ?? {})) as unknown as {
      fromISO?: string
      toISO?: string
    }
    return computeModelSpend(parsed)
  })
  ipcMain.handle(IPC.usageGetLogs, (_e, filter) => {
    const parsed = stripUndefined(usageFilterSchema.parse(filter ?? {})) as unknown as Parameters<
      typeof queryUsage
    >[0]
    return queryUsage(parsed)
  })
  ipcMain.handle(IPC.usageGetLogsPage, (_e, filter) => {
    const parsed = stripUndefined(usageFilterSchema.parse(filter ?? {})) as unknown as Parameters<
      typeof queryUsagePage
    >[0]
    return queryUsagePage(parsed)
  })
  ipcMain.handle(IPC.usageGetKeySpend, (_e, args: { apiKeyId: string; days?: number }) => {
    // Per-key spend estimate. The schema check is intentionally light — the
    // renderer passes a uuid + an optional positive days integer, both of
    // which JS already type-checks at the boundary. We avoid a zod schema
    // here to keep the hot path allocation-free.
    if (typeof args?.apiKeyId !== 'string' || args.apiKeyId.length === 0) {
      throw new Error('usageGetKeySpend: apiKeyId is required')
    }
    const days = typeof args.days === 'number' && args.days > 0 ? Math.floor(args.days) : 30
    return computeSpendByKey(args.apiKeyId, days)
  })
  ipcMain.handle(IPC.usageRefreshAll, async () => {
    const queued = listKeys().length
    const result = await refreshAll()
    return { started: true, queued, ...result }
  })
  // Electron net.fetch follows Chromium's system proxy configuration. Node's
  // global fetch does not, which breaks ChatGPT usage lookup on proxied desktops.
  ipcMain.handle(IPC.codexUsage, () => fetchCodexUsage(net.fetch))

  // Sync status exposes only non-sensitive state; tokens stay in main.
  ipcMain.handle(IPC.syncStatus, () => getSyncStatus())
  ipcMain.handle(IPC.syncPreview, (_e, mode) => previewSync(syncModeSchema.parse(mode)))
  ipcMain.handle(IPC.syncNow, async () => {
    await syncNow()
    return { started: true }
  })
  ipcMain.handle(IPC.syncOnline, async () => {
    await syncNow()
    return { started: true }
  })
  ipcMain.handle(IPC.syncLogin, async (_e, input) => {
    return loginSync(syncLoginInputSchema.parse(input))
  })
  ipcMain.handle(IPC.syncDevices, () => listSyncDevices())
  ipcMain.handle(IPC.syncRevokeDevice, async (_e, input) => {
    await revokeSyncDevice(syncDeviceIdInputSchema.parse(input).deviceId)
    return { ok: true }
  })

  // pricing
  ipcMain.handle(IPC.pricingList, () => listPricing())
  ipcMain.handle(IPC.pricingSet, (_e, entry) => {
    const parsed = stripUndefined(pricingSetInputSchema.parse(entry)) as unknown as Omit<
      PricingEntry,
      'id' | 'updatedAt'
    >
    // Anything edited through the UI is a user override. Catalog rows are
    // written only by the trusted models.dev sync path.
    const result = setPricing({ ...parsed, source: 'user' })
    scheduleSyncAfterChange()
    return result
  })
  ipcMain.handle(IPC.pricingRestore, (_e, id: number) => {
    deletePricing(id)
    scheduleSyncAfterChange()
    return { ok: true }
  })
  ipcMain.handle(IPC.pricingCatalog, () => syncCatalogNow())
  ipcMain.handle(IPC.pricingCatalogPreview, () => previewCatalogNow())
  ipcMain.handle(IPC.pricingCatalogApply, (_e, input) => {
    const parsed = pricingCatalogApplyInputSchema.parse(input)
    const result = applyCatalogPreview(parsed.previewId)
    return result
  })
  ipcMain.handle(IPC.pricingHistory, (_e, limit?: unknown) =>
    listPricingHistory(typeof limit === 'number' ? limit : 100)
  )
  ipcMain.handle(IPC.pricingExchangePolicy, () => getPricingExchangePolicy())
  ipcMain.handle(IPC.pricingExchangePolicySet, (_e, input) =>
    setPricingExchangePolicy(pricingExchangePolicySetInputSchema.parse(input))
  )
  ipcMain.handle(IPC.pricingCatalogStatus, () => getCatalogSyncStatus())
  ipcMain.handle(IPC.pricingCatalogAutoUpdate, (_e, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new Error('pricing auto-update must be boolean')
    return setCatalogAutoUpdate(enabled)
  })
  ipcMain.handle(IPC.pricingCnyRate, () => getCnyRateQuote('USD'))

  // settings
  ipcMain.handle(IPC.settingsGet, () => getAllSettings())
  ipcMain.handle(IPC.settingsSet, (_e, kv: { key: string; value: unknown }) => {
    const parsed = settingsSetInputSchema.parse(kv)
    if (parsed.key === SESSION_AUTO_PARSE_SETTING_KEY && typeof parsed.value !== 'boolean') {
      throw new Error('session auto-parse setting must be boolean')
    }
    setSetting(parsed.key, parsed.value)
    scheduleSyncAfterChange()
    // Changing the refresh interval must reconfigure the running timer so the
    // new value takes effect immediately (no app restart required).
    if (parsed.key === 'refresh_interval_min') {
      restartAutoRefresh()
      restartSessionAutoParse({ runImmediately: false })
    } else if (parsed.key === SESSION_AUTO_PARSE_SETTING_KEY) {
      restartSessionAutoParse()
    }
    return { ok: true }
  })
  ipcMain.handle(IPC.settingsChooseDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    const selected = result.canceled ? null : (result.filePaths[0] ?? null)
    if (selected) setSetting(SYNC_BACKUP_DIRECTORY_SETTING_KEY, selected)
    return selected
  })

  // alerts
  ipcMain.handle(IPC.alertsList, () => listAlerts())
  ipcMain.handle(IPC.alertsAdd, (_e, input) => {
    const parsed = stripUndefined(alertAddInputSchema.parse(input)) as unknown as Omit<
      AlertRule,
      'id' | 'createdAt' | 'enabled' | 'lastTriggeredAt'
    > & { enabled?: boolean }
    return addAlert(parsed)
  })
  ipcMain.handle(IPC.alertsToggle, (_e, args: { id: string; enabled: boolean }) => {
    const parsed = alertToggleInputSchema.parse(args)
    toggleAlert(parsed.id, parsed.enabled)
    return { ok: true }
  })
  ipcMain.handle(IPC.alertsDelete, (_e, id: string) => {
    deleteAlert(id)
    return { ok: true }
  })

  // balance
  ipcMain.handle(IPC.balanceListLatest, () => latestBalances())

  // providers
  ipcMain.handle(IPC.providersList, () => listProviders())
  // Provider UI catalog — the rich metadata the renderer needs to render the
  // "create new key" modal (default URL, signup link, suggested models, hint).
  // Kept separate from `providersList` so the IPC payload for the simple list
  // stays small (manifest-only) while the modal gets the full picture.
  ipcMain.handle(IPC.providersCatalog, () => PROVIDER_CATALOG)

  // Local log parsing (Phase D2): discover + sync session JSONL files, detect
  // existing CLI keys for one-click import, and open log folders in the OS.
  ipcMain.handle(IPC.logDiscover, () => discoverAllSessions())
  ipcMain.handle(IPC.logLocations, () => getCliDisplayPaths())
  ipcMain.handle(IPC.logSync, (_e, input) => {
    const parsed = logSyncInputSchema.parse(input)
    const win = BrowserWindow.getAllWindows()[0]
    let result: {
      source: string
      totals: { lines: number; tokens: number; inserted: number }
      error?: string
    }
    try {
      result = syncAllSessions(parsed.source, (p) => {
        win?.webContents.send(IPC.logSyncProgress, p)
      })
    } catch (e) {
      // Never leave the renderer's progress UI hanging — always emit a done
      // event even when sync threw (DB locked, disk error, parse crash).
      result = {
        source: parsed.source,
        totals: { lines: 0, tokens: 0, inserted: 0 },
        error: (e as Error).message
      }
    }
    win?.webContents.send(IPC.logSyncDone, result)
    return { started: true }
  })
  // Detect keys: return masked + path ONLY — never the full key — to the renderer.
  ipcMain.handle(IPC.logDetectClaudeKey, () => {
    const d = detectClaudeKey()
    return { found: d.found, maskedKey: d.maskedKey, path: d.path }
  })
  ipcMain.handle(IPC.logDetectCodexKey, () => {
    const d = detectCodexKey()
    return { found: d.found, maskedKey: d.maskedKey, path: d.path }
  })
  ipcMain.handle(IPC.logOpenFolder, (_e, input) => {
    const parsed = logOpenFolderInputSchema.parse(input)
    // Validate the path is a directory before handing to shell.openPath —
    // openPath will EXECUTE .exe/.bat/.cmd files on Windows, so a file path
    // (vs a directory) is rejected to prevent arbitrary execution.
    try {
      const st = statSync(parsed.path)
      if (!st.isDirectory()) {
        return { ok: false, path: parsed.path, error: 'path is not a directory' }
      }
    } catch (e) {
      return { ok: false, path: parsed.path, error: (e as Error).message }
    }
    void shell.openPath(parsed.path)
    return { ok: true, path: parsed.path }
  })
}
