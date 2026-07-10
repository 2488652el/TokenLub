/**
 * 浏览器窗口创建模块:负责 Electron 主窗口的实例化、安全配置、
 * 开发/生产环境加载入口切换,以及窗口内导航的安全拦截。
 * (glm-5.2)
 */
import { BrowserWindow, app, shell } from 'electron'
import { join } from 'path'

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/** 安全地打开外部链接:仅允许 http/https/mailto 协议,拦截其余协议。 (glm-5.2) */
function safeOpenExternal(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * 创建并配置应用主窗口。
 * 开发环境加载 Vite dev server,生产环境加载打包后的 HTML 文件;
 * 窗口内新窗口打开请求会转交系统浏览器处理。
 */
export function createWindow(): void {
  const isDev = !app.isPackaged
  const devIconPath = join(app.getAppPath(), 'build', 'icon.png')

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'TokenLub',
    backgroundColor: '#FAFAF8',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(isDev ? { icon: devIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (safeOpenExternal(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // ponytail: app.getAppPath() returns the asar root in production
    // (e.g. ".../resources/app.asar"), so joining with "out/renderer/index.html"
    // correctly resolves to the packaged renderer. In dev, __dirname is
    // "out/main/" so "../renderer/index.html" also works; we use the
    // app.getAppPath() form uniformly to avoid the two-mode divergence.
    // 说明:生产环境 app.getAppPath() 返回 asar 根目录,开发环境 __dirname 为 out/main/;
    // 统一使用 app.getAppPath() 形式拼接路径,避免开发/生产两种模式的差异。 (glm-5.2)
    const indexPath = join(app.getAppPath(), 'out', 'renderer', 'index.html')
    void win.loadFile(indexPath)
  }
}
