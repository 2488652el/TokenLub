import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { MoonMeterAppIcon, MoonMeterWordmark } from '../components/Brand'
import { Icon } from '../components/Icon'
import { useTheme, type ThemeMode } from '../theme'

type NavItem = {
  to: string
  label: string
  icon: string
  badge?: string
  badgeVariant?: 'new' | 'count'
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: '用量概览', icon: 'fa-chart-simple' },
      { to: '/agents', label: '项目用量', icon: 'fa-folder-tree' },
      { to: '/providers', label: 'Provider 汇总', icon: 'fa-server' },
      { to: '/models', label: '模型对比', icon: 'fa-cube', badge: 'NEW', badgeVariant: 'new' }
    ]
  },
  {
    label: 'Observe',
    items: [
      { to: '/logs', label: '请求日志', icon: 'fa-clock-rotate-left' },
      { to: '/balance', label: '余额查询', icon: 'fa-wallet' }
    ]
  },
  {
    label: 'Manage',
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

const THEME_OPTIONS: Array<{ mode: ThemeMode; icon: string; label: string }> = [
  { mode: 'system', icon: 'fa-display', label: '跟随系统' },
  { mode: 'light', icon: 'fa-sun', label: '浅色' },
  { mode: 'dark', icon: 'fa-moon', label: '深色' }
]

export function Sidebar() {
  const [projectBadge, setProjectBadge] = useState<string | undefined>()
  const { mode, setMode } = useTheme()

  useEffect(() => {
    let alive = true
    window.api.usage
      .getLogs({ source: 'session-log', limit: 500 })
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return
        const projects = new Set<string>()
        for (const row of rows) {
          const project = row.agentLabel?.trim() || row.sessionId
          if (project) projects.add(project)
        }
        setProjectBadge(projects.size > 0 ? String(projects.size) : undefined)
      })
      .catch(() => {
        if (alive) setProjectBadge(undefined)
      })
    return () => {
      alive = false
    }
  }, [])

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.to === '/agents' && projectBadge
        ? { ...item, badge: projectBadge, badgeVariant: 'count' as const }
        : item
    )
  }))

  return (
    <aside className="z-10 flex w-[216px] min-w-[216px] flex-col overflow-y-auto border-r border-border-light bg-bg-sidebar/80 backdrop-blur-xl">
      <div className="px-5 pb-5 pt-6">
        <MoonMeterWordmark compact className="text-text-primary" />
        <p className="mt-2 text-[9px] font-semibold tracking-[0.12em] text-text-muted">
          EVERY TOKEN, CLEARER.
        </p>
      </div>

      <nav className="flex-1 px-3 py-1" aria-label="主导航">
        {sections.map((section) => (
          <div key={section.label} className="mb-3">
            <div className="mb-1 px-3 text-[8.5px] font-semibold uppercase tracking-[0.18em] text-text-muted/70">
              {section.label}
            </div>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'motion-nav-item relative mb-1 grid min-h-[38px] w-full select-none grid-cols-[18px_minmax(0,1fr)_36px] items-center gap-2.5 rounded-md px-3 py-2 text-[13px]',
                    isActive
                      ? 'bg-text-primary font-medium text-bg-base'
                      : 'text-text-secondary hover:bg-bg-hover/70 hover:text-text-primary'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      name={item.icon}
                      className={clsx('w-[17px]', isActive ? 'opacity-100' : 'opacity-70')}
                    />
                    <span className="min-w-0 truncate">{item.label}</span>
                    <span className="flex h-5 w-9 items-center justify-end">
                      {item.badge && (
                        <span
                          className={clsx(
                            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-[7px] text-[9px] font-semibold leading-none',
                            item.badgeVariant === 'new'
                              ? isActive
                                ? 'bg-bg-base text-text-primary'
                                : 'bg-text-primary text-bg-base'
                              : 'bg-accent text-text-primary'
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-border-light p-3">
        <div
          className="mb-2 grid grid-cols-3 gap-1 rounded-full border border-border-light bg-bg-card/45 p-1"
          aria-label="外观主题"
        >
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={clsx(
                'inline-flex h-7 items-center justify-center rounded-full transition-colors',
                mode === option.mode
                  ? 'bg-text-primary text-bg-base'
                  : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
              )}
              onClick={() => setMode(option.mode)}
              aria-label={option.label}
              aria-pressed={mode === option.mode}
              title={option.label}
            >
              <Icon name={option.icon} className="text-[13px]" />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 px-2 py-2">
          <MoonMeterAppIcon className="h-8 w-8 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-text-primary">MoonMeter</div>
            <div className="text-[10px] text-text-muted">本地加密 · 安全聚合</div>
          </div>
          <span className="text-[9.5px] text-text-muted">v{window.api.version}</span>
        </div>
      </div>
    </aside>
  )
}
