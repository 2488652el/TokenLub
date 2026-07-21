import type { ModelSpendAggregate } from '../types/usage'

export type ModelCompareSummary = {
  modelCount: number
  requests: number
  tokens: number
  pricedRequests: number
  coverage: number
}

export type ModelTokenSegment = {
  key: 'input' | 'output' | 'cache-read' | 'cache-write'
  label: string
  value: number
  share: number
}

export function modelDisplayName(model: string): string {
  const normalized = model.trim()
  if (!normalized) return '未知模型'
  return normalized.split('/').at(-1) || normalized
}

export function buildModelCompareSummary(
  models: readonly ModelSpendAggregate[]
): ModelCompareSummary {
  const summary = models.reduce(
    (result, model) => {
      result.requests += model.requests
      result.tokens += model.tokens
      result.pricedRequests += model.pricedRequests
      return result
    },
    { requests: 0, tokens: 0, pricedRequests: 0 }
  )

  return {
    modelCount: models.length,
    ...summary,
    coverage: summary.requests > 0 ? summary.pricedRequests / summary.requests : 0
  }
}

export function modelTokenSegments(model: ModelSpendAggregate): ModelTokenSegment[] {
  const entries = [
    { key: 'input' as const, label: 'Input', value: model.inputTokens },
    { key: 'output' as const, label: 'Output', value: model.outputTokens },
    { key: 'cache-read' as const, label: 'Cache Read', value: model.cacheReadTokens },
    { key: 'cache-write' as const, label: 'Cache Write', value: model.cacheCreationTokens }
  ]
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.value), 0)

  return entries
    .filter((entry) => entry.value > 0)
    .map((entry) => ({
      ...entry,
      share: total > 0 ? entry.value / total : 0
    }))
}
