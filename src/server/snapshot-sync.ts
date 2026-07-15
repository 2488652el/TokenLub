import type { MaybePromise, Phase1Device } from './phase1'
import {
  EMPTY_SYNC_V2_SNAPSHOT,
  MAX_SYNC_V2_BYTES,
  MAX_SYNC_V2_BALANCES,
  SYNCABLE_SETTING_KEYS,
  type SyncV2BalanceSnapshot,
  type SyncV2ExchangeResult,
  type SyncV2PricingEntry,
  type SyncV2Snapshot,
  type SyncV2Strategy
} from '../shared/sync-v2'
import { normalizeBillingScope } from '../shared/pricing-scope'

export type StoredSyncV2Snapshot = {
  revision: number
  snapshot: SyncV2Snapshot
  updatedAt: string
}

export type SnapshotSyncStore = {
  getDevice(id: string): MaybePromise<Phase1Device | undefined>
  getSyncV2Snapshot(userId: string): MaybePromise<StoredSyncV2Snapshot | undefined>
  compareAndSwapSyncV2Snapshot(input: {
    userId: string
    expectedRevision: number
    snapshot: SyncV2Snapshot
    updatedAt: string
  }): MaybePromise<StoredSyncV2Snapshot | undefined>
}

const SENSITIVE_SETTING_KEY = /(?:api[_-]?key|auth|credential|password|secret|token)/i
const SYNCABLE_SETTINGS = new Set<string>(SYNCABLE_SETTING_KEYS)
const MAX_EXCHANGE_ATTEMPTS = 4

export class SnapshotSyncService {
  private readonly store: SnapshotSyncStore
  private readonly now: () => Date

  constructor(options: { store: SnapshotSyncStore; now?: () => Date }) {
    this.store = options.store
    this.now = options.now ?? (() => new Date())
  }

  async exchange(input: {
    userId: string
    deviceId: string
    baseRevision: number
    strategy: SyncV2Strategy
    snapshot: SyncV2Snapshot
  }): Promise<SyncV2ExchangeResult> {
    await this.requireDevice(input.userId, input.deviceId)
    if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) {
      throw new Error('invalid sync revision')
    }
    const local = normalizeSnapshot(input.snapshot)

    for (let attempt = 0; attempt < MAX_EXCHANGE_ATTEMPTS; attempt++) {
      const remote = await this.store.getSyncV2Snapshot(input.userId)
      if (input.strategy === 'restore') {
        return result(remote, false, false, this.now())
      }

      const currentRevision = remote?.revision ?? 0
      if (input.strategy === 'merge' && input.baseRevision !== currentRevision) {
        return result(remote, false, false, this.now())
      }
      // A merge request whose base revision is current already contains the
      // client's canonical, rebased snapshot. Treat it as replacement so
      // deletions are preserved instead of resurrected by a set union.
      const candidate =
        input.strategy === 'upload'
          ? local
          : {
              settings: local.settings,
              pricing: local.pricing,
              balances: mergeBalanceHistory(remote?.snapshot.balances ?? [], local.balances)
            }
      const next = fitSnapshotWithinLimit(candidate)
      if (remote && snapshotsEqual(remote.snapshot, next)) {
        return result(remote, false, true, this.now())
      }
      if (!remote && snapshotsEqual(EMPTY_SYNC_V2_SNAPSHOT, next)) {
        return result(undefined, false, true, this.now())
      }

      const stored = await this.store.compareAndSwapSyncV2Snapshot({
        userId: input.userId,
        expectedRevision: currentRevision,
        snapshot: next,
        updatedAt: this.now().toISOString()
      })
      if (stored) return result(stored, true, true, this.now())
    }
    throw new Error('sync exchange contention')
  }

  async status(input: { userId: string; deviceId: string }): Promise<{
    revision: number
    lastSuccessAt: string | null
    total: number
    byType: Record<string, number>
    estimatedBytes: number
  }> {
    await this.requireDevice(input.userId, input.deviceId)
    const stored = await this.store.getSyncV2Snapshot(input.userId)
    const snapshot = normalizeSnapshot(stored?.snapshot ?? EMPTY_SYNC_V2_SNAPSHOT)
    const byType = {
      setting: Object.keys(snapshot.settings).length,
      model_pricing: snapshot.pricing.length,
      balance_snapshot: snapshot.balances.length
    }
    return {
      revision: stored?.revision ?? 0,
      lastSuccessAt: stored?.updatedAt ?? null,
      total: Object.values(byType).reduce((sum, count) => sum + count, 0),
      byType,
      estimatedBytes: Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
    }
  }

  private async requireDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.store.getDevice(deviceId)
    if (!device || device.userId !== userId) throw new Error('device not found')
    if (device.revokedAt) throw new Error('device revoked')
  }
}

export function normalizeSnapshot(snapshot: SyncV2Snapshot): SyncV2Snapshot {
  if (!isPlainObject(snapshot) || !isPlainObject(snapshot.settings)) {
    throw new Error('invalid sync snapshot')
  }
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot.settings)) {
    if (!key || SENSITIVE_SETTING_KEY.test(key))
      throw new Error('sensitive setting cannot be synced')
    if (!SYNCABLE_SETTINGS.has(key)) throw new Error('unsupported sync setting')
    settings[key] = cloneJson(value)
  }
  if (!Array.isArray(snapshot.pricing) || !Array.isArray(snapshot.balances)) {
    throw new Error('invalid sync snapshot')
  }
  const pricing = snapshot.pricing.map(normalizePricing)
  const balances = snapshot.balances.map(normalizeBalance)
  return {
    settings,
    pricing: dedupeBy(pricing, pricingKey),
    balances: newestBalances(dedupeBy(balances, (item) => item.id))
  }
}

