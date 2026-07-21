import { describe, expect, it } from 'vitest'
import {
  buildModelCompareSummary,
  modelDisplayName,
  modelTokenSegments
} from '../../../code/src/shared/utils/model-compare'
import type { ModelSpendAggregate } from '../../../code/src/shared/types/usage'

function model(overrides: Partial<ModelSpendAggregate> = {}): ModelSpendAggregate {
  return {
    model: 'openai/gpt-5',
    providers: ['openrouter'],
    total: 1.2,
    currency: 'USD',
    byCurrency: [{ currency: 'USD', amount: 1.2 }],
    tokens: 100,
    inputTokens: 60,
    outputTokens: 30,
    cacheReadTokens: 10,
    cacheCreationTokens: 0,
    requests: 4,
    pricedRequests: 3,
    unpricedRequests: 1,
    ...overrides
  }
}

describe('model comparison presentation', () => {
  it('uses the leaf model name while retaining a safe unknown fallback', () => {
    expect(modelDisplayName('openrouter/moonshotai/kimi-k3')).toBe('kimi-k3')
    expect(modelDisplayName('gpt-5')).toBe('gpt-5')
    expect(modelDisplayName('   ')).toBe('未知模型')
  })

  it('aggregates requests, tokens, and priced coverage', () => {
    expect(
      buildModelCompareSummary([
        model(),
        model({ model: 'claude-sonnet-4', requests: 6, tokens: 300, pricedRequests: 6 })
      ])
    ).toEqual({
      modelCount: 2,
      requests: 10,
      tokens: 400,
      pricedRequests: 9,
      coverage: 0.9
    })
  })

  it('builds non-empty token segments with normalized shares', () => {
    const segments = modelTokenSegments(model())
    expect(segments.map((segment) => segment.key)).toEqual(['input', 'output', 'cache-read'])
    expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1)
  })
})
