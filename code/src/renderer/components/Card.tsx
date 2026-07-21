/**
 * 通用卡片组件:提供标题、副标题、图标、操作区与正文内容的容器布局。
 * 被各业务页面复用以保持一致的卡片视觉风格。
 * (glm-5.2)
 */
import { type CSSProperties, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icon } from './Icon'
import { CARD_SURFACE_CLASS } from './cardStyles'

/** Card 组件的 props 配置 */
export interface CardProps {
  title?: string
  subtitle?: string
  icon?: string
  iconNode?: ReactNode
  action?: ReactNode
  className?: string
  bodyClassName?: string
  children?: ReactNode
  motion?: 'none' | 'reveal' | 'interactive' | 'status'
  motionOrder?: number
}

/**
 * 卡片组件。
 * @param title 标题(可选)
 * @param subtitle 副标题(可选)
 * @param icon 图标类名(可选,与 iconNode 二选一)
 * @param iconNode 自定义图标节点(可选)
 * @param action 标题右侧操作区(可选)
 * @param className 外层容器附加类名
 * @param bodyClassName 正文区附加类名
 * @param children 正文内容
 */
export function Card({
  title,
  subtitle,
  icon,
  iconNode,
  action,
  className,
  bodyClassName,
  children,
  motion = 'reveal',
  motionOrder = 0
}: CardProps) {
  const hasHeader = !!title || !!action
  return (
    <div
      data-motion={motion}
      className={clsx(
        CARD_SURFACE_CLASS,
        motion !== 'none' && 'motion-card',
        motion === 'interactive' && 'motion-card-interactive',
        motion === 'status' && 'motion-card-status',
        className
      )}
      style={{ '--motion-order': motionOrder } as CSSProperties}
    >
      {hasHeader && (
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
          {title && (
            <div>
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-text-primary">
                {iconNode ?? (icon && <Icon name={icon} className="text-[13px] text-text-muted" />)}
                {title}
              </div>
              {subtitle && (
                <div className="text-[12.5px] text-text-secondary mt-[2px]">{subtitle}</div>
              )}
            </div>
          )}
          {action}
        </div>
      )}
      <div className={clsx('px-5 py-4', bodyClassName)}>{children}</div>
    </div>
  )
}
