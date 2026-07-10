/**
 * registry 与 catalog 集成测试:锁定来源注册表与 UI 目录之间的契约,
 * 校验 listProviders / getCatalogEntry 合并清单的完整性与字段一致性。
 * (glm-5.2)
 */
import { describe, expect, it } from 'vitest'
import { listProviders, getProvider } from '../../src/main/providers/registry'
import { PROVIDER_CATALOG, getCatalogEntry } from '../../src/shared/provider-catalog'

/**
 * Integration test: locks the contract between the provider registry and the
 * UI catalog. The CreateKeyModal (renderer) and the IPC `providersList`
 * handler (main) both depend on the merged manifest being well-formed.
 */
// registry + catalog 集成:校验注册表与目录条目双向匹配及合并字段
describe('registry + catalog integration', () => {
  it('every registry provider has a matching catalog entry', () => {
    const ids = listProviders().map((p) => p.id)
    for (const id of ids) {
      expect(getCatalogEntry(id), `registry ${id} missing catalog`).toBeDefined()
    }
  })

  it('every catalog entry has a corresponding built-in provider', () => {
    const registryIds = new Set(listProviders().map((p) => p.id))
    for (const c of PROVIDER_CATALOG) {
      expect(registryIds.has(c.id), `catalog ${c.id} missing from registry`).toBe(true)
    }
  })

  it('listProviders() merges catalog metadata into the manifest', () => {
    const deepseek = listProviders().find((p) => p.id === 'deepseek')
    expect(deepseek).toBeDefined()
    expect(deepseek?.defaultBaseUrl).toBe('https://api.deepseek.com')
    expect(deepseek?.protocol).toBe('openai-compatible')
    expect(deepseek?.defaultModels).toContain('deepseek-v4-pro')
    expect(deepseek?.signupUrl).toBe('https://platform.deepseek.com/api-docs/')
    expect(typeof deepseek?.note).toBe('string')
  })

  it('admin providers are tagged with the right protocol for UI', () => {
    const aa = listProviders().find((p) => p.id === 'anthropic-admin')
    const oa = listProviders().find((p) => p.id === 'openai-admin')
    expect(aa?.protocol).toBe('anthropic-admin')
    expect(oa?.protocol).toBe('openai-admin')
  })

  it('manual providers have empty defaultBaseUrl in the catalog', () => {
    const qwen = listProviders().find((p) => p.id === 'qwen-manual')
    const gemini = listProviders().find((p) => p.id === 'gemini-manual')
    // Manual providers may keep a non-empty default for the override field hint
    // but the modal should not advertise a "use default" button for them.
    expect(qwen?.protocol).toBe('manual')
    expect(gemini?.protocol).toBe('manual')
  })

  it('getProvider() returns the original (un-merged) provider impl', () => {
    // The impl's manifest must stay untouched so the runtime HTTP client keeps
    // its default base URL when callers don't pass baseUrlOverride.
    const impl = getProvider('deepseek')
    expect(impl).toBeDefined()
    expect(impl?.manifest.protocol).toBeUndefined() // raw manifest has no UI metadata
    expect(impl?.hasBalanceApi).toBe(true)
  })
})
