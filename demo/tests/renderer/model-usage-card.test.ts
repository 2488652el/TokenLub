import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelUsageCard } from '../../../code/src/renderer/components/ModelUsageCard'
import type { ModelSpendAggregate } from '../../../code/src/shared/types/usage'

const model: ModelSpendAggregate = {
  model: 'openrouter/moonshotai/kimi-k3',
  providers: ['openrouter', 'moonshot'],
  total: 2.4,
  currency: 'USD',
  byCurrency: [{ currency: 'USD', amount: 2.4 }],
  tokens: 1800,
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 300,
  cacheCreationTokens: 0,
  requests: 12,
  pricedRequests: 10,
  unpricedRequests: 2
}

describe('ModelUsageCard', () => {
  it('renders the model logo, provider chips, token composition, and pricing coverage', () => {
    const html = renderToStaticMarkup(createElement(ModelUsageCard, { model, rank: 1 }))

    expect(html).toContain('aria-label="kimi-k3 模型 Logo"')
    expect(html).toContain('openrouter/moonshotai/kimi-k3')
    expect(html).toContain('Token 构成')
    expect(html).toContain('计价覆盖')
    expect(html).toContain('10/12 · 83%')
    expect(html).toContain('2 次请求尚未匹配价格')
  })
})
