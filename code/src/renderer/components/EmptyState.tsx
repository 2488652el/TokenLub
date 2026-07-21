/**
 * 空状态组件:在列表/数据为空时展示图标、标题、提示文本与可选操作按钮。
 * (glm-5.2)
 */
import { type ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * 空状态展示组件。
 * @param icon 图标类名(如 fa-solid fa-inbox)
 * @param title 主标题
 * @param hint 辅助提示文本(可选)
 * @param action 可选操作节点(如按钮)
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  variant
}: {
  icon: string
  title: string
  hint?: string
  action?: ReactNode
  variant?: 'empty' | 'loading' | 'error'
}) {
  const resolvedVariant = variant ?? (icon.includes('spinner') ? 'loading' : 'empty')

  return (
    <div
      data-state={resolvedVariant}
      aria-busy={resolvedVariant === 'loading'}
      className={`motion-empty-${resolvedVariant} flex flex-col items-center py-12 px-6 text-text-muted gap-[10px]`}
    >
      <Icon name={icon} className="motion-empty-icon text-[32px] opacity-35" />
      <p className="text-[13.5px]">{title}</p>
      {hint && <p className="text-[12px]">{hint}</p>}
      {action}
    </div>
  )
}
