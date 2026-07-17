import type { SyncClient } from './client'
import type { SyncMode } from '../../shared/sync-mode'
import { EMPTY_SYNC_V2_SNAPSHOT, rebaseSyncV2Snapshot } from '../../shared/sync-v2'
import {
  applySyncV2Snapshot,
  createSyncV2Snapshot,
  getSyncV2BaseSnapshot,
  getSyncV2MutationGeneration,
  hasValidSyncV2BaseSnapshot,
  getSyncV2Revision,
  isSyncV2Dirty
} from '../store/sync-v2-repo'

export async function runSyncV2Once(
  client: SyncClient,
  mode: SyncMode = 'merge',
  shouldApply: () => boolean = () => true
): Promise<{ revision: number; serverTime: string; changed: boolean }> {
  const baseRevision = getSyncV2Revision()
  const local = createSyncV2Snapshot()
  const base = getSyncV2BaseSnapshot()
  const dirty = isSyncV2Dirty()
  const generation = getSyncV2MutationGeneration()
  if (mode === 'merge' && dirty && baseRevision > 0 && !hasValidSyncV2BaseSnapshot()) {
    throw new Error('sync baseline unavailable; choose upload or restore')
  }
  let result = await client.exchange({
    baseRevision,
    strategy: mode,
    snapshot: mode === 'restore' ? EMPTY_SYNC_V2_SNAPSHOT : local
  })
  for (let attempt = 0; mode === 'merge' && dirty && !result.accepted && attempt < 3; attempt++) {
    result = await client.exchange({
      baseRevision: result.revision,
      strategy: 'merge',
      snapshot: rebaseSyncV2Snapshot(base, result.snapshot, local)
    })
  }
  if (mode === 'merge' && dirty && !result.accepted) {
    throw new Error('sync exchange contention')
  }
  if (!Number.isSafeInteger(result.revision) || result.revision < 0) {
    throw new Error('sync response invalid')
  }
  if (shouldApply()) {
    applySyncV2Snapshot(
      result.snapshot,
      result.revision,
      result.serverTime,
      generation,
      mode === 'restore'
    )
  }
  return {
    revision: result.revision,
    serverTime: result.serverTime,
    changed: result.changed
  }
}
