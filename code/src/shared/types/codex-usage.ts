/** ChatGPT/Codex 订阅额度窗口。 */
export interface CodexUsageWindow {
  usedPercent: number
  remainingPercent: number
  windowSeconds: number
  resetAt: string | null
}

/** 从 ChatGPT 内部 Codex 用量接口标准化后的非敏感快照。 */
export interface CodexUsageSnapshot {
  fetchedAt: string
  planType: string | null
  fiveHour: CodexUsageWindow | null
  oneWeek: CodexUsageWindow | null
}
