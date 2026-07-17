import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default [
  {
    ignores: [
      'dist/**',
      'demo/out/**',
      'demo/artifacts/**',
      'demo/tokenlub-*/**',
      'demo/coverage/**',
      'demo/playwright-report/**',
      'demo/test-results/**',
      'github/repository/**',
      '.claude/**',
      '.codex/**',
      '.superpowers/**',
      'node_modules/**',
      'release/**',
      '.worktrees/**',
      '*.cjs',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['code/src/renderer/**/*.{ts,tsx}', 'code/src/preload/**/*.ts'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }]
    }
  },
  {
    files: [
      'code/src/main/**/*.ts',
      'code/src/preload/**/*.ts',
      'code/src/shared/**/*.ts',
      'drive/src/server/**/*.ts'
    ],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['code/scripts/**/*.{cjs,mjs}', 'demo/scripts/**/*.{cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'off'
    }
  },
  {
    files: [
      'tailwind.config.ts',
      'postcss.config.mjs',
      'vitest.config.ts',
      'playwright.config.ts',
      'electron.vite.config.ts'
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'off'
    }
  }
]
