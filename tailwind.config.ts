import type { Config } from 'tailwindcss'

export default {
  content: ['./code/src/renderer/**/*.{ts,tsx,html}', './code/src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#10B981', hover: '#059669', text: '#059669', dim: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)' },
        bg: { base: '#FAFAF8', sidebar: '#FFFFFF', card: '#FFFFFF', 'card-hover': '#F9FAFB', input: '#FFFFFF', hover: '#F3F4F6', active: '#ECFDF5' },
        border: { light: '#E8E8E6', DEFAULT: '#D4D4D2', focus: '#10B981' },
        text: { primary: '#171717', secondary: '#737373', muted: '#A3A3A3', 'on-accent': '#FFFFFF' },
        status: { red: '#EF4444', 'red-dim': 'rgba(239,68,68,0.08)', amber: '#F59E0B', 'amber-dim': 'rgba(245,158,11,0.08)', blue: '#3B82F6', 'blue-dim': 'rgba(59,130,246,0.08)', purple: '#8B5CF6', 'purple-dim': 'rgba(139,92,246,0.08)', pink: '#EC4899', orange: '#F97316' },
        tag: {
          anthropic: { bg: 'rgba(195,154,109,0.1)', fg: '#996B38' },
          openai: { bg: 'rgba(59,130,246,0.08)', fg: '#3B82F6' },
          gemini: { bg: 'rgba(16,185,129,0.08)', fg: '#059669' },
          deepseek: { bg: 'rgba(139,92,246,0.08)', fg: '#8B5CF6' },
          longcat: { bg: 'rgba(245,158,11,0.08)', fg: '#B45309' }
        }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"SF Mono"', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      spacing: { '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px', '6': '24px', '8': '32px', '10': '40px' },
      borderRadius: { sm: '6px', md: '8px', lg: '12px', xl: '16px', full: '9999px' }
    }
  },
  plugins: [require('@tailwindcss/forms')]
} satisfies Config
