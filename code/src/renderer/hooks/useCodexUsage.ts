import { useCallback, useEffect, useState } from 'react'
import type { CodexUsageSnapshot } from '../../shared/types/codex-usage'

const REFRESH_INTERVAL_MS = 30_000

/** 加载 Codex 订阅额度，并按参考实现每 30 秒静默刷新。 */
export function useCodexUsage() {
  const [usage, setUsage] = useState<CodexUsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setUsage(await window.api.codex.usage())
      setError(null)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(true), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  return { usage, loading, error, refresh }
}
