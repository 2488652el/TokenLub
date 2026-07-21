/**
 * 统计瓷砖组件:展示单个指标(label + value + 副标题),常用于仪表盘的概览区。
 * (glm-5.2)
 */
import { type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from './Icon'

/**
 * 统计瓷砖组件。
 * @param label 标签文本
 * @param icon 图标类名(可选)
 * @param value 主数值内容
 * @param sub 副标题(可选)
 * @param accent 强调色,默认 accent
 */
export function StatTile({
  label,
  icon,
  value,
  sub,
  accent = 'accent',
  motionOrder = 0
}: {
  label: string
  icon?: string
  value: ReactNode
  sub?: string
  accent?: 'accent' | 'amber' | 'blue' | 'purple' | 'red'
  motionOrder?: number
}) {
  // 按 accent 主题映射图标颜色
  const iconColor = {
    accent: 'text-accent',
    amber: 'text-status-amber',
    blue: 'text-status-blue',
    purple: 'text-status-purple',
    red: 'text-status-red'
  }[accent]
  return (
    <div
      className="motion-card rounded-lg border border-border-light bg-bg-card/55 p-4 shadow-card"
      style={{ '--motion-order': motionOrder } as CSSProperties}
    >
      <div
        className={clsx(
          'text-[12px] text-text-muted mb-[6px] flex items-center gap-[5px]',
          iconColor
        )}
      >
        {icon && <Icon name={icon} />}
        {label}
      </div>
      <div className="text-[26px] font-medium leading-[1.2] tracking-[-0.035em] text-text-primary">
        {value}
      </div>
      {sub && <div className="text-[11.5px] text-text-muted mt-1 font-mono">{sub}</div>}
    </div>
  )
}
