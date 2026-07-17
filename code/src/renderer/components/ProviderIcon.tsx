/**
 * 供应商图标组件:按 providerId 渲染对应品牌图标,
 * 未匹配时回退为显示首字母的占位方块。
 * (glm-5.2)
 */
import AnthropicIcon from '@lobehub/icons/es/Anthropic/components/Mono'
import ClaudeCodeIcon from '@lobehub/icons/es/ClaudeCode/components/Color'
import CodexIcon from '@lobehub/icons/es/Codex/components/Color'
import DeepSeekIcon from '@lobehub/icons/es/DeepSeek/components/Color'
import GeminiIcon from '@lobehub/icons/es/Gemini/components/Color'
import KimiIcon from '@lobehub/icons/es/Kimi/components/Color'
import LongCatIcon from '@lobehub/icons/es/LongCat/components/Color'
import MinimaxIcon from '@lobehub/icons/es/Minimax/components/Color'
import NewAPIIcon from '@lobehub/icons/es/NewAPI/components/Color'
import OpenAIIcon from '@lobehub/icons/es/OpenAI/components/Mono'
import OpenRouterIcon from '@lobehub/icons/es/OpenRouter/components/Mono'
import QwenIcon from '@lobehub/icons/es/Qwen/components/Color'
import SiliconCloudIcon from '@lobehub/icons/es/SiliconCloud/components/Color'
import StepfunIcon from '@lobehub/icons/es/Stepfun/components/Color'
import type { IconType } from '@lobehub/icons/es/types'
import ZhipuIcon from '@lobehub/icons/es/Zhipu/components/Color'

// providerId 到品牌图标组件的映射表
const PROVIDER_ICON: Record<string, IconType> = {
  'anthropic-admin': AnthropicIcon,
  'claude-code': ClaudeCodeIcon,
  codex: CodexIcon,
  deepseek: DeepSeekIcon,
  'gemini-manual': GeminiIcon,
  longcat: LongCatIcon,
  manual: NewAPIIcon,
  minimax: MinimaxIcon,
  moonshot: KimiIcon,
  'newapi-generic': NewAPIIcon,
  'openai-admin': OpenAIIcon,
  openrouter: OpenRouterIcon,
  'qwen-manual': QwenIcon,
  siliconflow: SiliconCloudIcon,
  stepfun: StepfunIcon,
  zhipu: ZhipuIcon
}

// 无图标时回退显示的首字母映射表
const FALLBACK_LABEL: Record<string, string> = {
  'anthropic-admin': 'A',
  'claude-code': 'C',
  codex: 'C',
  deepseek: 'D',
  'gemini-manual': 'G',
  longcat: 'L',
  manual: 'M',
  minimax: 'M',
  moonshot: 'K',
  'newapi-generic': 'N',
  'openai-admin': 'O',
  openrouter: 'O',
  'qwen-manual': 'Q',
  siliconflow: 'S',
  stepfun: 'S',
  zhipu: 'Z'
}

/**
 * 供应商图标组件。
 * @param providerId 供应商标识
 * @param title 悬停/aria 标题(可选,默认为 providerId)
 * @param size 图标尺寸,默认 18
 * @param className 附加类名
 */
export function ProviderIcon({
  providerId,
  title,
  size = 18,
  className = ''
}: {
  providerId: string
  title?: string
  size?: number
  className?: string
}) {
  const Icon = PROVIDER_ICON[providerId]
  const label = FALLBACK_LABEL[providerId] ?? providerId.slice(0, 1).toUpperCase()

  if (!Icon) {
    return (
      <span
        aria-label={title ?? providerId}
        className={`inline-flex items-center justify-center rounded bg-bg-hover text-[10px] font-semibold text-text-secondary ${className}`}
        style={{ width: size, height: size }}
        title={title ?? providerId}
      >
        {label}
      </span>
    )
  }

  return (
    <span
      aria-label={title ?? providerId}
      className={`inline-flex items-center justify-center ${className}`}
      title={title ?? providerId}
    >
      <Icon size={size} />
    </span>
  )
}