function normalizePricing(entry: SyncV2PricingEntry): SyncV2PricingEntry {
  if (!isPlainObject(entry)) throw new Error('invalid pricing snapshot')
  const result: SyncV2PricingEntry = {
    providerId: requiredString(entry.providerId, 'invalid pricing provider'),
    billingScope: normalizeBillingScope(
      entry.billingScope === undefined
        ? undefined
        : requiredString(entry.billingScope, 'invalid pricing scope')
    ),
    model: requiredString(entry.model, 'invalid pricing model'),
    currency: requiredString(entry.currency, 'invalid pricing currency'),
    promptPricePerMtok: finiteNumber(entry.promptPricePerMtok, 'invalid prompt price'),
    completionPricePerMtok: finiteNumber(entry.completionPricePerMtok, 'invalid completion price'),
    source: entry.source === 'catalog' ? 'catalog' : 'user',
    catalogActive: entry.catalogActive !== false
  }
  if (entry.cacheReadPricePerMtok !== undefined) {
    result.cacheReadPricePerMtok = nullableFiniteNumber(entry.cacheReadPricePerMtok)
  }
  if (entry.cacheCreationPricePerMtok !== undefined) {
    result.cacheCreationPricePerMtok = nullableFiniteNumber(entry.cacheCreationPricePerMtok)
  }
  return result
}

function normalizeBalance(entry: SyncV2BalanceSnapshot): SyncV2BalanceSnapshot {
  if (!isPlainObject(entry)) throw new Error('invalid balance snapshot')
  const result: SyncV2BalanceSnapshot = {
    id: requiredString(entry.id, 'invalid balance id'),
    providerId: requiredString(entry.providerId, 'invalid balance provider'),
    capturedAt: requiredString(entry.capturedAt, 'invalid balance timestamp')
  }
  for (const key of ['total', 'used', 'remaining'] as const) {
    if (entry[key] !== undefined) result[key] = finiteNumber(entry[key], `invalid balance ${key}`)
  }
  if (entry.currency !== undefined) {
    result.currency = requiredString(entry.currency, 'invalid balance currency')
  }
  return result
}

function result(
  stored: StoredSyncV2Snapshot | undefined,
  changed: boolean,
  accepted: boolean,
  now: Date
): SyncV2ExchangeResult {
  return {
    revision: stored?.revision ?? 0,
    serverTime: now.toISOString(),
    snapshot: normalizeSnapshot(stored?.snapshot ?? EMPTY_SYNC_V2_SNAPSHOT),
    changed,
    accepted
  }
}

function snapshotsEqual(left: SyncV2Snapshot, right: SyncV2Snapshot): boolean {
  return JSON.stringify(normalizeSnapshot(left)) === JSON.stringify(normalizeSnapshot(right))
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const result = new Map<string, T>()
  for (const item of items) result.set(key(item), item)
  return [...result.values()]
}

function pricingKey(entry: SyncV2PricingEntry): string {
  return `${entry.providerId}:${normalizeBillingScope(entry.billingScope)}:${entry.model}:${entry.currency}`
}

function mergeBalanceHistory(
  remote: SyncV2BalanceSnapshot[],
  local: SyncV2BalanceSnapshot[]
): SyncV2BalanceSnapshot[] {
  return newestBalances(dedupeBy([...remote, ...local], (item) => item.id))
}

function newestBalances(items: SyncV2BalanceSnapshot[]): SyncV2BalanceSnapshot[] {
  return items
    .sort((left, right) => {
      const byTime = right.capturedAt.localeCompare(left.capturedAt)
      return byTime === 0 ? right.id.localeCompare(left.id) : byTime
    })
    .slice(0, MAX_SYNC_V2_BALANCES)
}

function fitSnapshotWithinLimit(snapshot: SyncV2Snapshot): SyncV2Snapshot {
  if (snapshotBytes(snapshot) <= MAX_SYNC_V2_BYTES) return snapshot
  let low = 0
  let high = snapshot.balances.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = { ...snapshot, balances: snapshot.balances.slice(0, middle) }
    if (snapshotBytes(candidate) <= MAX_SYNC_V2_BYTES) low = middle
    else high = middle - 1
  }
  const bounded = { ...snapshot, balances: snapshot.balances.slice(0, low) }
  if (snapshotBytes(bounded) > MAX_SYNC_V2_BYTES) throw new Error('sync snapshot too large')
  return bounded
}

function snapshotBytes(snapshot: SyncV2Snapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(error)
  return value
}

function finiteNumber(value: unknown, error: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(error)
  return value
}

function nullableFiniteNumber(value: unknown): number | null {
  if (value === null) return null
  return finiteNumber(value, 'invalid nullable price')
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) throw new Error('setting value must be JSON')
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    throw new Error('setting value must be JSON')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
