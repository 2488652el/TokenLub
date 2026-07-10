/**
 * 应用根组件:配置整体路由表,将各业务页面挂载到 AppShell 布局下。
 * 通过 HashRouter 实现客户端路由切换,涵盖仪表盘、供应商、模型对比、
 * 请求日志、余额查询、API 密钥、价格配置、用量告警、设置等页面。
 * (glm-5.2)
 */
import { Navigate, Routes, Route } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import Dashboard from './pages/Dashboard'
import AgentDetail from './pages/AgentDetail'
import ProviderSummary from './pages/ProviderSummary'
import ModelCompare from './pages/ModelCompare'
import RequestLogs from './pages/RequestLogs'
import BalanceQuery from './pages/BalanceQuery'
import ApiKeys from './pages/ApiKeys'
import PricingConfig from './pages/PricingConfig'
import UsageAlerts from './pages/UsageAlerts'
import Settings from './pages/Settings'

/**
 * 应用根组件。
 * 使用 react-router 的 Routes 组织所有子路由,统一包裹在 AppShell 布局内,
 * 各 Route 的 element 对应一个业务页面。
 * (glm-5.2)
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/agents" element={<AgentDetail />} />
        <Route path="/providers" element={<ProviderSummary />} />
        <Route path="/models" element={<ModelCompare />} />
        <Route path="/logs" element={<RequestLogs />} />
        <Route path="/sessions" element={<Navigate to="/apikeys" replace />} />
        <Route path="/balance" element={<BalanceQuery />} />
        <Route path="/apikeys" element={<ApiKeys />} />
        <Route path="/pricing" element={<PricingConfig />} />
        <Route path="/alerts" element={<UsageAlerts />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
