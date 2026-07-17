export type ServerMetricsSnapshot = {
  requests: number
  byStatus: Record<string, number>
  byRoute: Record<string, number>
  latencyMs: { p50: number; p95: number; p99: number; max: number }
  counters: Record<string, number>
}

export function createServerMetrics() {
  let requests = 0
  let max = 0
  const byStatus: Record<string, number> = {}
  const byRoute: Record<string, number> = {}
  const counters: Record<string, number> = {}
  const samples: number[] = []

  return {
    record(method: string, path: string, status: number, elapsedMs: number): void {
      requests++
      byStatus[status] = (byStatus[status] ?? 0) + 1
      const route = `${method} ${path.split('/').slice(0, 3).join('/') || '/'}`
      byRoute[route] = (byRoute[route] ?? 0) + 1
      const elapsed = Math.max(0, Math.round(elapsedMs))
      max = Math.max(max, elapsed)
      samples.push(elapsed)
      if (samples.length > 1_000) samples.shift()
    },
    increment(name: string, amount = 1): void {
      counters[name] = (counters[name] ?? 0) + amount
    },
    snapshot(): ServerMetricsSnapshot {
      const sorted = [...samples].sort((a, b) => a - b)
      const percentile = (ratio: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
      return {
        requests,
        byStatus: { ...byStatus },
        byRoute: { ...byRoute },
        counters: { ...counters },
        latencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max }
      }
    }
  }
}
