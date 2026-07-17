/**
 * 全局类型声明文件:为渲染进程扩展 Window 接口,
 * 注入由 preload 暴露的 TokenLubAPI,使渲染层可通过 window.api 调用主进程能力。
 * (glm-5.2)
 */
import type { TokenLubAPI } from '../preload'

// 扩展全局 Window 接口,声明 preload 注入的 api 字段
declare global {
  interface Window {
    api: TokenLubAPI
  }
}

export {}
