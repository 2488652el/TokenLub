/**
 * 供应商图标组件:按 providerId 渲染对应品牌图标,
 * 未匹配时回退为显示首字母的占位方块。
 * (glm-5.2)
 */
import AnthropicIcon from '@lobehub/icons-static-svg/icons/anthropic.svg?url'
import ClaudeCodeIcon from '@lobehub/icons-static-svg/icons/claudecode-color.svg?url'
import CodexIcon from '@lobehub/icons-static-svg/icons/codex-color.svg?url'
import DeepSeekIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url'
import GeminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg?url'
import KimiIcon from '@lobehub/icons-static-svg/icons/kimi.svg?url'
import LongCatIcon from '@lobehub/icons-static-svg/icons/longcat-color.svg?url'
import MinimaxIcon from '@lobehub/icons-static-svg/icons/minimax-color.svg?url'
import NewAPIIcon from '@lobehub/icons-static-svg/icons/newapi-color.svg?url'
import OpenAIIcon from '@lobehub/icons-static-svg/icons/openai.svg?url'
import OpenRouterIcon from '@lobehub/icons-static-svg/icons/openrouter.svg?url'
import QwenIcon from '@lobehub/icons-static-svg/icons/qwen-color.svg?url'
import SiliconCloudIcon from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url'
import StepfunIcon from '@lobehub/icons-static-svg/icons/stepfun-color.svg?url'
import ZhipuIcon from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url'
import { BrandGlyph, type BrandGlyphAsset } from './BrandGlyph'

// providerId 到品牌图标组件的映射表
const PROVIDER_ICON: Record<string, BrandGlyphAsset> = {
  'anthropic-admin': { src: AnthropicIcon, monochrome: true },
  'claude-code': { src: ClaudeCodeIcon },
  codex: { src: CodexIcon },
  deepseek: { src: DeepSeekIcon },
  'gemini-manual': { src: GeminiIcon },
  longcat: { src: LongCatIcon },
  manual: { src: NewAPIIcon },
  minimax: { src: MinimaxIcon },
  'kimi-coding': { src: KimiIcon, monochrome: true, color: '#1783FF' },
  moonshot: { src: KimiIcon, monochrome: true, color: '#1783FF' },
  'newapi-generic': { src: NewAPIIcon },
  'openai-admin': { src: OpenAIIcon, monochrome: true },
  openrouter: { src: OpenRouterIcon, monochrome: true },
  'qwen-manual': { src: QwenIcon },
  siliconflow: { src: SiliconCloudIcon },
  stepfun: { src: StepfunIcon },
  zhipu: { src: ZhipuIcon }
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
  'kimi-coding': 'K',
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
  const asset = PROVIDER_ICON[providerId]
  const label = FALLBACK_LABEL[providerId] ?? providerId.slice(0, 1).toUpperCase()

  if (!asset) {
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
      <BrandGlyph asset={asset} size={size} />
    </span>
  )
}
