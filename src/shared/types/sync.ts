export type LocalSyncMode = 'local-only'

export type LocalSyncStatusState = 'idle' | 'pending' | 'needs_bootstrap' | 'error'

export interface LocalSyncStatus {
  mode: LocalSyncMode
  state: LocalSyncStatusState
  pendingOutboxCount: number
  openConflictCount: number
  cursorPresent: boolean
  lastSuccessAt: string | null
  lastErrorCode: string | null
  bootstrapRequired: boolean
}
