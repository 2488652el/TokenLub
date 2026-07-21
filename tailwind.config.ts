import type { Config } from 'tailwindcss'

export default {
  content: ['./code/src/renderer/**/*.{ts,tsx,html}', './code/src/renderer/index.html'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-strong) / <alpha-value>)',
          text: 'rgb(var(--color-accent-strong) / <alpha-value>)',
          dim: 'rgb(var(--color-accent) / 0.1)',
          border: 'rgb(var(--color-accent) / 0.3)'
        },
        bg: {
          base: 'rgb(var(--color-paper) / <alpha-value>)',
          sidebar: 'rgb(var(--color-paper-strong) / <alpha-value>)',
          card: 'rgb(var(--color-surface) / <alpha-value>)',
          'card-hover': 'rgb(var(--color-surface-hover) / <alpha-value>)',
          input: 'rgb(var(--color-surface) / <alpha-value>)',
          hover: 'rgb(var(--color-surface-hover) / <alpha-value>)',
          active: 'rgb(var(--color-surface-active) / <alpha-value>)'
        },
        border: {
          light: 'rgb(var(--color-line) / var(--line-alpha))',
          DEFAULT: 'rgb(var(--color-line) / var(--line-strong-alpha))',
          focus: 'rgb(var(--color-accent) / <alpha-value>)'
        },
        text: {
          primary: 'rgb(var(--color-ink) / <alpha-value>)',
          secondary: 'rgb(var(--color-muted) / <alpha-value>)',
          muted: 'rgb(var(--color-faint) / <alpha-value>)',
          'on-accent': 'rgb(var(--color-on-accent) / <alpha-value>)'
        },
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
      borderRadius: { sm: '8px', md: '10px', lg: '14px', xl: '16px', full: '9999px' }
    }
  },
  plugins: [require('@tailwindcss/forms')]
} satisfies Config
