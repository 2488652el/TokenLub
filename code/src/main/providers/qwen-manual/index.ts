/**
 * 通义千问 Qwen (manual) 供应商实现:无公开余额 API,需用户手动录入。
 * 该模块属于 main 进程的 providers 模块,实现为手动录入模式,仅提供测试连接占位逻辑。
 * (glm-5.2)
 */
import type { ProviderImpl, ProviderCapabilities } from '@shared/types/provider'

/** 供应商清单:标识、显示名、分类(manual)、特性(balance)及文档地址(阿里云模型工作室)。 */
const MANIFEST = {
  id: 'qwen-manual',
  displayName: '通义千问 Qwen (manual)',
  category: 'manual' as const,
  features: ['balance'] as const,
  docsUrl: 'https://help.aliyun.com/zh/model-studio'
}

/**
 * 通义千问手动录入供应商实现对象。
 * - hasBalanceApi: 不支持
 * - hasUsageApi: 不支持
 * - build: 返回仅含 testConnection 的能力对象,提示用户手动录入
 */
export const qwenManualProvider: ProviderImpl = {
  manifest: MANIFEST,
  hasBalanceApi: false,
  hasUsageApi: false,
  /** 构造供应商能力对象,不提供 balance/usage 能力,渲染层显示"手动录入"提示。 */
  build(): ProviderCapabilities {
    return {
      // balance is omitted; renderer shows "manual entry required" UI
      // 余额能力被省略;渲染层显示"需要手动录入"提示。(glm-5.2)
      testConnection: async () => ({
        ok: true,
        message: '通义千问无公开余额 API — 请在余额查询页手动录入'
      })
    }
  }
}
