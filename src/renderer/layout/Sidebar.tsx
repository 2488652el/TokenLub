/**
 * 侧边导航栏组件:展示 Logo、分组的导航项与底部版本信息。
 * Agent 明细的徽标数量在运行时从 session-log 记录中统计并填充。
 * (glm-5.2)
 */
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

const TOKENLUB_MARK_URL = new URL('../assets/tokenlub-mark.png', import.meta.url).href

/** 导航项定义 */
type NavItem = {
  to: string
  label: string
  icon: string
  badge?: string
  badgeVariant?: 'new' | 'count'
  arrow?: boolean
}

// 侧边栏导航分组:按"概览/日志与余额/管理"三段组织
const NAV_SECTIONS: { items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: '用量概览', icon: 'fa-chart-simple' },
      { to: '/agents', label: 'Agent 明细', icon: 'fa-robot' /* badge filled at runtime */ },
      { to: '/providers', label: 'Provider 汇总', icon: 'fa-server' },
      {
        to: '/models',
        label: '模型对比',
        icon: 'fa-cube',
        badge: 'NEW',
        badgeVariant: 'new'
      }
    ]
  },
  {
    items: [
      { to: '/logs', label: '请求日志', icon: 'fa-clock-rotate-left' },
      { to: '/balance', label: '余额查询', icon: 'fa-wallet', arrow: true }
    ]
  },
  {
    items: [
      {
        to: '/apikeys',
        label: 'API Keys',
        icon: 'fa-key',
        badge: 'NEW',
        badgeVariant: 'new'
      },
      { to: '/pricing', label: '价格配置', icon: 'fa-tag' },
      { to: '/alerts', label: '用量告警', icon: 'fa-bell' },
      { to: '/settings', label: '设置', icon: 'fa-gear' }
    ]
  }
]

/**
 * 侧边导航栏组件。
 * 挂载时统计 session-log 中不同 sessionId 的数量,作为 Agent 明细的徽标。
 */
export function Sidebar() {
  // ponytail: cheapest path - count distinct sessionIds from session-log
  // records. No new IPC channel needed. Carry-over: introduce
  // `usage:get-agent-count` once per-agent attribution lands.
  //
  // 统计 session-log 中不同 sessionId 的数量作为 Agent 徽标。 (glm-5.2)
  const [agentBadge, setAgentBadge] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    window.api.usage
      .getLogs({ source: 'session-log', limit: 500 })
      .then((rows) => {
        if (!alive) return
        // Defensive: rows should be an array, but a stubbed preload (e.g. in
        // tests) can resolve to undefined. Skip rather than throw — the
        // Sidebar badge is cosmetic and must not crash the whole app shell.
        if (!Array.isArray(rows)) return
        const unique = new Set<string>()
        for (const r of rows) if (r.sessionId) unique.add(r.sessionId)
        setAgentBadge(unique.size > 0 ? String(unique.size) : undefined)
      })
      .catch(() => {
        if (alive) setAgentBadge(undefined)
      })
    return () => {
      alive = false
    }
  }, [])

  // 将运行时统计的 agent 数量注入到 /agents 导航项的徽标
  const sections = NAV_SECTIONS.map((s) => ({
    items: s.items.map((it): NavItem => {
      if (it.to !== '/agents') return it
      if (agentBadge === undefined) return it
      return { ...it, badge: agentBadge, badgeVariant: 'count' as const }
    })
  }))

  return (
    <aside className="w-[216px] min-w-[216px] bg-bg-sidebar border-r border-border-light flex flex-col overflow-y-auto z-10">
      {/* Logo block */}
      <div className="logo-row p-5 pb-4 cursor-pointer flex items-center gap-3">
        <div className="logo-icon w-8 h-8 flex items-center justify-center flex-shrink-0">
          <img src={TOKENLUB_MARK_URL} alt="" className="h-full w-full object-contain" />
        </div>
        <div className="flex flex-col gap-[2px]">
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-text-primary leading-[1.2]">
            TokenLub
          </span>
          <span className="inline-flex items-center px-[7px] py-[1px] bg-text-primary text-white rounded-full text-[10px] font-medium w-fit leading-[1.4]">
            API 开放平台
          </span>
        </div>
      </div>

      <nav className="py-2 px-3 flex-1">
        {sections.map((section, si) => (
          <div key={si}>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'grid grid-cols-[18px_minmax(0,1fr)_36px] items-center gap-2.5 w-full min-h-[36px] px-3 py-2 mb-[1px] rounded-md cursor-pointer transition-colors duration-150 text-[13.5px] relative select-none',
                    isActive
                      ? 'bg-bg-active text-accent-text font-medium'
                      : 'text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <i
                      className={clsx(
                        'fa-solid',
                        item.icon,
                        'w-[18px] text-center text-[13px] flex-shrink-0',
                        isActive ? 'opacity-100' : 'opacity-75'
                      )}
                    />
                    <span className="min-w-0 truncate">{item.label}</span>
                    <span className="flex h-5 w-9 items-center justify-end">
                      {item.badge && (
                        <span
                          className={clsx(
                            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-[7px] text-[10px] font-semibold leading-none',
                            item.badgeVariant === 'new'
                              ? 'bg-text-primary text-white'
                              : 'bg-accent text-white'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                      {item.arrow && (
                        <i className="fa-solid fa-chevron-up text-[10px] opacity-35" />
                      )}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
            {si < sections.length - 1 && <div className="h-2" />}
          </div>
        ))}
      </nav>

      <div className="mt-auto p-3 border-t border-border-light">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-[30px] h-[30px] flex items-center justify-center flex-shrink-0">
            <img src={TOKENLUB_MARK_URL} alt="" className="h-full w-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-text-primary overflow-hidden text-ellipsis whitespace-nowrap">
              TokenLub
            </div>
            <div className="text-[11px] text-text-muted">本地加密 · 安全聚合</div>
          </div>
          <span className="text-[10px] text-text-muted">v{window.api.version}</span>
        </div>
      </div>
    </aside>
  )
}
