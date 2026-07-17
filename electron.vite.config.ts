import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const sharedAlias = {
  '@': resolve('code/src/renderer'),
  '@shared': resolve('code/src/shared')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: resolve('demo/out/main'),
      rollupOptions: { input: { index: resolve('code/src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: resolve('demo/out/preload'),
      rollupOptions: { input: { index: resolve('code/src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'code/src/renderer',
    build: {
      outDir: resolve('demo/out/renderer'),
      rollupOptions: { input: { index: resolve('code/src/renderer/index.html') } }
    },
    resolve: { alias: sharedAlias },
    plugins: [react()]
  }
})
