import { syncAllSessions } from '../log-parsers/sync'
import { getSetting } from '../store/settings-store'

export const SESSION_AUTO_PARSE_SETTING_KEY = 'session_auto_parse_enabled'

const DEFAULT_INTERVAL_MIN = 30
let timer: NodeJS.Timeout | null = null

function clearSessionAutoParse(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

function getIntervalMs(): number | null {
  const value = getSetting<number>('refresh_interval_min') ?? DEFAULT_INTERVAL_MIN
  return Number.isFinite(value) && value > 0 ? value * 60 * 1000 : null
}

/** Parse local CLI session logs when the persisted auto-parse setting is enabled. */
export function runSessionAutoParse(): void {
  if (getSetting<boolean>(SESSION_AUTO_PARSE_SETTING_KEY) !== true) return

  for (const source of ['claude-code', 'codex'] as const) {
    try {
      syncAllSessions(source)
    } catch (error) {
      console.error(`[session-auto-parse] ${source} failed:`, (error as Error).message)
    }
  }
}

/**
 * Start the main-process session parser. It follows the existing refresh interval
 * so automatic work has one application-wide cadence.
 */
export function startSessionAutoParse(options: { runImmediately?: boolean } = {}): void {
  if (timer || getSetting<boolean>(SESSION_AUTO_PARSE_SETTING_KEY) !== true) return

  if (options.runImmediately !== false) runSessionAutoParse()

  const intervalMs = getIntervalMs()
  if (intervalMs === null) return
  timer = setInterval(runSessionAutoParse, intervalMs)
  timer.unref?.()
}

/** Apply the latest persisted switch/interval values to the running parser. */
export function restartSessionAutoParse(options: { runImmediately?: boolean } = {}): void {
  clearSessionAutoParse()
  startSessionAutoParse(options)
}
