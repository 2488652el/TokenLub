/**
 * 供应商元信息卡片组件:用于创建/编辑 Key 弹窗内展示该供应商的协议、
 * Base URL 模板、常用模型、注册链接与区域/币种提示等信息。
 * (glm-5.2)
 */
import { type BaseUrlTemplate, type ProviderCatalogEntry } from '@shared/provider-catalog'
import { PROTOCOL_LABEL } from '@shared/provider-catalog'

/**
 * Inline metadata card shown inside the "create new key" modal.
 *
 * Surfaces everything the user needs to decide whether this provider is the
 * right one for their key, without leaving the form:
 * - protocol badge (so they know it speaks OpenAI / Anthropic / native)
 * - vendor-documented base URL templates - one chip per protocol/region
 *   combo (e.g. DeepSeek exposes both OpenAI and Anthropic shapes)
 * - suggested model list
 * - signup URL (external link)
 * - region/currency hint
 *
 * All data comes from the shared `ProviderCatalogEntry`, so the modal stays
 * a thin presentation layer with no embedded provider logic.
 *
 * 供应商元信息卡片:在弹窗内展示协议徽标、Base URL 模板、常用模型、注册链接等,
 * 帮助用户无需离开表单即可判断该供应商是否合适。 (glm-5.2)
 */
export function ProviderMetaCard({
  entry,
  onUseDefaultUrl,
  onPickTemplate,
  defaultUrlFilled
}: {
  entry: ProviderCatalogEntry
  /** Called when the user clicks "使用默认 baseURL". The modal wires this to fill the override field. */
  onUseDefaultUrl: () => void
  /** Called when the user picks a vendor-documented base URL template. */
  onPickTemplate: (tpl: BaseUrlTemplate) => void
  /** Whether the override field already matches `entry.defaultBaseUrl` — disables the button to avoid no-ops. */
  defaultUrlFilled: boolean
}) {
  const badge = PROTOCOL_LABEL[entry.protocol]
  const hasDefaultUrl = entry.defaultBaseUrl !== ''

  return (
    <div className="rounded-md border border-border-light bg-bg-base/60 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full text-[11.5px] font-medium bg-accent/10 text-accent border border-accent/20"
          title={`Wire protocol: ${entry.protocol}`}
        >
          <i className="fa-solid fa-plug text-[10px]" />
          {badge}
        </span>
        <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[11.5px] font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
          {entry.region}
        </span>
        {entry.category === 'manual' && (
          <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[11.5px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <i className="fa-solid fa-pen-to-square text-[10px] mr-1" /> 手动录入
          </span>
        )}
        {entry.category === 'admin-org' && (
          <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[11.5px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            <i className="fa-solid fa-building text-[10px] mr-1" /> 组织管理
          </span>
        )}
        {entry.category === 'newapi-generic' && (
          <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[11.5px] font-medium bg-sky-50 text-sky-700 border border-sky-200">
            <i className="fa-solid fa-server text-[10px] mr-1" /> 自建代理
          </span>
        )}
      </div>

      <p className="text-[12.5px] text-text-secondary leading-relaxed">{entry.note}</p>

      <div className="space-y-1.5 text-[12px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted">默认 baseURL</span>
          <div className="flex items-center gap-2 min-w-0">
            <code className="font-mono text-text-secondary truncate max-w-[260px]">
              {hasDefaultUrl ? entry.defaultBaseUrl : '需手动填写自建 URL'}
            </code>
            {hasDefaultUrl && (
              <button
                type="button"
                onClick={onUseDefaultUrl}
                disabled={defaultUrlFilled}
                className="btn btn-ghost btn-xs disabled:opacity-50"
                title={defaultUrlFilled ? '已是默认地址' : '填入 baseURL 覆盖'}
              >
                <i className="fa-solid fa-arrow-down" /> 使用默认
              </button>
            )}
          </div>
        </div>

        {entry.baseUrlTemplates.length > 0 && (
          <div className="flex items-start justify-between gap-2 pt-1">
            <span className="text-text-muted pt-1">协议模板</span>
            <div className="flex flex-col gap-1.5 items-end max-w-[340px] w-full">
              {entry.baseUrlTemplates.map((tpl) => (
                <BaseUrlTemplateChip key={tpl.id} tpl={tpl} onClick={() => onPickTemplate(tpl)} />
              ))}
            </div>
          </div>
        )}

        {entry.defaultModels.length > 0 && (
          <div className="flex items-start justify-between gap-2">
            <span className="text-text-muted pt-1">常用模型</span>
            <div className="flex flex-wrap gap-1 justify-end max-w-[280px]">
              {entry.defaultModels.map((m) => (
                <span
                  key={m}
                  className="font-mono text-[11px] px-1.5 py-[1px] rounded bg-bg-hover text-text-secondary border border-border-light"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        {entry.signupUrl && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-muted">创建 Key</span>
            <a
              href={entry.signupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline truncate max-w-[280px]"
              title={entry.signupUrl}
            >
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px]" />
              <span className="truncate">{prettyUrl(entry.signupUrl)}</span>
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One row in the "协议模板" section. Shows the protocol chip, the full URL,
 * and an optional hint. Clicking it (or pressing the inline button) fires
 * `onPickTemplate`, which the modal wires to fill the override field.
 *
 * The whole row is keyboard-accessible (role=button + tabIndex) since the
 * most common interaction is "I want DeepSeek via Anthropic" - the user
 * should not have to aim for a small button.
 *
 * 协议模板单行:展示协议徽标、完整 URL 与提示,点击触发 onPickTemplate 填入覆盖字段。 (glm-5.2)
 */
function BaseUrlTemplateChip({ tpl, onClick }: { tpl: BaseUrlTemplate; onClick: () => void }) {
  const label = PROTOCOL_LABEL[tpl.protocol]
  return (
    <div className="w-full rounded border border-border-light bg-bg-card/60 hover:border-accent/50 transition-colors">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
        title={tpl.hint ?? tpl.url}
      >
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10.5px] font-medium bg-accent/10 text-accent border border-accent/20 flex-shrink-0">
          {label}
        </span>
        <code className="font-mono text-[11.5px] text-text-secondary truncate flex-1 min-w-0">
          {tpl.url || '（空 — 需自填）'}
        </code>
        <i className="fa-solid fa-arrow-down text-[10px] text-text-muted flex-shrink-0" />
      </button>
      {tpl.hint && (
        <p className="px-2 pb-1.5 text-[11px] text-text-muted leading-snug">{tpl.hint}</p>
      )}
    </div>
  )
}

// 将完整 URL 简化为 host + 首段路径,便于展示
function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    // host + first path segment (e.g. `https://platform.deepseek.com/api-docs/` -> `platform.deepseek.com/api-docs`)
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return seg ? `${u.host}/${seg}` : u.host
  } catch {
    return url
  }
}
