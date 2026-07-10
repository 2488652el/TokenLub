/** 供应商目录单元测试:覆盖 PROVIDER_CATALOG / PROTOCOL_LABEL / getCatalogEntry 等。 (glm-5.2) */
import { describe, expect, it } from 'vitest'
import {
  PROVIDER_CATALOG,
  PROTOCOL_LABEL,
  getCatalogEntry,
  requireCatalogEntry
} from '../../src/shared/provider-catalog'

// 供应商目录测试套件:校验 PROVIDER_CATALOG 的完整性、协议标签、模型集与 URL 模板
describe('PROVIDER_CATALOG', () => {
  it('covers every built-in provider id referenced in the codebase', () => {
    // Hardcoded against the registry's BUILTIN list — add to both when adding a
    // new provider. This guards against "registry has X but catalog has no
    // entry for X" mismatches that would render the create-key modal broken.
    const expected = [
      'deepseek',
      'zhipu',
      'moonshot',
      'longcat',
      'minimax',
      'siliconflow',
      'openrouter',
      'stepfun',
      'anthropic-admin',
      'openai-admin',
      'newapi-generic',
      'qwen-manual',
      'gemini-manual',
      'manual'
    ]
    const actual = new Set(PROVIDER_CATALOG.map((c) => c.id))
    for (const id of expected) {
      expect(actual.has(id), `missing catalog entry: ${id}`).toBe(true)
    }
  })

  it('has globally unique provider ids', () => {
    const ids = PROVIDER_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes a non-empty defaultBaseUrl for non-custom providers', () => {
    // newapi-generic is the one legitimate empty-default — self-hosted
    // services must provide their own URL.
    const missing = PROVIDER_CATALOG.filter(
      (c) => c.id !== 'newapi-generic' && c.id !== 'manual' && c.defaultBaseUrl === ''
    )
    expect(missing).toEqual([])
  })

  it('flags newapi-generic as requiring a user-supplied base URL', () => {
    const entry = requireCatalogEntry('newapi-generic')
    expect(entry.defaultBaseUrl).toBe('')
    // note must call this out so the renderer can require the override field
    expect(entry.note).toMatch(/自建|must|手动/i)
  })

  it('lists a default model set for providers with documented flagship models', () => {
    const deepseek = requireCatalogEntry('deepseek')
    const moonshot = requireCatalogEntry('moonshot')
    const zhipu = requireCatalogEntry('zhipu')
    expect(deepseek.defaultModels.length).toBeGreaterThan(0)
    expect(moonshot.defaultModels.length).toBeGreaterThan(0)
    expect(zhipu.defaultModels.length).toBeGreaterThan(0)
  })

  it('marks admin-org providers with the correct protocol', () => {
    expect(requireCatalogEntry('anthropic-admin').protocol).toBe('anthropic-admin')
    expect(requireCatalogEntry('openai-admin').protocol).toBe('openai-admin')
  })

  it('PROTOCOL_LABEL has an entry for every protocol used in the catalog', () => {
    const used = new Set(PROVIDER_CATALOG.map((c) => c.protocol))
    for (const p of used) {
      expect(PROTOCOL_LABEL[p], `PROTOCOL_LABEL missing: ${p}`).toBeTruthy()
    }
  })

  it('getCatalogEntry returns undefined for unknown ids and the entry for known ones', () => {
    expect(getCatalogEntry('not-a-real-provider')).toBeUndefined()
    expect(getCatalogEntry('deepseek')?.displayName).toBe('DeepSeek')
  })

  it('requireCatalogEntry throws for unknown ids', () => {
    expect(() => requireCatalogEntry('nope')).toThrow(/unknown provider/)
  })

  it('every entry has a non-empty note (the modal renders it)', () => {
    for (const c of PROVIDER_CATALOG) {
      expect(c.note.length, `${c.id} note is empty`).toBeGreaterThan(0)
    }
  })

  it('region string is non-empty for every entry', () => {
    for (const c of PROVIDER_CATALOG) {
      expect(c.region.length, `${c.id} region is empty`).toBeGreaterThan(0)
    }
  })

  // ----- baseUrlTemplates (vendor-documented protocol options) -----

  it('every provider has at least one baseUrlTemplate', () => {
    for (const c of PROVIDER_CATALOG) {
      expect(c.baseUrlTemplates.length, `${c.id} has no baseUrlTemplates`).toBeGreaterThan(0)
    }
  })

  it('every baseUrlTemplate has a non-empty label and a valid url or empty (self-hosted)', () => {
    for (const c of PROVIDER_CATALOG) {
      for (const t of c.baseUrlTemplates) {
        expect(t.label.length, `${c.id}/${t.id} label is empty`).toBeGreaterThan(0)
        expect(t.id.length, `${c.id}/${t.id} id is empty`).toBeGreaterThan(0)
        if (t.url !== '') {
          // Either http(s) or a well-formed URL — just verify it parses.
          expect(
            () => new URL(t.url),
            `${c.id}/${t.id} url is not a valid URL: ${t.url}`
          ).not.toThrow()
        }
      }
    }
  })

  it('template ids are unique within each provider', () => {
    for (const c of PROVIDER_CATALOG) {
      const ids = c.baseUrlTemplates.map((t) => t.id)
      expect(new Set(ids).size, `${c.id} has duplicate template ids`).toBe(ids.length)
    }
  })

  it('DeepSeek exposes both OpenAI and Anthropic base URLs (per official docs)', () => {
    const deepseek = requireCatalogEntry('deepseek')
    const protocols = deepseek.baseUrlTemplates.map((t) => t.protocol)
    expect(protocols).toContain('openai-compatible')
    expect(protocols).toContain('anthropic-compatible')
    const openai = deepseek.baseUrlTemplates.find((t) => t.protocol === 'openai-compatible')
    const anthropic = deepseek.baseUrlTemplates.find((t) => t.protocol === 'anthropic-compatible')
    expect(openai?.url).toBe('https://api.deepseek.com')
    expect(anthropic?.url).toBe('https://api.deepseek.com/anthropic')
  })

  it('LongCat exposes both OpenAI and Anthropic base URLs', () => {
    const longcat = requireCatalogEntry('longcat')
    const protocols = longcat.baseUrlTemplates.map((t) => t.protocol)
    expect(protocols).toContain('openai-compatible')
    expect(protocols).toContain('anthropic-compatible')
    const openai = longcat.baseUrlTemplates.find((t) => t.protocol === 'openai-compatible')
    const anthropic = longcat.baseUrlTemplates.find((t) => t.protocol === 'anthropic-compatible')
    expect(openai?.url).toBe('https://api.longcat.chat')
    expect(anthropic?.url).toBe('https://api.longcat.chat/anthropic')
  })

  it('Zhipu (GLM) exposes PaaS + Coding Plan variants', () => {
    const zhipu = requireCatalogEntry('zhipu')
    const urls = zhipu.baseUrlTemplates.map((t) => t.url)
    expect(urls).toContain('https://open.bigmodel.cn/api/paas/v4')
    expect(urls).toContain('https://open.bigmodel.cn/api/anthropic')
    expect(urls).toContain('https://open.bigmodel.cn/api/coding/paas/v4')
  })

  it('Moonshot / Kimi exposes both domestic and overseas endpoints', () => {
    const moonshot = requireCatalogEntry('moonshot')
    const urls = moonshot.baseUrlTemplates.map((t) => t.url)
    expect(urls).toContain('https://api.moonshot.cn/v1')
    expect(urls).toContain('https://api.moonshot.ai/v1')
  })

  it('defaultBaseUrl always matches one of the listed templates', () => {
    // The "use default" button should never point at a URL the user can't
    // otherwise pick from the protocol templates.
    for (const c of PROVIDER_CATALOG) {
      if (!c.defaultBaseUrl) continue
      const urls = c.baseUrlTemplates.map((t) => t.url).filter((u) => u !== '')
      expect(
        urls.includes(c.defaultBaseUrl),
        `${c.id} defaultBaseUrl ${c.defaultBaseUrl} is not in its own baseUrlTemplates list`
      ).toBe(true)
    }
  })

  // ----- defaultModels (must be real models per vendor docs) -----

  it('Zhipu defaultModels includes the current flagship (GLM-5.2) per docs.bigmodel.cn', async () => {
    // Regression guard: vendor docs list glm-5.2 as the current flagship
    // (1M context, 128K output, released 2026). The catalog must reflect
    // this so the modal's "常用模型" chips are not stale.
    const zhipu = requireCatalogEntry('zhipu')
    expect(zhipu.defaultModels).toContain('glm-5.2')
  })

  it('Zhipu defaultModels does NOT list deprecated model names (CogVideoX-3)', () => {
    // The previous catalog had `CogVideoX-3` which is not in the official
    // model-overview page. Lock that out so a future edit doesn't regress.
    const zhipu = requireCatalogEntry('zhipu')
    expect(zhipu.defaultModels).not.toContain('CogVideoX-3')
  })

  // ----- MiniMax (Coding Plan) -----

  it('minimax entry exists and exposes both OpenAI + Anthropic base URLs', () => {
    // Regression: the registry had minimaxProvider wired before the catalog
    // entry was added, so the create-key modal silently dropped the option.
    // The catalog must list it so the modal renders the picker.
    const minimax = requireCatalogEntry('minimax')
    const protocols = minimax.baseUrlTemplates.map((t) => t.protocol)
    expect(protocols).toContain('openai-compatible')
    expect(protocols).toContain('anthropic-compatible')
    const openai = minimax.baseUrlTemplates.find((t) => t.protocol === 'openai-compatible')
    const anthropic = minimax.baseUrlTemplates.find((t) => t.protocol === 'anthropic-compatible')
    expect(openai?.url).toBe('https://api.minimaxi.com/v1')
    expect(anthropic?.url).toBe('https://api.minimaxi.com/anthropic')
  })

  it('minimax defaultModels includes the current flagship (MiniMax-M3)', async () => {
    // Per https://platform.minimaxi.com/docs/guides/text-generation
    const minimax = requireCatalogEntry('minimax')
    expect(minimax.defaultModels).toContain('MiniMax-M3')
  })

  it('catalog contains the minimax id (regression for the missing-picker bug)', () => {
    // Lock the bug: registry has it, catalog had no entry → modal couldn't
    // show it. If someone deletes the catalog entry, this test fails first.
    const ids = new Set(PROVIDER_CATALOG.map((c) => c.id))
    expect(ids.has('minimax')).toBe(true)
  })
})
