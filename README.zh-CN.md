# TokenLub

**TokenLub 是一款支持 Windows 与 macOS 的本地桌面应用，用来统一查看 LLM Token
用量、API Key 余额、模型价格和本机编码会话成本。**

[English](./README.md) · [架构说明](./docs/ARCHITECTURE.md) ·
[Provider 说明](./docs/PROVIDERS.md) · [云端同步说明书](./docs/CLOUD-SYNC-GUIDE.md)

---

## 它解决什么问题

当你同时使用多个模型服务商、Claude Code、Codex CLI 或 NewAPI 中转服务时，
Token 用量、余额、资源包、请求日志和真实成本很容易散落在不同平台里。

TokenLub 把这些信息收进一个本地 Electron 应用里：数据存在本机，Key
本地加密，界面直接面向日常排查和成本复盘。

### 功能亮点

| 模块          | 能力                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------- |
| Provider 余额 | 查询 DeepSeek、智谱、Moonshot、MiniMax、LongCat、OpenRouter、NewAPI 兼容服务等余额或资源包。 |
| 本机会话解析  | 读取 Claude Code / Codex CLI 的 JSONL 日志，按项目、模型、服务商、日期聚合用量。             |
| 成本估算      | 使用高精度 decimal 计算，支持本地配置每个模型的价格。                                        |
| API Key 管理  | 通过 Electron `safeStorage` 本地加密保存，渲染层永远拿不到明文 Key。                         |
| 请求日志      | 支持筛选、分页、查看详情和 CSV 导出。                                                        |
| 桌面发布      | Windows 生成安装包/便携版，macOS 分别生成 x64/arm64 DMG。                                    |

---

## 最新正式版

当前正式版：**TokenLub 1.0.3**

| 产物     | 路径                                         |
| -------- | -------------------------------------------- |
| 安装包   | `artifacts/dist/TokenLub-1.0.3-x64.exe`      |
| 便携版   | `artifacts/dist/TokenLub-1.0.3-portable.exe` |
| 解包目录 | `artifacts/dist/win-unpacked/`               |

应用图标已接入：

- `build/icon.ico`：Windows 安装包 / 任务栏图标
- `build/icon.icns`：macOS 应用图标
- `build/icon.png`：本地开发窗口图标
- `src/renderer/assets/tokenlub-mark.png`：渲染层侧边栏与 favicon

---

## 快速开始

### 环境要求

- Windows 10/11 或 macOS 12+
- Node.js 24.x，和 `.nvmrc` 保持一致
- npm 11+

### 安装依赖

```bash
npm install
```

如果全新 Windows 环境因为缺少 Visual Studio Build Tools 导致
`better-sqlite3` 安装失败，可以使用项目自带脚本：

```bash
npm install --ignore-scripts
node scripts/postinstall-better-sqlite3.cjs
```

这个脚本会拉取适配 Electron ABI 的 `better-sqlite3` 预构建二进制文件，
可以重复运行。

### 本地启动

```bash
npm run dev
```

### 开发检查

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

### 打包 Windows 正式版

```bash
npm run dist:win
```

默认输出到 `artifacts/dist/`。

### 打包 macOS

以下命令必须在 macOS 执行，两个架构分别生成独立 DMG：

```bash
npm run dist:mac:x64
npm run dist:mac:arm64
```

签名和公证凭据只能来自 macOS Keychain，或环境变量 `CSC_NAME`、
`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、
`APPLE_TEAM_ID`。缺少凭据时产物只能标记为 unsigned 本地构建，不能作为正式发布包。

正式发布前必须检查签名身份、应用签名、Gatekeeper、公证 Staple 和 SHA-256，
检查过程不得打印凭据值：

```bash
security find-identity -v -p codesigning
codesign --verify --deep --strict --verbose=2 "/path/to/TokenLub.app"
spctl --assess --type execute --verbose=4 "/path/to/TokenLub.app"
xcrun stapler validate "/path/to/TokenLub.app"
shasum -a 256 artifacts/dist/TokenLub-*.dmg
```

---

## 数据与改名迁移

TokenLub 的 SQLite 数据库位于 Electron `app.getPath('userData')` 目录下：

```text
tokenlub.db
```

如果用户从旧名称 TokenScope 升级，应用会尝试从旧 userData 目录里的
`tokenscope.db` 自动复制一次数据到 `tokenlub.db`，避免改名后历史 API Key、
余额快照、请求日志和价格配置看起来丢失。

---

## 安全边界

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- IPC 请求在主进程侧做校验
- API Key 使用 Electron `safeStorage` 本地加密
- 本机日志解析只读 JSONL 文件，不修改、不删除
- 不把密钥、token、`.env` 内容写进源码或日志

---

## 项目结构

```text
src/
  main/       Electron 主进程：SQLite、Provider、IPC、调度器
  preload/    暴露给渲染层的安全桥
  renderer/   React 页面、布局、图表和表单
  shared/     共享类型、IPC 契约和纯工具函数
tests/        Vitest 单元测试
docs/         架构、Provider、进度和审查报告
build/        electron-builder 静态资源，包括应用图标
artifacts/    生成的安装包和本地验证产物
```

更完整的交接说明见 `docs/ARCHITECTURE_SYNC.md`。

---

## 开发约定

- 默认做小而可审查的改动。
- 行为变化要补测试。
- 不主动添加遥测、分析或额外网络调用。
- 不在代码、日志、文档里泄露密钥。
- 正式 Windows 发布走 `npm run dist:win`。
- macOS DMG 必须在 macOS 完成签名、公证和 Gatekeeper 验证后才能标记为正式发布。

---

## 许可证

MIT
