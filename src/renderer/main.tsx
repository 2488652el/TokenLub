/**
 * 渲染入口文件:在 #root 节点上挂载 React 应用。
 * 启用 StrictMode 进行开发期校验,使用 HashRouter 处理 Electron 下的前端路由,
 * 并引入全局 Tailwind 与设计 token 样式。
 * (glm-5.2)
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/tailwind.css'
import './styles/tokens.css'

// 获取根挂载节点(由 index.html 中的 #root 提供)
const root = createRoot(document.getElementById('root')!)
// 渲染应用:StrictMode 包裹以便在开发期捕获潜在问题
root.render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
)
