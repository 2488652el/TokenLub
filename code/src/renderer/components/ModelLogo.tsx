import { Icon as AppIcon } from './Icon'
import ChatGLMIcon from '@lobehub/icons-static-svg/icons/chatglm-color.svg?url'
import ClaudeIcon from '@lobehub/icons-static-svg/icons/claude-color.svg?url'
import DeepSeekIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url'
import GeminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg?url'
import GrokIcon from '@lobehub/icons-static-svg/icons/grok.svg?url'
import KimiIcon from '@lobehub/icons-static-svg/icons/kimi.svg?url'
import LongCatIcon from '@lobehub/icons-static-svg/icons/longcat-color.svg?url'
import MetaIcon from '@lobehub/icons-static-svg/icons/meta-color.svg?url'
import MinimaxIcon from '@lobehub/icons-static-svg/icons/minimax-color.svg?url'
import MistralIcon from '@lobehub/icons-static-svg/icons/mistral-color.svg?url'
import OpenAIIcon from '@lobehub/icons-static-svg/icons/openai.svg?url'
import OpenRouterIcon from '@lobehub/icons-static-svg/icons/openrouter.svg?url'
import QwenIcon from '@lobehub/icons-static-svg/icons/qwen-color.svg?url'
import StepfunIcon from '@lobehub/icons-static-svg/icons/stepfun-color.svg?url'
import { BrandGlyph, type BrandGlyphAsset } from './BrandGlyph'
import { ProviderIcon } from './ProviderIcon'

type ModelLogoMatch = {
  pattern: RegExp
  asset: BrandGlyphAsset
}

const MODEL_LOGOS: ModelLogoMatch[] = [
  { pattern: /claude|anthropic/i, asset: { src: ClaudeIcon } },
  { pattern: /gemini/i, asset: { src: GeminiIcon } },
  { pattern: /deepseek/i, asset: { src: DeepSeekIcon } },
  {
    pattern: /kimi|moonshot|(?:^|[/_-])k3(?:$|[/_-])/i,
    asset: { src: KimiIcon, monochrome: true, color: '#1783FF' }
  },
  { pattern: /minimax|abab/i, asset: { src: MinimaxIcon } },
  { pattern: /qwen|qwq|qvq|tongyi/i, asset: { src: QwenIcon } },
  { pattern: /grok/i, asset: { src: GrokIcon, monochrome: true } },
  { pattern: /mistral|mixtral|codestral|devstral/i, asset: { src: MistralIcon } },
  { pattern: /llama|meta/i, asset: { src: MetaIcon } },
  { pattern: /glm|chatglm|zhipu/i, asset: { src: ChatGLMIcon } },
  { pattern: /longcat/i, asset: { src: LongCatIcon } },
  { pattern: /stepfun|step-/i, asset: { src: StepfunIcon } },
  {
    pattern: /gpt|openai|codex|(?:^|[/_-])o[134](?:$|[/_-])/i,
    asset: { src: OpenAIIcon, monochrome: true }
  },
  { pattern: /openrouter/i, asset: { src: OpenRouterIcon, monochrome: true } }
]

export function ModelLogo({
  model,
  providerId,
  size = 29
}: {
  model: string
  providerId?: string
  size?: number
}) {
  const match = MODEL_LOGOS.find((item) => item.pattern.test(model))
  if (!match) {
    return providerId ? (
      <ProviderIcon providerId={providerId} size={size} />
    ) : (
      <AppIcon name="fa-cube" className="text-[18px] text-text-muted" />
    )
  }

  return <BrandGlyph asset={match.asset} size={size} />
}
