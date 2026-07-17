/**
 * Provider 注册表模块:集中登记全部内置 Provider 实现,
 * 提供按 id 查询与列表(合并 UI 侧 catalog 元数据)的能力。
 * (glm-5.2)
 */
import type { ProviderImpl, ProviderManifest } from '@shared/types/provider'
import { deepseekProvider } from './deepseek'
import { zhipuProvider } from './zhipu'
import { manualProvider } from './manual'
import { anthropicAdminProvider } from './anthropic-admin'
import { openaiAdminProvider } from './openai-admin'
import { moonshotProvider } from './moonshot'
import { siliconflowProvider } from './siliconflow'
import { openrouterProvider } from './openrouter'
import { stepfunProvider } from './stepfun'
import { longcatProvider } from './longcat'
import { newapiGenericProvider } from './newapi-generic'
import { qwenManualProvider } from './qwen-manual'
import { geminiManualProvider } from './gemini-manual'
import { minimaxProvider } from './minimax'
import { kimiCodingProvider } from './kimi-coding'
import { getCatalogEntry } from '@shared/provider-catalog'

const BUILTIN: ProviderImpl[] = [
  deepseekProvider,
  zhipuProvider,
  manualProvider,
  anthropicAdminProvider,
  openaiAdminProvider,
  moonshotProvider,
  siliconflowProvider,
  openrouterProvider,
  stepfunProvider,
  longcatProvider,
  newapiGenericProvider,
  qwenManualProvider,
  geminiManualProvider,
  minimaxProvider,
  kimiCodingProvider
]

const REGISTRY = new Map<string, ProviderImpl>(BUILTIN.map((p) => [p.manifest.id, p]))

/**
 * Merge the UI-side catalog metadata (`defaultBaseUrl`, `protocol`,
 * `defaultModels`, `signupUrl`, `note`) into the runtime manifest so a
 * single `providersList` call carries everything the renderer needs for
 * list views and the create-key modal alike.
 *
 * Catalog entries are the source of truth for UI-facing hints - provider
 * implementations continue to own the wire protocol and HTTP defaults.
 *
 * 将 UI 侧 catalog 元数据合并进运行时 manifest,使单次 providersList 调用即可携带渲染层所需全部信息;
 * catalog 为 UI 提示的唯一来源,Provider 实现仍持有协议与 HTTP 默认值。 (glm-5.2)
 */
function withCatalogMeta(p: ProviderImpl): ProviderManifest {
  const entry = getCatalogEntry(p.manifest.id)
  if (!entry) return p.manifest
  const merged: ProviderManifest = {
    ...p.manifest,
    protocol: entry.protocol,
    defaultModels: entry.defaultModels,
    note: entry.note
  }
  if (entry.defaultBaseUrl) merged.defaultBaseUrl = entry.defaultBaseUrl
  if (entry.signupUrl) merged.signupUrl = entry.signupUrl
  return merged
}

/** 列出全部 Provider(含合并后的 catalog 元数据)。 (glm-5.2) */
export function listProviders(): ProviderManifest[] {
  return Array.from(REGISTRY.values()).map((p) => withCatalogMeta(p))
}

/** 按 id 获取单个 Provider 实现,不存在时返回 undefined。 (glm-5.2) */
export function getProvider(id: string): ProviderImpl | undefined {
  return REGISTRY.get(id)
}
