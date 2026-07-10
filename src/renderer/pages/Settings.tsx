/**
 * 设置页面:提供全局配置项,当前包含余额自动刷新间隔设置。
 * (glm-5.2)
 */
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/Card'

// ponytail: scheduler reads `refresh_interval_min` (number, minutes).
// 0 means "关闭" - refresh.ts treats intervalMin <= 0 as a no-op.
//
// 自动刷新间隔选项:0 表示关闭。 (glm-5.2)
const REFRESH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '关闭' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' }
]
/** 自动刷新间隔的设置 key */
const REFRESH_KEY = 'refresh_interval_min'

/**
 * 设置页面组件。
 * 读取并持久化余额自动刷新间隔设置。
 */
export default function Settings() {
  const [refreshMin, setRefreshMin] = useState<number>(30)

  useEffect(() => {
    void window.api.settings.get().then((all) => {
      // ponytail: settings.get returns unknown — coerce defensively.
      const raw = all[REFRESH_KEY]
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isFinite(n) && n >= 0) setRefreshMin(n)
    })
  }, [])

  /** 切换自动刷新间隔并持久化(失败时回滚) */
  async function changeRefresh(value: number) {
    const prev = refreshMin
    setRefreshMin(value)
    try {
      await window.api.settings.set(REFRESH_KEY, value)
    } catch (e) {
      setRefreshMin(prev)
      window.alert(`设置失败：${(e as Error).message}`)
    }
  }

  return (
    <div className="page-content animate-in">
      <PageHeader title="设置" desc="全局配置项与余额自动刷新" />

      <Card title="余额自动刷新" icon="fa-arrows-rotate">
        <div className="flex items-center justify-between gap-3 text-[13px] text-text-secondary">
          <div>
            <div className="text-text-primary">余额自动刷新间隔</div>
            <p className="form-hint mt-1">
              定时刷新所有 Provider 余额并触发告警评估。选择「关闭」将停止自动刷新（仍可手动触发）。
            </p>
          </div>
          <select
            className="select"
            value={refreshMin}
            onChange={(e) => changeRefresh(Number(e.target.value))}
            aria-label="余额自动刷新间隔"
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </Card>
    </div>
  )
}
