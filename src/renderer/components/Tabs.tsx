/**
 * 选项卡组件:轻量级标签栏,通过底部边框高亮当前选中项,
 * 与 Card / PageHeader 等基础组件的设计 token 保持一致。
 * (glm-5.2)
 */
import { type ReactNode } from 'react'
import clsx from 'clsx'

/** ponytail: minimal tab strip — no UI lib. Highlights the selected tab via
 *  bottom-border accent + bg, consistent with tailwind tokens used by the
 *  existing Card / PageHeader primitives.
 *
 * 单个选项卡定义:key、label、可选图标。 (glm-5.2) */
export interface TabDef<T extends string> {
  key: T
  label: string
  icon?: string
}

/**
 * 选项卡组件。
 * @param tabs 选项卡定义数组
 * @param active 当前激活的 key
 * @param onChange 切换回调
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange
}: {
  tabs: TabDef<T>[]
  active: T
  onChange: (k: T) => void
}): ReactNode {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-border-light mb-4">
      {tabs.map((t) => {
        const selected = t.key === active
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.key)}
            className={clsx(
              'px-3 py-2 text-[13px] flex items-center gap-2 border-b-2 -mb-px transition-colors',
              selected
                ? 'border-accent text-text-primary font-medium'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            )}
          >
            {t.icon && <i className={`fa-solid ${t.icon} text-[12px]`} />}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
