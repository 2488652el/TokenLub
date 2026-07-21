/**
 * Single source of truth for UI-side provider metadata.
 *
 * The provider implementation in `code/src/main/providers/<id>/index.ts` decides
 * the wire format and the actual default base URL. This catalog only adds the
 * fields the renderer needs to render a friendly "create new key" form: hint
 * text, signup URL, suggested model list, and a human-readable protocol label.
 *
 * Keep entries in sync with the vendor docs reviewed in PR-# - adding a new
 * provider requires both an entry here AND a `BUILTIN` slot in
 * `code/src/main/providers/registry.ts`.
 *
 * 中文说明:本文件是渲染层"供应商目录"的唯一数据源,定义各供应商在
 * 创建密钥模态框中展示的元信息(Base URL 模板、推荐模型、注册链接、提示文案等)。
 * (glm-5.2)
 */
import type { ProviderCategory, ProviderProtocol } from './types/provider'

/** 协议徽章文案:在 UI 上以短标签形式展示供应商的协议类型。 */
export type ProtocolBadgeLabel = 'OpenAI 兼容' | 'Anthropic 兼容' | '原生' | '组织管理' | '手动'

/**
 * One pre-defined base URL option surfaced in the create-key modal's
 * "高级 (Base URL 覆盖)" panel. Mirrors the vendor docs verbatim — adding a
 * new vendor (or a new protocol) means appending an entry to the right
 * provider's `baseUrlTemplates` list.
 */
export interface BaseUrlTemplate {
  /** Stable id, used as React `key` and as a stable identifier for telemetry. */
  id: string
  /** Short human label, e.g. "OpenAI 兼容" or "Coding Plan (Anthropic)". */
  label: string
  /** The full base URL the modal writes into the override field when picked. */
  url: string
  /** Protocol this URL targets. Used for the small chip next to the label. */
  protocol: ProviderProtocol
  /** Optional one-liner shown under the URL when expanded. */
  hint?: string
}

/** 供应商目录条目:单个供应商在创建密钥 UI 中所需的全部元信息。 */
export interface ProviderCatalogEntry {
  id: string
  displayName: string
  category: ProviderCategory
  protocol: ProviderProtocol
  /** The URL the renderer pre-fills into the override field. Empty when the provider needs a user-supplied URL. */
  defaultBaseUrl: string
  /**
   * Pre-defined base URL options the user can pick from inside the "高级"
   * panel of the create-key modal. Each entry mirrors a vendor-documented
   * protocol/path combination — e.g. DeepSeek exposes both an OpenAI-format
   * base URL and an Anthropic-format base URL under the same account.
   *
   * Always non-empty; providers with a single option still get a one-row list
   * so the modal renders the same picker everywhere.
   */
  baseUrlTemplates: readonly BaseUrlTemplate[]
  /** Models we believe are most useful for the user — surfaced as read-only chips in the modal. */
  defaultModels: readonly string[]
  /** Where the user creates / revokes API keys. */
  signupUrl?: string
  /** One-line UI hint shown under the alias field. Keep it short and actionable. */
  note: string
  /** Short region/currency label so the user can sanity-check the key vs the dashboard. */
  region: string
  /** Optional accent color so the provider card has visual identity. */
  accentColor?: string
}

/** 协议 -> 中文徽章文案的映射表。 */
export const PROTOCOL_LABEL: Record<ProviderProtocol, ProtocolBadgeLabel> = {
  'openai-compatible': 'OpenAI 兼容',
  'anthropic-compatible': 'Anthropic 兼容',
  'anthropic-admin': '组织管理',
  'openai-admin': '组织管理',
  native: '原生',
  manual: '手动'
}

