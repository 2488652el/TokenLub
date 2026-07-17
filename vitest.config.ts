import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['demo/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['code/src/main/**/*.ts'],
      reportsDirectory: 'demo/coverage'
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'code/src/shared')
    }
  }
})
