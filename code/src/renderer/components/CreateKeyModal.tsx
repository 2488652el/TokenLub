/**
 * 创建新 API Key 的弹窗组件。
 * 负责表单状态与校验,提交时通过 onSave 将构建好的 ApiKeyCreateInput 交给父页面处理。
 * 根据 provider catalog 动态显示不同字段(Admin Key、平台 Cookie、Base URL 等)。
 * (glm-5.2)
 */
import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ProviderMetaCard } from './ProviderMetaCard'
import { buildCreateKeyPayload } from '@shared/create-key-payload'
import type { ApiKeyCreateInput } from '@shared/types/api-key'
import type { BaseUrlTemplate, ProviderCatalogEntry } from '@shared/provider-catalog'

/**
 * Modal for creating a new API key.
 *
 * Owns the form state and the validation; hands a fully-formed
 * `ApiKeyCreateInput` to the parent via `onSave`. The catalog drives what
 * extra fields are visible (admin key for admin providers, base URL hint
 * with "use default" link, etc.) so the same modal renders correctly for
 * every provider.
 *
 * ponytail: this is presentation only - no IPC calls live here. The parent
 * page handles `keys.add` after the form submits.
 *
 * 创建新 Key 的弹窗:持有表单状态与校验逻辑,提交后由父页面执行实际的 keys.add IPC 调用。 (glm-5.2)
 */
export function CreateKeyModal({
  catalog,
  onClose,
  onSave
}: {
  catalog: readonly ProviderCatalogEntry[]
  onClose: () => void
  onSave: (
    input: ApiKeyCreateInput,
    notes: { adminKeyStored: boolean; platformCookieStored: boolean }
  ) => void | Promise<void>
}) {
  const [providerId, setProviderId] = useState<string>(catalog[0]?.id ?? 'deepseek')
  const [alias, setAlias] = useState('')
  const [key, setKey] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [platformCookie, setPlatformCookie] = useState('')
  const [notes, setNotes] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const entry = useMemo(() => catalog.find((c) => c.id === providerId), [catalog, providerId])

  // Whenever the user picks a different provider, drop the admin key and
  // base URL override — they belong to the previous provider. The alias
  // and notes are deliberately preserved so people can batch-create the
  // same key across multiple vendors.
  useEffect(() => {
    setAdminKey('')
    setPlatformCookie('')
    setBaseUrl('')
  }, [providerId])

  // Derive flags from the current entry. Safe to compute even when `entry`
  // is missing (the early-return below skips the render path but the hooks
  // above still must fire in the same order every time).
  const needsAdminKey = entry?.protocol === 'anthropic-admin' || entry?.protocol === 'openai-admin'
  const supportsPlatformCookie = entry?.id === 'longcat'
  const needsBaseUrl = entry?.id === 'newapi-generic'
  const defaultUrlFilled = !!entry?.defaultBaseUrl && baseUrl.trim() === entry.defaultBaseUrl

  // Auto-open the advanced panel for providers that MUST have a base URL
  // (newapi-generic) so the user doesn't have to dig for it.
  useEffect(() => {
    setShowAdvanced(!!needsBaseUrl)
  }, [needsBaseUrl])

  if (!entry) {
    return (
      <Modal title="创建新 API Key" onClose={onClose}>
        <div className="text-text-muted text-[13px]">未找到可用的 Provider。</div>
      </Modal>
    )
  }

  // Form-state validity (cheap local check; the real IPC contract is
  // validated by the shared payload builder, which is unit-tested).
  const canSubmit = key.trim().length > 0 && (!needsBaseUrl || baseUrl.trim().length > 0)

  // 选中某个 Base URL 模板,填入输入框并展开高级面板
  function pickTemplate(tpl: BaseUrlTemplate) {
    // The template may be empty (e.g. newapi-generic self-hosted). Setting
    // an empty string clears the override so the user knows to type their
    // own URL next; the canSubmit guard keeps submission blocked.
    setBaseUrl(tpl.url)
    setShowAdvanced(true)
  }

  // 提交表单:构建 payload 并调用 onSave,失败时弹窗提示原因
  function handleSubmit() {
    if (!canSubmit || !entry) return
    const result = buildCreateKeyPayload(
      {
        providerId: entry.id,
        alias,
        apiKey: key,
        adminKey,
        platformCookie,
        baseUrl,
        notes
      },
      catalog
    )
    if (!result.ok) {
      window.alert(`创建失败：${result.reason}`)
      return
    }
    void onSave(result.input, result.notes)
  }

  return (
    <Modal title="创建新 API Key" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <div className="form-group">
          <label className="form-label">Provider</label>
          <select
            className="select w-full"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>

        <ProviderMetaCard
          entry={entry}
          onUseDefaultUrl={() => setBaseUrl(entry.defaultBaseUrl)}
          onPickTemplate={pickTemplate}
          defaultUrlFilled={defaultUrlFilled}
        />

        <div className="form-group">
          <label className="form-label">别名</label>
          <input
            className="input"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder={`留空则使用 ${entry.displayName}`}
            maxLength={100}
          />
          <p className="form-hint">用于在列表中区分同一 Provider 的多个 Key。</p>
        </div>

        <div className="form-group">
          <label className="form-label">API Key</label>
          <input
            className="input font-mono"
            type="password"
            placeholder="sk-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <p className="form-hint">Key 通过 Windows DPAPI 加密,只在内存中保留一次。</p>
        </div>

        {needsAdminKey && (
          <div className="form-group">
            <label className="form-label">
              <i className="fa-solid fa-shield-halved text-text-muted mr-1" /> Admin Key
            </label>
            <input
              className="input font-mono"
              type="password"
              placeholder="sk-admin-..."
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
            />
            <p className="form-hint">
              不同于此 API Key 的管理员密钥,用于 `/v1/organizations/*`
              端点。本地加密存储,仅主进程解密使用。
            </p>
          </div>
        )}

        {supportsPlatformCookie && (
          <div className="form-group">
            <label className="form-label">
              <i className="fa-solid fa-cookie-bite text-text-muted mr-1" /> 平台 Cookie（可选）
            </label>
            <textarea
              className="input font-mono min-h-[88px] resize-y"
              placeholder="passport_token_key=...; long_cat_region_key=0; ..."
              value={platformCookie}
              onChange={(e) => setPlatformCookie(e.target.value)}
            />
            <p className="form-hint">
              用于读取 LongCat Usage 页 Token 资源包余额。本机加密存储,不会回显；可先留空,只做 API
              Key 连通性测试。
            </p>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">备注</label>
          <input
            className="input"
            placeholder="例如：主工作机、测试 workspace"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
          />
        </div>

        <details
          className="text-[12.5px] text-text-secondary"
          open={showAdvanced}
          onToggle={(e) => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer select-none py-1 hover:text-text-primary">
            <i className="fa-solid fa-sliders text-text-muted mr-1" /> 高级 (Base URL 覆盖)
          </summary>
          <div className="form-group pt-2">
            <label className="form-label">
              Base URL Override
              {needsBaseUrl && <span className="text-red ml-1">*</span>}
            </label>
            <input
              className="input font-mono"
              type="url"
              placeholder={entry.defaultBaseUrl || 'https://your-proxy.example.com/v1'}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required={needsBaseUrl}
            />
            <p className="form-hint">
              {needsBaseUrl
                ? 'NewAPI/OneAPI 等自建代理必须填写,否则无法保存。'
                : '自建代理或镜像站时填写,留空走 Provider 默认 baseURL。'}
            </p>
          </div>
        </details>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  )
}
