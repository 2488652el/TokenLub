/**
 * 应用外壳布局:左侧导航栏 + 右侧主内容区(Outlet)的整体结构。
 * (glm-5.2)
 */
import { useLocation, useOutlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

/** 应用外壳布局组件:组合 Sidebar 与路由 Outlet */
export function AppShell() {
  const location = useLocation()
  const outlet = useOutlet()

  return (
    <div className="flex h-screen overflow-hidden bg-bg-base text-text-primary">
      <Sidebar />
      <main className="relative flex flex-1 flex-col overflow-hidden bg-bg-base">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_50%_-40%,rgb(var(--color-ink)/0.055),transparent_68%)]" />
        <div
          key={location.pathname}
          className="motion-route relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {outlet}
        </div>
      </main>
    </div>
  )
}
