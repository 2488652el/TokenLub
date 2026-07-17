/**
 * 应用外壳布局:左侧导航栏 + 右侧主内容区(Outlet)的整体结构。
 * (glm-5.2)
 */
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

/** 应用外壳布局组件:组合 Sidebar 与路由 Outlet */
export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg-base">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden bg-bg-base">
        <Outlet />
      </main>
    </div>
  )
}
