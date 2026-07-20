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
    <div className="motion-page-header mb-5 flex items-center justify-between">
      <div>
        <h1 className="text-[20px] font-semibold text-text-primary tracking-[-0.02em] leading-[1.25]">
          {title}
        </h1>
        {desc && <p className="text-[13.5px] text-text-secondary mt-1">{desc}</p>}
      </div>
      {action}
    </div>
  )
}
