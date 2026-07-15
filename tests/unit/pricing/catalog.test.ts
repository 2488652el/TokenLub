/** models.dev 正式 API 的价格转换、ETag 与批量同步测试。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOG_MANAGED_SCOPES,
  CATALOG_URL,
  PROVIDER_MAPPING,
  syncCatalog,
  transformCatalogModel
} from '../../../src/main/pricing/catalog'
import type { PricingEntry } from '../../../src/shared/types/pricing'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('PROVIDER_MAPPING', () => {
  it('covers TokenLub providers backed by models.dev provider pricing', () => {
    expect(PROVIDER_MAPPING).toMatchObject({
      anthropic: 'anthropic-admin',
      openai: 'openai-admin',
      deepseek: 'deepseek',
      moonshotai: 'moonshot',
      alibaba: 'qwen-manual',
      stepfun: 'stepfun',
      zhipuai: 'zhipu',
      minimax: 'minimax',
      longcat: 'longcat',
      siliconflow: 'siliconflow',
      openrouter: 'openrouter',
      google: 'gemini-manual'
    })
  })

  it('declares every mapped provider scope for full-catalog lifecycle reconciliation', () => {
    expect(CATALOG_MANAGED_SCOPES).toHaveLength(Object.keys(PROVIDER_MAPPING).length)
    expect(CATALOG_MANAGED_SCOPES).toContainEqual({
      providerId: 'moonshot',
      billingScope: 'global'
    })
    expect(CATALOG_MANAGED_SCOPES).toContainEqual({
      providerId: 'deepseek',
      billingScope: 'default'
    })
    expect(CATALOG_MANAGED_SCOPES).not.toContainEqual({
      providerId: 'minimax',
      billingScope: 'cn'
    })
  })
})

describe('transformCatalogModel', () => {
  it('keeps official per-million USD prices without multiplying again', () => {
    const entry = transformCatalogModel('anthropic', 'claude-opus-4-6', {
      cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 }
    })
    expect(entry).toMatchObject({
      providerId: 'anthropic-admin',
      model: 'claude-opus-4-6',
      promptPricePerMtok: 5,
      completionPricePerMtok: 25,
      cacheReadPricePerMtok: 0.5,
      cacheCreationPricePerMtok: 6.25,
      currency: 'USD',
      source: 'catalog',
      billingScope: 'default',
      catalogActive: true
    })
  })

  it('maps global models.dev prices to the matching provider billing scope', () => {
    expect(
      transformCatalogModel('moonshotai', 'kimi-k2', { cost: { input: 0.5, output: 2 } })
    ).toMatchObject({ providerId: 'moonshot', billingScope: 'global' })
    expect(
      transformCatalogModel('minimax', 'MiniMax-M2.1', { cost: { input: 0.3, output: 1.2 } })
    ).toMatchObject({ providerId: 'minimax', billingScope: 'global' })
  })

  it('accepts free models and optional cache prices', () => {
    expect(
      transformCatalogModel('openrouter', 'vendor/free-model', {
        cost: { input: 0, output: 0 }
      })
    ).toMatchObject({
      providerId: 'openrouter',
      model: 'vendor/free-model',
      promptPricePerMtok: 0,
      completionPricePerMtok: 0
    })
  })

  it('rejects unknown providers, empty ids, missing prices and invalid numbers', () => {
    expect(transformCatalogModel('unknown', 'model', { cost: { input: 1, output: 2 } })).toBeNull()
    expect(transformCatalogModel('openai', '', { cost: { input: 1, output: 2 } })).toBeNull()
    expect(transformCatalogModel('openai', 'model', { cost: { output: 2 } })).toBeNull()
    expect(
      transformCatalogModel('openai', 'model', { cost: { input: Number.NaN, output: 2 } })
    ).toBeNull()
    expect(transformCatalogModel('openai', 'model', { cost: { input: -1, output: 2 } })).toBeNull()
  })
})

describe('syncCatalog', () => {
  it('reads provider model maps and reports applied/protected/skipped counts', async () => {
    const fetchCalls: Array<{ url: string; etag: string | null }> = []
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        etag: new Headers(init?.headers).get('if-none-match')
      })
      return jsonResponse(
        {
          anthropic: {
            models: {
              'claude-opus-4-6': { cost: { input: 5, output: 25, cache_read: 0.5 } },
              broken: { cost: { input: 1 } }
            }
          },
          deepseek: {
            models: { 'deepseek-chat': { cost: { input: 0.14, output: 0.28 } } }
          },
          unsupported: {
            models: { model: { cost: { input: 1, output: 2 } } }
          }
        },
        { etag: '"catalog-v2"' }
      )
    }) as typeof fetch

    const upsertCalls: PricingEntry[][] = []
    const result = await syncCatalog(
      (entries) => {
        upsertCalls.push(entries)
        return { updated: 1, skipped: 1 }
      },
      { etag: '"catalog-v1"' }
    )

    expect(fetchCalls).toEqual([{ url: CATALOG_URL, etag: '"catalog-v1"' }])
    expect(upsertCalls[0]).toHaveLength(2)
    expect(result).toMatchObject({
      synced: 1,
      skipped: 2,
      protected: 1,
      notModified: false,
      etag: '"catalog-v2"'
    })
  })

  it('handles 304 without parsing or writing', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 304 })) as typeof fetch
    const upsert = vi.fn()
    const result = await syncCatalog(upsert, { etag: '"same"' })
    expect(result).toMatchObject({ synced: 0, skipped: 0, protected: 0, notModified: true })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('does not write when no valid entries exist', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ unknown: { models: {} } })) as typeof fetch
    const upsert = vi.fn()
    const result = await syncCatalog(upsert)
    expect(result.synced).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('throws ProviderError on HTTP, network and malformed responses', async () => {
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 503 })) as typeof fetch
    await expect(syncCatalog(() => undefined)).rejects.toThrow(/catalog fetch failed/)

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    await expect(syncCatalog(() => undefined)).rejects.toThrow(/Failed to fetch models.dev/)

    globalThis.fetch = vi.fn(async () => jsonResponse([])) as typeof fetch
    await expect(syncCatalog(() => undefined)).rejects.toThrow(/Invalid models.dev catalog/)
  })
})
