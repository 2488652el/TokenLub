/**
 * 用量查询模式默认值推导:根据供应商 manifest 的 category 推断 api key 的 QueryMode。
 * 该模块属于 main 进程的 store 模块,admin-org 供应商默认 auto,其余默认 manual。
 * (glm-5.2)
 */
import { getProvider } from '../providers/registry'
import type { QueryMode } from '@shared/types/api-key'

/**
 * Derive the default {@link QueryMode} for an api key based on its provider's
 * manifest category. Admin/org providers (anthropic-admin, openai-admin, …)
 * have a vendor-hosted usage API and default to `auto`; everything else
 * defaults to `manual` and lets the user opt in via toggle.
 *
 * Implemented by delegating to {@link getProvider} (same call site as
 * `scheduler/refresh.ts`) so provider availability stays a single point of
 * truth. Unknown providers fall back to `manual`.
 * 根据供应商 manifest 的 category 推导默认 QueryMode:admin-org 为 auto,其余为 manual;未知供应商回退 manual。(glm-5.2)
 */
export function deriveQueryMode(providerId: string): QueryMode {
  const p = getProvider(providerId)
  return p?.manifest.category === 'admin-org' ? 'auto' : 'manual'
}
