/**
 * 页面头部组件:展示页面标题、描述与右侧操作区。
 * (glm-5.2)
 */
import { type ReactNode } from 'react'

/**
 * 页面头部组件。
 * @param title 页面标题
 * @param desc 描述文本(可选)
 * @param action 右侧操作节点(可选)
 */
export function PageHeader({
  title,
  desc,
  action
}: {
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div className="motion-page-header mb-6 flex items-end justify-between gap-6 border-b border-border-light pb-5">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.2em] text-text-muted">
          <span className="h-px w-6 bg-current" />
          MoonMeter
        </div>
        <h1 className="text-[26px] font-medium leading-[1.2] tracking-[-0.035em] text-text-primary">
          {title}
        </h1>
        {desc && <p className="mt-1.5 text-[12.5px] text-text-secondary">{desc}</p>}
      </div>
      {action && <div className="flex-shrink-0 pb-0.5">{action}</div>}
    </div>
  )
}
