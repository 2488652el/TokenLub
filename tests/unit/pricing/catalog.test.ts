/**
 * pricing catalog 单元测试:覆盖 PROVIDER_MAPPING / transformCatalogEntry / syncCatalog,
 * 校验 models.dev 目录的拉取、转换与 upsert 流程。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  transformCatalogEntry,
  syncCatalog,
  PROVIDER_MAPPING,
  CATALOG_URL
} from '../../../src/main/pricing/catalog'
import type { PricingEntry } from '../../../src/shared/types/pricing'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

// PROVIDER_MAPPING:models.dev 前缀到 TokenLub providerId 的映射
describe('PROVIDER_MAPPING', () => {
  it('maps models.dev prefixes to TokenLub providerIds', () => {
    expect(PROVIDER_MAPPING.anthropic).toBe('anthropic-admin')
    expect(PROVIDER_MAPPING.openai).toBe('openai-admin')
    expect(PROVIDER_MAPPING.deepseek).toBe('deepseek')
    expect(PROVIDER_MAPPING.moonshotai).toBe('moonshot')
    expect(PROVIDER_MAPPING.qwen).toBe('qwen-manual')
    expect(PROVIDER_MAPPING.stepfun).toBe('stepfun')
  })
})

// transformCatalogEntry:将目录条目转换为内部 PricingEntry,含价格单位换算与异常过滤
describe('transformCatalogEntry', () => {
  it('converts a standard anthropic entry with cache prices and ×1e6 unit', () => {
    const raw = {
      id: 'anthropic/claude-opus-4.7-fast',
      name: 'Anthropic: Claude Opus 4.7 (Fast)',
      pricing: {
        prompt: '0.00003',
        completion: '0.00015',
        input_cache_read: '0.000003',
        input_cache_write: '0.0000375'
      }
    }
    const e = transformCatalogEntry(raw)!
    expect(e.providerId).toBe('anthropic-admin')
    expect(e.model).toBe('claude-opus-4.7-fast')
    // 0.00003 * 1_000_000 = 30
    expect(e.promptPricePerMtok).toBe(30)
    // 0.00015 * 1_000_000 = 150
    expect(e.completionPricePerMtok).toBe(150)
    expect(e.cacheReadPricePerMtok).toBe(3)
    expect(e.cacheCreationPricePerMtok).toBeCloseTo(37.5, 5)
    expect(e.currency).toBe('USD')
    expect(e.source).toBe('catalog')
  })

  it('converts a deepseek entry', () => {
    const raw = {
      id: 'deepseek/deepseek-chat',
      pricing: { prompt: '0.00000014', completion: '0.00000028' }
    }
    const e = transformCatalogEntry(raw)!
    expect(e.providerId).toBe('deepseek')
    expect(e.model).toBe('deepseek-chat')
    expect(e.promptPricePerMtok).toBeCloseTo(0.14, 5)
    expect(e.completionPricePerMtok).toBeCloseTo(0.28, 5)
    expect(e.cacheReadPricePerMtok).toBeUndefined()
    expect(e.cacheCreationPricePerMtok).toBeUndefined()
  })

  it('handles free models (price "0")', () => {
    const raw = {
      id: 'openai/gpt-4o-mini:free',
      pricing: { prompt: '0', completion: '0' }
    }
    const e = transformCatalogEntry(raw)!
    expect(e.providerId).toBe('openai-admin')
    expect(e.promptPricePerMtok).toBe(0)
    expect(e.completionPricePerMtok).toBe(0)
  })

  it('returns null for unknown provider (not in mapping)', () => {
    const raw = {
      id: 'google/gemini-2.0-flash',
      pricing: { prompt: '0.0000003', completion: '0.0000006' }
    }
    expect(transformCatalogEntry(raw)).toBeNull()
  })

  it('returns null when prompt price is missing', () => {
    const raw = {
      id: 'anthropic/claude-test',
      pricing: { completion: '0.00015' }
    }
    expect(transformCatalogEntry(raw)).toBeNull()
  })

  it('returns null when completion price is missing', () => {
    const raw = {
      id: 'anthropic/claude-test',
      pricing: { prompt: '0.00003' }
    }
    expect(transformCatalogEntry(raw)).toBeNull()
  })

  it('returns null when pricing object is missing entirely', () => {
    const raw = { id: 'anthropic/claude-test' }
    expect(transformCatalogEntry(raw)).toBeNull()
  })

  it('returns null when id has no slash (malformed)', () => {
    const raw = { id: 'anthropic', pricing: { prompt: '0.00003', completion: '0.00015' } }
    expect(transformCatalogEntry(raw)).toBeNull()
  })

  it('returns null when model part after slash is empty', () => {
    const raw = { id: 'anthropic/', pricing: { prompt: '0.00003', completion: '0.00015' } }
    expect(transformCatalogEntry(raw)).toBeNull()
  })

  it('skips non-numeric price strings (NaN guard)', () => {
    const raw = {
      id: 'anthropic/claude-bad',
      pricing: { prompt: 'N/A', completion: '0.00015' }
    }
    expect(transformCatalogEntry(raw)).toBeNull()
  })

  it('handles empty string cache prices (omits them)', () => {
    const raw = {
      id: 'anthropic/claude-test',
      pricing: { prompt: '0.00003', completion: '0.00015', input_cache_read: '' }
    }
    const e = transformCatalogEntry(raw)!
    expect(e.cacheReadPricePerMtok).toBeUndefined()
  })

  it('handles model names with colons (e.g. openai/gpt-4o-mini:free)', () => {
    const raw = {
      id: 'openai/gpt-4o-mini:free',
      pricing: { prompt: '0', completion: '0' }
    }
    const e = transformCatalogEntry(raw)!
    expect(e.model).toBe('gpt-4o-mini:free')
  })
})

// syncCatalog:拉取目录、转换匹配条目并回调 upsert,含错误与空数据处理
describe('syncCatalog', () => {
  it('fetches the catalog, transforms matching entries, and calls upsert', async () => {
    const fetchCalls: string[] = []
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      fetchCalls.push(String(input))
      return jsonResponse({
        data: [
          {
            id: 'anthropic/claude-opus-4.7',
            pricing: { prompt: '0.00003', completion: '0.00015', input_cache_read: '0.000003' }
          },
          {
            id: 'deepseek/deepseek-chat',
            pricing: { prompt: '0.00000014', completion: '0.00000028' }
          },
          // unknown provider — should be skipped
          {
            id: 'google/gemini-flash',
            pricing: { prompt: '0.0000003', completion: '0.0000006' }
          }
        ]
      })
    }) as typeof fetch

    const upsertCalls: PricingEntry[][] = []
    const result = await syncCatalog((entries) => upsertCalls.push(entries))

    // fetched the right URL
    expect(fetchCalls[0]).toBe(CATALOG_URL)
    // 2 matched (anthropic + deepseek), 1 skipped (google)
    expect(result.synced).toBe(2)
    expect(result.skipped).toBe(1)
    // upsert called once with 2 entries
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]).toHaveLength(2)
    // unit conversion applied
    expect(upsertCalls[0]?.[0]?.promptPricePerMtok).toBe(30)
    expect(upsertCalls[0]?.[1]?.promptPricePerMtok).toBeCloseTo(0.14, 5)
  })

  it('does not call upsert when no entries match', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        data: [{ id: 'unknown/model', pricing: { prompt: '0', completion: '0' } }]
      })
    ) as typeof fetch

    let upsertCalled = false
    const result = await syncCatalog(() => {
      upsertCalled = true
    })

    expect(upsertCalled).toBe(false)
    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('throws ProviderError on HTTP failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 503 })) as typeof fetch

    await expect(syncCatalog(() => {})).rejects.toThrow(/models.dev catalog fetch failed/)
  })

  it('throws ProviderError on network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch

    await expect(syncCatalog(() => {})).rejects.toThrow(/Failed to fetch models.dev catalog/)
  })

  it('handles empty data array', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ data: [] })) as typeof fetch
    const result = await syncCatalog(() => {})
    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it('handles null/missing data array (defensive)', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({})) as typeof fetch
    const result = await syncCatalog(() => {})
    expect(result.synced).toBe(0)
  })
})
