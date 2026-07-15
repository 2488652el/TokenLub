import type { SyncMode } from './sync-mode'

export type SyncPreview = {
  mode: SyncMode
  settings: number
  pricing: number
  balance: number
  expectedUploads: number
  risk: string
  backupDirectory: string | null
}