/** 全部内置供应商目录(只读数组),按 UI 展示顺序排列。 */
export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    category: 'third-party',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com',
    baseUrlTemplates: [
      {
        id: 'openai',
        label: 'OpenAI 兼容',
        url: 'https://api.deepseek.com',
        protocol: 'openai-compatible',
        hint: '推荐。`/chat/completions` 走标准 OpenAI Chat Completions 协议。'
      },
      {
        id: 'anthropic',
        label: 'Anthropic 兼容',
        url: 'https://api.deepseek.com/anthropic',
        protocol: 'anthropic-compatible',
        hint: 'Claude Code / Anthropic SDK 场景,`/v1/messages` 直连。'
      }
    ],
    defaultModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-reasoner'],
    signupUrl: 'https://platform.deepseek.com/api-docs/',
    note: 'Bearer Token。`deepseek-chat` 已于 2026/07/24 弃用,新建 Key 默认走 v4。',
    region: 'CN · CNY'
  },
  {
    id: 'zhipu',
    displayName: 'Zhipu GLM (智谱)',
    category: 'token-plan',
    protocol: 'native',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    baseUrlTemplates: [
      {
        id: 'paas',
        label: 'PaaS (OpenAI 兼容)',
        url: 'https://open.bigmodel.cn/api/paas/v4',
        protocol: 'openai-compatible',
        hint: '通用 GLM-5.2 等模型的 PaaS 接口,`/chat/completions` 可用。'
      },
      {
        id: 'coding-anthropic',
        label: 'Coding Plan (Anthropic 兼容)',
        url: 'https://open.bigmodel.cn/api/anthropic',
        protocol: 'anthropic-compatible',
        hint: 'GLM Coding Plan 套餐专用,适配 Claude Code。'
      },
      {
        id: 'coding-openai',
        label: 'Coding Plan (OpenAI 兼容)',
        url: 'https://open.bigmodel.cn/api/coding/paas/v4',
        protocol: 'openai-compatible',
        hint: 'GLM Coding Plan 套餐的 OpenAI 协议入口。'
      }
    ],
    defaultModels: [
      'glm-5.2',
      'glm-5.1',
      'glm-5-turbo',
      'glm-4.7-flash',
      'glm-5v-turbo',
      'glm-image'
    ],
    signupUrl: 'https://bigmodel.cn/',
    note: 'Coding Plan 用户请把 baseURL 改成 `…/api/coding/paas/v4`,团队 Key 与平台 Key 不通用。/api/biz 余额接口偶发 500,MoonMeter 会回退到 chat 探活。',
    region: 'CN · CNY'
  },
  {
    id: 'moonshot',
    displayName: 'Kimi API (Moonshot)',
    category: 'token-plan',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    baseUrlTemplates: [
      {
        id: 'cn',
        label: '国内 (CN · CNY)',
        url: 'https://api.moonshot.cn/v1',
        protocol: 'openai-compatible',
        hint: '`/chat/completions` 标准 OpenAI 协议,国内账户用这个。'
      },
      {
        id: 'global',
        label: '海外 (Global · USD)',
        url: 'https://api.moonshot.ai/v1',
        protocol: 'openai-compatible',
        hint: '`api.moonshot.ai` 海外节点,按 USD 计费。'
      }
    ],
    defaultModels: ['kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6'],
    signupUrl: 'https://platform.kimi.com/console/api-keys',
    note: '国内 api.moonshot.cn 按 CNY,海外 api.moonshot.ai 按 USD。',
    region: 'CN · CNY'
  },
  {
    id: 'kimi-coding',
    displayName: 'Kimi Coding Plan',
    category: 'token-plan',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.kimi.com/coding/v1',
    baseUrlTemplates: [
      {
        id: 'openai',
        label: 'OpenAI 兼容',
        url: 'https://api.kimi.com/coding/v1',
        protocol: 'openai-compatible',
        hint: 'Kimi Code 官方 Coding Plan 接口，使用 `/chat/completions`。'
      },
      {
        id: 'anthropic',
        label: 'Anthropic 兼容',
        url: 'https://api.kimi.com/coding/',
        protocol: 'anthropic-compatible',
        hint: 'Claude Code 等工具使用 `/v1/messages`。余额查询仍走 OpenAI 兼容地址。'
      }
    ],
    defaultModels: ['kimi-for-coding', 'kimi-for-coding-highspeed', 'k3'],
    signupUrl: 'https://www.kimi.com/code/console',
    note: 'Kimi 会员 Coding Plan 专用，套餐用量来自 `/coding/v1/usages`，不要与 Kimi API Key 混用。',
    region: 'Global · 会员套餐'
  },
  {
    id: 'longcat',
    displayName: 'LongCat (美团)',
    category: 'token-plan',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.longcat.chat',
    baseUrlTemplates: [
      {
        id: 'openai',
        label: 'OpenAI 兼容',
        url: 'https://api.longcat.chat',
        protocol: 'openai-compatible',
        hint: 'OpenAI 兼容根地址。MoonMeter 用 `/openai/v1/models` 测试连接。'
      },
      {
        id: 'anthropic',
        label: 'Anthropic 兼容',
        url: 'https://api.longcat.chat/anthropic',
        protocol: 'anthropic-compatible',
        hint: 'Claude Code / Anthropic SDK 场景,`/v1/messages` 直连。'
      }
    ],
    defaultModels: ['LongCat-2.0'],
    signupUrl: 'https://longcat.chat/platform/api_keys',
    note: 'OpenAI 兼容,Base URL 使用 `https://api.longcat.chat`。Token 资源包余额可用平台 Cookie 模式读取。',
    region: 'CN · CNY'
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    category: 'token-plan',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    baseUrlTemplates: [
      {
        id: 'openai',
        label: 'OpenAI 兼容',
        url: 'https://api.minimaxi.com/v1',
        protocol: 'openai-compatible',
        hint: '推荐。`/v1/chat/completions` 标准 OpenAI 协议,M3 / M2.7 等模型。'
      },
      {
        id: 'anthropic',
        label: 'Anthropic 兼容',
        url: 'https://api.minimaxi.com/anthropic',
        protocol: 'anthropic-compatible',
        hint: 'Claude Code / Anthropic SDK 场景,`/v1/messages` 直连。'
      }
    ],
    defaultModels: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5'],
    signupUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    note: 'OpenAI 兼容。MoonMeter 会自动读取 Token Plan 的 5 小时/周限额;`/v1/models` 仅用于探活,key 0 消耗;按 CNY 计费,M3 永久五折。',
    region: 'CN · CNY'
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow (硅基流动)',
    category: 'third-party',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.siliconflow.cn',
    baseUrlTemplates: [
      {
        id: 'default',
        label: '默认 (OpenAI 兼容)',
        url: 'https://api.siliconflow.cn',
        protocol: 'openai-compatible',
        hint: '所有开源模型的统一入口,`/v1/chat/completions` 标准协议。'
      }
    ],
    defaultModels: [
      'Qwen/Qwen2.5-72B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'Pro/THUDM/glm-4-9b-chat'
    ],
    signupUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '聚合多家开源模型,余额单位为元。',
    region: 'CN · CNY'
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    category: 'third-party',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    baseUrlTemplates: [
      {
        id: 'default',
        label: 'OpenAI 兼容',
        url: 'https://openrouter.ai/api/v1',
        protocol: 'openai-compatible',
        hint: '统一按 USD 计费,免费模型可设置 limit=null。'
      }
    ],
    defaultModels: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-pro-1.5'],
    signupUrl: 'https://openrouter.ai/keys',
    note: '统一按 USD 计费,免费模型可设置 limit=null。',
    region: 'Global · USD'
  },
  {
    id: 'stepfun',
    displayName: 'StepFun 阶跃星辰',
    category: 'third-party',
    protocol: 'openai-compatible',
    defaultBaseUrl: 'https://api.stepfun.com',
    baseUrlTemplates: [
      {
        id: 'default',
        label: '默认 (OpenAI 兼容)',
        url: 'https://api.stepfun.com',
        protocol: 'openai-compatible',
        hint: '`/v1/chat/completions` 标准协议。'
      }
    ],
    defaultModels: ['step-1-200k', 'step-1v-8k', 'step-1x-medium'],
    signupUrl: 'https://platform.stepfun.com/account',
    note: '余额字段为字符串,本应用已做兼容解析。',
    region: 'CN · CNY'
  },
  {
    id: 'anthropic-admin',
    displayName: 'Anthropic Admin',
    category: 'admin-org',
    protocol: 'anthropic-admin',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlTemplates: [
      {
        id: 'default',
        label: 'Anthropic Admin',
        url: 'https://api.anthropic.com',
        protocol: 'anthropic-admin',
        hint: '`/v1/organizations/cost_report` 与 `/v1/organizations/usage` 入口。'
      }
    ],
    defaultModels: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    signupUrl: 'https://console.anthropic.com/settings/keys',
    note: '需要单独的管理员 Key (`Admin Key`),用于 `/v1/organizations/*`。',
    region: 'Global · USD'
  },
  {
    id: 'openai-admin',
    displayName: 'OpenAI Admin',
    category: 'admin-org',
    protocol: 'openai-admin',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlTemplates: [
      {
        id: 'default',
        label: 'OpenAI Admin',
        url: 'https://api.openai.com/v1',
        protocol: 'openai-admin',
        hint: '`/organization/costs` 与 `/organization/usage/completions` 入口。'
      }
    ],
    defaultModels: ['gpt-5', 'gpt-4o', 'o3'],
    signupUrl: 'https://platform.openai.com/api-keys',
    note: '需要组织 Owner 权限的 Admin Key,普通 API Key 不能访问 usage/cost。',
    region: 'Global · USD'
  },
  {
    id: 'newapi-generic',
    displayName: 'NewAPI / OneAPI',
    category: 'newapi-generic',
    protocol: 'native',
    defaultBaseUrl: '',
    baseUrlTemplates: [
      {
        id: 'self-hosted',
        label: '自建服务 (OneAPI/NewAPI 兼容)',
        url: '',
        protocol: 'native',
        hint: '必须填写自建服务的根 URL,例如 `https://your-newapi.example.com`。'
      }
    ],
    defaultModels: [],
    signupUrl: 'https://github.com/songquanpeng/one-api',
    note: '必须填写自建服务的 baseURL,留空会保存失败。1 quota = 0.002 USD。',
    region: '自建 · USD'
  },
  {
    id: 'qwen-manual',
    displayName: '通义千问 Qwen (manual)',
    category: 'manual',
    protocol: 'manual',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    baseUrlTemplates: [
      {
        id: 'default',
        label: 'DashScope (OpenAI 兼容)',
        url: 'https://dashscope.aliyuncs.com',
        protocol: 'openai-compatible',
        hint: '通义千问官方 OpenAI 兼容入口,余额需手动录入。'
      }
    ],
    defaultModels: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    signupUrl: 'https://help.aliyun.com/zh/model-studio',
    note: '无公开余额 API,保存后请在"余额查询"页手动录入。',
    region: 'CN · CNY'
  },
  {
    id: 'gemini-manual',
    displayName: 'Google Gemini (manual)',
    category: 'manual',
    protocol: 'manual',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    baseUrlTemplates: [
      {
        id: 'default',
        label: 'Gemini API (OpenAI 兼容)',
        url: 'https://generativelanguage.googleapis.com',
        protocol: 'openai-compatible',
        hint: 'Google AI Studio 提供的 OpenAI 兼容入口,免费层无余额 API。'
      }
    ],
    defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    signupUrl: 'https://aistudio.google.com/apikey',
    note: '免费层无余额 API,建议在"余额查询"页手动录入额度。',
    region: 'Global · Free'
  },
  {
    id: 'manual',
    displayName: 'Manual (手动录入)',
    category: 'manual',
    protocol: 'manual',
    defaultBaseUrl: '',
    baseUrlTemplates: [
      {
        id: 'empty',
        label: '自填 URL',
        url: '',
        protocol: 'manual',
        hint: '留空或填写任意厂商的根 URL。'
      }
    ],
    defaultModels: [],
    note: '占位条目,适用于厂商没有提供 API 的场景。',
    region: '—'
  }
]

/** 按 id 构建 O(1) 查询索引。 */
const CATALOG_BY_ID = new Map(PROVIDER_CATALOG.map((p) => [p.id, p]))

/** 按 id 查询目录条目,未找到返回 undefined。 */
export function getCatalogEntry(id: string): ProviderCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id)
}

/** 按 id 查询目录条目,未找到抛错(用于必须存在的场景)。 */
export function requireCatalogEntry(id: string): ProviderCatalogEntry {
  const entry = CATALOG_BY_ID.get(id)
  if (!entry) throw new Error(`unknown provider: ${id}`)
  return entry
}
