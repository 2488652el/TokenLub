/**
 * 编辑已有 API Key 的弹窗组件。
 * 提供别名、Key、Admin Key、平台 Cookie、备注、Base URL 覆盖等字段的编辑,
 * 提交时通过 onSave 将 ApiKeyUpdateInput 交给父页面处理。
 * (glm-5.2)
 */
import { useMemo, useState } from 'react'
import { Modal } from './Modal'
import { ProviderMetaCard } from './ProviderMetaCard'
import type { ApiKeyRecord, ApiKeyUpdateInput } from '../../shared/types/api-key'
import type { BaseUrlTemplate, ProviderCatalogEntry } from '../../shared/provider-catalog'

/**
 * 编辑 Key 弹窗组件。
 * @param keyRecord 待编辑的 Key 记录
 * @param catalog Provider 目录
 * @param onClose 关闭回调
 * @param onSave 保存回调,接收 ApiKeyUpdateInput
 */
export function EditKeyModal({
  keyRecord,
  catalog,
  onClose,
  onSave
}: {
  keyRecord: ApiKeyRecord
  catalog: readonly ProviderCatalogEntry[]
  onClose: () => void
  onSave: (input: ApiKeyUpdateInput) => void | Promise<void>
}) {
  const [alias, setAlias] = useState(keyRecord.alias)
  const [apiKey, setApiKey] = useState('')
  const [adminKey, setAdminKey] = useState('')
  const [platformCookie, setPlatformCookie] = useState('')
  const [notes, setNotes] = useState(keyRecord.notes ?? '')
  const [baseUrl, setBaseUrl] = useState(keyRecord.baseUrlOverride ?? '')
  const [showAdvanced, setShowAdvanced] = useState(
    !!keyRecord.baseUrlOverride || keyRecord.providerId === 'newapi-generic'
  )

  const entry = useMemo(
    () => catalog.find((c) => c.id === keyRecord.providerId),
    [catalog, keyRecord.providerId]
  )
  const needsAdminKey = entry?.protocol === 'anthropic-admin' || entry?.protocol === 'openai-admin'
  const supportsPlatformCookie = entry?.id === 'longcat'
  const needsBaseUrl = entry?.id === 'newapi-generic'
  const defaultUrlFilled = !!entry?.defaultBaseUrl && baseUrl.trim() === entry.defaultBaseUrl
  const canSubmit = alias.trim().length > 0 && (!needsBaseUrl || baseUrl.trim().length > 0)

  // 选择 Base URL 模板并展开高级面板
  function pickTemplate(tpl: BaseUrlTemplate) {
    setBaseUrl(tpl.url)
    setShowAdvanced(true)
  }

  // 提交表单:组装 ApiKeyUpdateInput 并调用 onSave
  function handleSubmit() {
    if (!canSubmit) return
    const extra: Record<string, string> = {}
    if (needsAdminKey && adminKey.trim()) extra.adminKey = adminKey.trim()
    if (supportsPlatformCookie && platformCookie.trim()) {
      extra.longcatPlatformCookie = platformCookie.trim()
    }
    const input: ApiKeyUpdateInput = {
      id: keyRecord.id,
      alias: alias.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      baseUrlOverride: baseUrl.trim() ? baseUrl.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
      ...(Object.keys(extra).length > 0 ? { extra } : {})
    }
    void onSave(input)
  }

  return (
    <Modal title={`编辑 ${keyRecord.alias}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
      >
        <div className="form-group">
          <label className="form-label">Provider</label>
          <input className="input" value={entry?.displayName ?? keyRecord.providerId} disabled />
          <p className="form-hint">Provider 类型不可在编辑时切换；需要迁移时请创建新 Key。</p>
        </div>

        {entry && (
          <ProviderMetaCard
            entry={entry}
            onUseDefaultUrl={() => setBaseUrl(entry.defaultBaseUrl)}
            onPickTemplate={pickTemplate}
            defaultUrlFilled={defaultUrlFilled}
          />
        )}

        <div className="form-group">
          <label className="form-label">别名</label>
          <input
            className="input"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            required
            maxLength={100}
          />
        </div>

        <div className="form-group">
          <label className="form-label">API Key</label>
          <input
            className="input font-mono"
            type="password"
            placeholder="留空表示保持原 Key 不变"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="form-hint">为了安全,原密钥不会回显；填写新值才会替换。</p>
        </div>

        {needsAdminKey && (
          <div className="form-group">
            <label className="form-label">
              <i className="fa-solid fa-shield-halved text-text-muted mr-1" /> Admin Key
            </label>
            <input
              className="input font-mono"
              type="password"
              placeholder="留空表示保持原 Admin Key 不变"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
            />
          </div>
        )}

        {supportsPlatformCookie && (
          <div className="form-group">
            <label className="form-label">
              <i className="fa-solid fa-cookie-bite text-text-muted mr-1" /> 平台 Cookie
            </label>
            <textarea
              className="input font-mono min-h-[88px] resize-y"
              placeholder="留空表示保持原 Cookie 不变"
              value={platformCookie}
              onChange={(e) => setPlatformCookie(e.target.value)}
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">备注</label>
          <input
            className="input"
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
              placeholder={entry?.defaultBaseUrl || 'https://your-proxy.example.com/v1'}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required={needsBaseUrl}
            />
          </div>
        </details>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            保存修改
          </button>
        </div>
      </form>
    </Modal>
  )
}
