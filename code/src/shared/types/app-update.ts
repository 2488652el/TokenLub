export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'unsupported'

export interface AppUpdateStatus {
  phase: AppUpdatePhase
  currentVersion: string
  latestVersion?: string
  percent?: number
  message?: string
  checkedAt?: string
}
