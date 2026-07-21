import { normalizeBillingScope } from './pricing-scope'

export const SYNC_V2_PROTOCOL_VERSION = 2
export const MAX_SYNC_V2_BYTES = 2 * 1024 * 1024
export const MAX_SYNC_V2_BALANCES = 5_000
export const SYNC_BACKUP_DIRECTORY_SETTING_KEY = 'sync_backup_directory'

export const SYNCABLE_SETTING_KEYS = ['refresh_interval_min', 'session_auto_parse_enabled'] as const

export type SyncV2Strategy = 'merge' | 'upload' | 'restore'

export type SyncV2PricingEntry = {
  providerId: string
  billingScope?: string
  model: string
  currency: string
  promptPricePerMtok: number
  completionPricePerMtok: number
  cacheReadPricePerMtok?: number | null
  cacheCreationPricePerMtok?: number | null
  source: 'catalog' | 'user'
  catalogActive?: boolean
}

export type SyncV2BalanceSnapshot = {
  id: string
  providerId: string
  capturedAt: string
  total?: number
  used?: number
  remaining?: number
  currency?: string
}

export type SyncV2Snapshot = {
  settings: Record<string, unknown>
  pricing: SyncV2PricingEntry[]
  balances: SyncV2BalanceSnapshot[]
}

export type SyncV2ExchangeRequest = {
  protocolVersion: typeof SYNC_V2_PROTOCOL_VERSION
  deviceId: string
  baseRevision: number
  strategy: SyncV2Strategy
  snapshot: SyncV2Snapshot
}

export type SyncV2ExchangeResult = {
  revision: number
  serverTime: string
  snapshot: SyncV2Snapshot
  changed: boolean
  accepted: boolean
}

export const EMPTY_SYNC_V2_SNAPSHOT: SyncV2Snapshot = {
  settings: {},
  pricing: [],
  balances: []
}

export function rebaseSyncV2Snapshot(
  base: SyncV2Snapshot,
  remote: SyncV2Snapshot,
  local: SyncV2Snapshot
): SyncV2Snapshot {
  return {
    settings: rebaseRecord(base.settings, remote.settings, local.settings),
    pricing: rebaseByKey(
      base.pricing,
      remote.pricing,
      local.pricing,
      (entry) =>
        `${entry.providerId}:${normalizeBillingScope(entry.billingScope)}:${entry.model}:${entry.currency}`
    ),
    balances: rebaseByKey(base.balances, remote.balances, local.balances, (entry) => entry.id)
  }
}

function rebaseRecord(
  base: Record<string, unknown>,
  remote: Record<string, unknown>,
  local: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...remote }
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (jsonEqual(base[key], local[key])) continue
    if (key in local) result[key] = local[key]
    else delete result[key]
  }
  return result
}

function rebaseByKey<T>(base: T[], remote: T[], local: T[], key: (item: T) => string): T[] {
  const baseMap = new Map(base.map((item) => [key(item), item]))
  const result = new Map(remote.map((item) => [key(item), item]))
  const localMap = new Map(local.map((item) => [key(item), item]))
  for (const itemKey of new Set([...baseMap.keys(), ...localMap.keys()])) {
    if (jsonEqual(baseMap.get(itemKey), localMap.get(itemKey))) continue
    const localItem = localMap.get(itemKey)
    if (localItem === undefined) result.delete(itemKey)
    else result.set(itemKey, localItem)
  }
  return [...result.values()]
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
