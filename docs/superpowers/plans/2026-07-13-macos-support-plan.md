# TokenLub macOS 支持实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不分叉 Windows 代码的前提下，让 TokenLub 支持 macOS Intel 与 Apple Silicon，并产出可签名、公证和发布的独立 DMG。

**Architecture:** 保持现有 Main/Preload/Renderer 三进程边界，只新增窄平台适配层。Main 统一提供 CLI 路径、外部链接和系统能力，Preload 暴露最小类型化 API，Renderer 不再包含 Windows 路径。业务 Provider、SQLite schema、同步协议和页面功能保持不变。

**Tech Stack:** Electron 31、electron-vite、electron-builder、TypeScript、React 18、better-sqlite3、Vitest、Playwright。

## Global Constraints

- 只支持 `win32`、`darwin` 两个桌面平台；不新增 Linux 桌面发布目标。
- macOS 输出两个 DMG：`x64` 与 `arm64`，不构建 Universal 包。
- 正式输出使用 `artifacts/dist`；临时并行输出必须使用 `artifacts/Zcode-*`。
- Apple Developer 证书、Apple ID、App-Specific Password 和 Team ID 只能从 macOS Keychain 或环境变量读取。
- 不把 API Key、证书、密码、`.env` 内容写入源码、日志、测试快照或计划文档。
- 不改变现有 IPC 安全边界；Renderer 继续不能访问 Node、文件系统、SQLite、raw `ipcRenderer` 或完整密钥。
- 不新增遥测、自动更新、托盘、开机启动和 Mac 专属业务功能。
- 开始实现前必须检查并保留当前工作区已有用户改动，不执行 reset、checkout 或大范围格式化。

## 目标文件地图

### 新增

- `src/main/platform/paths.ts`：CLI 日志和凭据路径解析，唯一维护平台路径规则。
- `src/main/platform/external-links.ts`：安全外部链接校验与打开，消除 Main 内重复实现。
- `src/shared/types/platform.ts`：跨进程共享的平台路径和平台类型。
- `tests/unit/platform-paths.test.ts`：Windows/macOS 路径纯函数测试。
- `tests/unit/platform-external-links.test.ts`：外部链接 allowlist 测试。
- `build/icon.icns`：macOS 应用图标。

### 修改

- `src/main/log-parsers/claude.ts`
- `src/main/log-parsers/codex.ts`
- `src/main/log-parsers/cli-auth.ts`
- `src/main/log-parsers/sync.ts`
- `src/main/ipc/register-handlers.ts`
- `src/main/index.ts`
- `src/main/window.ts`
- `src/shared/ipc-channels.ts`
- `src/preload/index.ts`
- `src/renderer/pages/ApiKeys.tsx`
- `scripts/postinstall-better-sqlite3.cjs`
- `package.json`
- `README.zh-CN.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STRUCTURE.md`
- `docs/PROGRESS.md`

### 测试与发布辅助

- `tests/unit/log-parsers/claude.test.ts`
- `tests/unit/log-parsers/codex.test.ts`
- `tests/unit/log-parsers/cli-auth.test.ts`
- `tests/unit/log-parsers/sync.test.ts`
- `tests/unit/ipc-log-inputs.test.ts`
- `tests/e2e/electron-startup.spec.ts`
- `tests/e2e/macos-packaged-startup.spec.ts`
- `tests/README.md`

---

### Task 0: 建立基线并隔离用户已有改动

**Purpose:** 防止 macOS 工作误覆盖当前云同步和服务端相关的未提交改动，并固定改动前的质量基线。

**Files:**

- Read only: `AGENTS.md`, `package.json`, `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`
- Create: `artifacts/Zcode-macos-plan-baseline/` only if command output must be preserved

**Interfaces:**

- Produces: 一份未提交改动清单、当前版本号、当前测试基线和当前构建结果。

- [ ] **Step 1: 记录工作区状态，不修改文件**

```powershell
git status --short
git diff --stat
git diff -- package.json src/main/index.ts src/preload/index.ts
```

Expected: 仅记录现有用户改动；不执行 `git reset`、`git checkout` 或 stash。

- [ ] **Step 2: 执行当前快速质量基线**

```powershell
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
```

Expected: 全部退出码为 `0`。如果基线失败，先记录失败文件和错误，不把失败归因于 macOS 方案。

- [ ] **Step 3: 建立实现前风险清单**

必须记录以下现状：

- `package.json` 只有 `win.nsis` 与 `win.portable`。
- `scripts/postinstall-better-sqlite3.cjs` 写死 `electron.exe`、`x64`、`win32`。
- `claude.ts`、`codex.ts`、`cli-auth.ts` 直接调用 `homedir()` 并在模块加载时创建路径常量。
- `ApiKeys.tsx` 展示 `%USERPROFILE%` 路径。
- `main/index.ts` 和 `main/window.ts` 各自实现一份外部 URL allowlist。

Acceptance: 未完成基线记录前，不进入源码实现；基线中已有的问题必须单独标为“既有问题”。

---

### Task 1: 建立平台路径类型和纯函数解析器

**Purpose:** 把 Windows/macOS 路径差异收敛到一个可测试模块，避免路径判断散落在 Parser、IPC 和 Renderer 中。

**Files:**

- Create: `src/shared/types/platform.ts`
- Create: `src/main/platform/paths.ts`
- Create: `tests/unit/platform-paths.test.ts`

**Interfaces:**

```ts
export type SupportedDesktopPlatform = 'win32' | 'darwin'

export interface CliPaths {
  claudeProjects: string
  claudeCredentialFiles: string[]
  codexSessions: string
  codexArchivedSessions: string
  codexAuthFile: string
}

export interface CliDisplayPaths {
  claudeProjects: string
  codexSessions: string
}

export function resolveCliPaths(
  platform: SupportedDesktopPlatform,
  home: string
): CliPaths

export function getCliPaths(): CliPaths
export function getCliDisplayPaths(): CliDisplayPaths
```

- [ ] **Step 1: 先写失败测试**

测试必须覆盖：

```ts
expect(resolveCliPaths('darwin', '/Users/tester')).toEqual({
  claudeProjects: '/Users/tester/.claude/projects',
  claudeCredentialFiles: [
    '/Users/tester/.claude/.credentials.json',
    '/Users/tester/.claude/credentials.json'
  ],
  codexSessions: '/Users/tester/.codex/sessions',
  codexArchivedSessions: '/Users/tester/.codex/archived_sessions',
  codexAuthFile: '/Users/tester/.codex/auth.json'
})
```

另外覆盖：

- Windows home 含空格时仍使用 Windows 分隔符。
- macOS home 含 Unicode 字符时不丢失字符。
- `claudeCredentialFiles` 顺序保持 `.credentials.json` 在前。
- 所有返回路径都是绝对路径。

- [ ] **Step 2: 运行目标测试确认失败**

```powershell
npx vitest run tests/unit/platform-paths.test.ts
```

Expected: FAIL，原因只能是模块或接口尚未实现；如果出现环境读取真实 home、读取真实凭据或路径分隔符依赖 Windows 的错误，先修正测试隔离。

- [ ] **Step 3: 实现最小路径解析器**

实现要求：

- 使用 `path.win32` 解析 `win32`，使用 `path.posix` 解析 `darwin`，不能使用当前宿主机的 `join` 来模拟另一平台。
- `getCliPaths()` 只在 Main 调用，使用 `process.platform` 和 `homedir()`。
- 对不支持的桌面平台抛出明确错误，不回退到 Windows 路径。
- 不读取凭据文件，不打印路径中的密钥内容。

- [ ] **Step 4: 运行目标测试确认通过**

```powershell
npx vitest run tests/unit/platform-paths.test.ts
```

Expected: 所有路径测试 PASS。

Acceptance:

- 仓库中 `.claude`、`.codex` 路径规则只允许出现在平台适配层、Parser 调用处、测试 fixture 和文档中。
- Renderer 不需要知道 `win32` 或 `darwin`。

---

### Task 2: 接入 Claude/Codex Parser 和 CLI 凭据检测

**Purpose:** 让日志发现、增量同步和 CLI Key 导入在 macOS 使用真实 home 路径，同时保持 Windows 行为不变。

**Files:**

- Modify: `src/main/log-parsers/claude.ts`
- Modify: `src/main/log-parsers/codex.ts`
- Modify: `src/main/log-parsers/cli-auth.ts`
- Modify: `src/main/log-parsers/sync.ts`
- Modify: `tests/unit/log-parsers/claude.test.ts`
- Modify: `tests/unit/log-parsers/codex.test.ts`
- Modify: `tests/unit/log-parsers/cli-auth.test.ts`
- Modify: `tests/unit/log-parsers/sync.test.ts`

**Interfaces:**

- `discoverClaudeSessions(root = getCliPaths().claudeProjects)` 保持现有返回类型。
- `discoverCodexSessions(roots = [getCliPaths().codexSessions, getCliPaths().codexArchivedSessions])` 保持现有返回类型。
- `detectClaudeKey()` 和 `detectCodexKey()` 继续只在 Main 读取完整密钥，并继续返回脱敏结果给 Renderer。

- [ ] **Step 1: 为默认路径和缺失目录补充失败测试**

覆盖：

- macOS fixture 能发现 `.jsonl`。
- Claude `subagents` 子目录继续递归发现。
- Codex `sessions` 和 `archived_sessions` 都能发现。
- 路径不存在时返回空数组，不抛异常。
- 凭据文件读取使用 resolver 返回的路径。
- 测试不读取开发者真实 `~/.claude`、`~/.codex`。

- [ ] **Step 2: 修复模块级路径常量**

将模块加载时的 `homedir()` 常量改为调用时解析；保留显式 `root`/`roots` 参数作为测试和便携场景的覆盖入口。

禁止：

- 在 Parser 中新增 `process.platform` 分支。
- 在测试中修改整个 `process.env` 对象。
- 把完整 API Key 写进测试日志或错误消息。

- [ ] **Step 3: 增加日志截断回归测试**

为 `syncFiles` 增加以下场景：文件原大小大于已记录 offset，之后被截断为更小文件，再追加新内容。

Acceptance: 截断后下一次同步必须从 offset `0` 重新解析，不能跳过文件开头的新内容。若现有实现失败，最小修复是在 `st.size < byteOffset` 时将本次有效 offset 设为 `0`，不修改数据库 schema。

- [ ] **Step 4: 运行 Parser 与同步测试**

```powershell
npx vitest run tests/unit/log-parsers tests/unit/log-parsers/sync.test.ts
```

Expected: 新增和既有 Parser 测试全部 PASS，且不访问真实用户目录。

Acceptance:

- Windows 既有路径测试全绿。
- macOS fixture 路径测试全绿。
- 凭据检测仍满足 `fullKey` 不跨 IPC、不进入 Renderer 的安全契约。

---

### Task 3: 增加路径 IPC 并移除 Renderer 的 Windows 硬编码

**Purpose:** 让 UI 显示用户当前平台真实目录，同时不把 Node `os` 或 `path` 引入 Renderer。

**Files:**

- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/main/ipc/register-handlers.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/pages/ApiKeys.tsx`
- Modify: `tests/unit/ipc-log-inputs.test.ts`

**Interfaces:**

新增通道：

```ts
logLocations: 'log:locations'
```

Preload API：

```ts
log: {
  locations: (): Promise<CliDisplayPaths> =>
    ipcRenderer.invoke(IPC.logLocations)
}
```

Handler：

```ts
ipcMain.handle(IPC.logLocations, () => getCliDisplayPaths())
```

- [ ] **Step 1: 先写 IPC 契约测试**

测试要求：

- 调用 `log:locations` 不需要输入参数。
- handler 返回 `claudeProjects` 和 `codexSessions` 两个绝对路径。
- 非字符串路径仍被 `log:open-folder` 拒绝。
- 返回结构不包含 `codexAuthFile` 或任何完整密钥字段。

- [ ] **Step 2: 实现 channel、handler 和 preload bridge**

保持现有 preload 的 `as const` API 风格，不引入 Zod 到 sandbox preload；输入校验仍由 Main handler 负责。

- [ ] **Step 3: 改造 `ApiKeys.tsx` 加载路径**

页面加载时调用 `window.api.log.locations()`：

- loading 状态显示“正在读取本机路径”。
- 成功后显示平台真实路径。
- 失败时显示“路径读取失败”，不回退到 `%USERPROFILE%`。
- session 数量仍由 `log.discover()` 返回结果决定，不由展示路径决定。

- [ ] **Step 4: 执行类型、IPC 和 Renderer 测试**

```powershell
npx vitest run tests/unit/ipc-log-inputs.test.ts tests/unit/preload-version.test.ts
npm run typecheck
```

Expected: 测试和类型检查全部 PASS。

Acceptance:

- 在 macOS 实机上页面不出现 `%USERPROFILE%`。
- 在 Windows 实机上路径显示行为保持原功能，但来源改为 IPC。
- Renderer 类型中不存在 Node `PathLike`、`process` 或 `homedir` 依赖。

---

### Task 4: 收敛 Main 平台能力并消除安全校验冗余

**Purpose:** 处理 macOS 生命周期和现有重复代码，避免平台迁移时两份逻辑继续漂移。

**Files:**

- Create: `src/main/platform/external-links.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/window.ts`
- Modify: `tests/unit/platform-external-links.test.ts`

**Interfaces:**

```ts
export function isAllowedExternalUrl(url: string): boolean
export function openAllowedExternalUrl(url: string): boolean
```

允许协议固定为 `http:`, `https:`, `mailto:`；`javascript:`, `file:`, `data:` 和无法解析的 URL 必须拒绝。

- [ ] **Step 1: 为重复逻辑写失败测试**

覆盖允许与拒绝协议，并验证 `shell.openExternal` 只在允许协议时调用。

- [ ] **Step 2: 移动唯一实现**

从 `main/index.ts` 和 `main/window.ts` 删除重复 allowlist，实现两处共同调用 `platform/external-links.ts`。

- [ ] **Step 3: 修正 Windows 专属调用**

将 `app.setAppUserModelId('com.tokenlub.app')` 限定为 `process.platform === 'win32'`；保留 macOS `activate` 和 `window-all-closed` 现有行为。

- [ ] **Step 4: 验证窗口行为**

```powershell
npm run typecheck
npx vitest run tests/unit/platform-external-links.test.ts tests/unit/ipc-log-inputs.test.ts
```

Acceptance:

- `safeOpenExternal` 不再在两个文件中重复存在。
- macOS 点击 Dock 图标可重新创建窗口。
- 窗口关闭不会错误退出 macOS 应用。
- 外部链接安全行为在 Windows 和 macOS 一致。

---

### Task 5: 修复 better-sqlite3 跨平台安装和 Electron ABI 处理

**Purpose:** 确保 macOS x64/arm64 安装依赖时获得正确的 Electron native binary，同时不回归 Windows。

**Files:**

- Modify: `scripts/postinstall-better-sqlite3.cjs`
- Create: `scripts/postinstall-target.cjs`
- Modify: `package.json`
- Create: `tests/unit/postinstall-target.test.ts`

**Interfaces:**

脚本必须根据当前 Node 环境计算：

```text
electron version = node_modules/electron/package.json.version
platform        = process.platform
arch            = process.arch
runtime         = electron
```

- [ ] **Step 1: 抽取纯目标计算函数**

在 `scripts/postinstall-target.cjs` 中导出 `getPrebuildTarget({ platform, arch, electronVersion })`；安装脚本只负责读取环境、调用函数和执行命令，不在流程代码中拼接平台参数。

- [ ] **Step 2: 先写目标计算测试**

`tests/unit/postinstall-target.test.ts` 通过 `createRequire` 加载 CJS helper。目标计算函数输入 `platform`、`arch`、`electronVersion`，输出 prebuild 参数。测试固定断言：

```text
darwin + x64   -> --platform=darwin --arch=x64
darwin + arm64 -> --platform=darwin --arch=arm64
win32 + x64    -> --platform=win32 --arch=x64
```

- [ ] **Step 3: 替换硬编码 Electron 文件探测**

Windows 检查 `dist/electron.exe`；macOS 检查 `dist/Electron.app/Contents/MacOS/Electron`。缺失时继续调用 Electron 自带 `install.js`。

- [ ] **Step 4: 保留现有 fallback 行为**

预构建包下载失败时仍允许 `node-gyp rebuild --release`，但错误信息必须明确提示当前平台、架构和所需编译工具。

- [ ] **Step 5: 在当前 Windows 环境验证回归**

```powershell
node --check scripts/postinstall-better-sqlite3.cjs
npm run typecheck
npm test
```

Acceptance:

- 当前 Windows 安装脚本行为不变。
- macOS 实机 `npm ci` 后 `better_sqlite3.node` 能被 Electron 加载。
- x64 和 arm64 不能共用错误架构的 native binary。

---

### Task 6: 增加 macOS 图标、DMG 配置和构建命令

**Purpose:** 让工程能从同一个源码生成两个可识别、可分发的 macOS 安装包。

**Files:**

- Create: `build/icon.icns`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Interfaces:**

增加脚本：

```json
{
  "dist:mac:x64": "npm run build:clean && electron-builder --mac dmg --x64",
  "dist:mac:arm64": "npm run build:clean && electron-builder --mac dmg --arm64",
  "dist:mac": "npm run build:clean && electron-builder --mac dmg --x64 && electron-builder --mac dmg --arm64"
}
```

增加 builder 配置：

```json
{
  "mac": {
    "icon": "build/icon.icns",
    "category": "public.app-category.utilities",
    "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
    "artifactName": "${productName}-${version}-${arch}.${ext}"
  }
}
```

- [ ] **Step 1: 在 macOS 生成 icns**

使用现有 `build/icon.png` 生成标准 iconset，并通过 `iconutil` 输出 `build/icon.icns`。图标必须包含 16、32、128、256、512、1024 像素尺寸及 `@2x` 版本。

- [ ] **Step 2: 在 Windows 先验证配置解析**

```powershell
npm run build:clean
npx electron-builder --dir --config.directories.output=artifacts/Zcode-macos-config-check
```

Expected: 配置可解析、Renderer 和 Main 构建成功；Windows 不要求生成 DMG。

- [ ] **Step 3: 在 macOS 构建两个架构**

```bash
npm ci
npm run typecheck
npm test
npm run dist:mac:x64
npm run dist:mac:arm64
```

Expected: `artifacts/dist/` 生成两个 DMG，文件名分别包含 `x64` 和 `arm64`。

- [ ] **Step 4: 检查产物内容**

```bash
hdiutil verify artifacts/dist/TokenLub-*-x64.dmg
hdiutil verify artifacts/dist/TokenLub-*-arm64.dmg
```

Acceptance:

- 两个 DMG 都能挂载。
- `.app` 的 `Info.plist` 中 app id 为 `com.tokenlub.app`。
- 两个 `.app` 架构分别匹配目标架构。
- 产物没有落在项目根目录或 `release*` 临时目录。

---

### Task 7: 增加 macOS 打包 Electron E2E 和核心回归验收

**Purpose:** 证明问题发生在真实 Electron preload、原生模块和打包应用时能被发现，而不是只验证浏览器页面。

**Files:**

- Modify: `tests/e2e/electron-startup.spec.ts`
- Create: `tests/e2e/macos-packaged-startup.spec.ts`
- Modify: `tests/README.md`

**Interfaces:**

打包烟测必须支持通过环境变量接收待测应用路径，不读取真实用户数据：

```text
TOKENLUB_PACKAGED_APP=/path/to/TokenLub.app
TOKENLUB_TEST_USER_DATA=/tmp/tokenlub-e2e-profile
```

- [ ] **Step 1: 增加临时 profile 启动测试**

测试流程：

1. 使用临时 userData 启动 `.app`。
2. 断言窗口标题为 `TokenLub`。
3. 断言 `window.api.version` 与 package 版本一致。
4. 断言 body 非空。
5. 读取 `window.api.log.locations()`，确认路径为 macOS 绝对路径。
6. 写入并读取一个非敏感 setting。
7. 关闭并清理临时 profile。

- [ ] **Step 2: 增加核心业务冒烟**

使用 synthetic key 和 fixture 数据验证：

- API Key 创建、删除。
- safeStorage 加密往返。
- SQLite schema 初始化。
- 日志发现空目录返回空列表。
- 请求日志页面可加载。

禁止使用真实 API Key、真实 Claude/Codex 目录或真实用户数据库。

- [ ] **Step 3: 在两个架构分别运行**

```bash
TOKENLUB_PACKAGED_APP=".../x64/TokenLub.app" npm run test:e2e -- tests/e2e/macos-packaged-startup.spec.ts
TOKENLUB_PACKAGED_APP=".../arm64/TokenLub.app" npm run test:e2e -- tests/e2e/macos-packaged-startup.spec.ts
```

Acceptance:

- 两个架构启动测试均 PASS。
- Renderer 能调用 preload API。
- better-sqlite3 不出现 ABI、加载或架构错误。
- 测试结束后临时 profile 被删除。

---

### Task 8: 签名、公证和安装后安全验收

**Purpose:** 把“能打包”与“用户可安装发布”区分开，避免把未签名 DMG 当成正式发布包。

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/PROGRESS.md`
- Modify: `tests/README.md`

**Interfaces:**

签名和公证只读取以下外部配置，不在仓库保存值：

```text
CSC_NAME
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

- [ ] **Step 1: 验证签名环境已注入**

只检查变量是否存在和证书是否可用，不打印变量值：

```bash
security find-identity -v -p codesigning
```

Expected: 找到 Developer ID Application 身份；否则将本次构建标记为 unsigned，不继续声称正式发布完成。

- [ ] **Step 2: 构建并公证两个架构**

```bash
npm run dist:mac:x64
npm run dist:mac:arm64
```

使用 electron-builder 的 notarization 配置完成签名和公证，凭据来源只能是环境变量或 Keychain profile。

- [ ] **Step 3: 验证签名和 Gatekeeper**

```bash
codesign --verify --deep --strict --verbose=2 ".../TokenLub.app"
spctl --assess --type execute --verbose=4 ".../TokenLub.app"
xcrun stapler validate ".../TokenLub.app"
```

Acceptance:

- 签名验证成功。
- `spctl` 不因未签名或未公证拒绝。
- Staple 验证成功。
- 文档明确记录版本、架构、产物路径、签名状态和 SHA-256。

---

### Task 9: 冗余审查、Bug 检测和发布门禁

**Purpose:** 在宣布 macOS 完成前，检查重复实现、跨平台遗漏、安全回归和构建产物问题。

**Files:**

- Review only: `src/main`, `src/preload`, `src/renderer`, `src/shared`, `scripts`, `package.json`
- Modify only when a finding is P0/P1 or directly blocks macOS parity.

- [ ] **Step 1: 做平台分支审查**

```powershell
rg -n "process\.platform|process\.arch|homedir\(|\.claude|\.codex|%USERPROFILE%|electron\.exe|--platform=win32|--arch=x64" src scripts package.json
```

Acceptance:

- 平台路径规则只在 `src/main/platform/paths.ts` 和测试/文档中维护。
- 原生构建参数不再写死 Windows x64。
- Renderer 中没有 `%USERPROFILE%`、`process.platform` 或 `homedir()`。
- 外部链接 allowlist 只有一个实现。

- [ ] **Step 2: 做安全审查**

检查：

- 完整 API Key 不出现在 Renderer IPC 返回值。
- `log:open-folder` 仍只允许目录。
- 外部 URL 仅允许 `http`、`https`、`mailto`。
- 签名凭据不出现在 Git diff、构建日志和文档。
- E2E 不读取真实用户目录。

Acceptance: 发现任意密钥泄露、任意协议外链执行或真实凭据读取时，发布直接阻塞。

- [ ] **Step 3: 做运行时 Bug 矩阵**

至少验证：

| 场景 | 预期 |
| --- | --- |
| Claude/Codex 目录不存在 | 显示空状态，不崩溃 |
| 路径含空格和 Unicode | 能发现、同步和打开目录 |
| JSONL 含损坏行 | 跳过损坏行，其他记录继续处理 |
| JSONL 被截断 | offset 重置，不漏读新内容 |
| safeStorage 不可用 | 明确错误，不写入明文密钥 |
| 数据库首次启动 | 自动创建并完成迁移 |
| macOS 关闭窗口 | 应用保持可由 Dock 激活 |
| DMG 架构不匹配 | 构建或启动阶段明确失败，不生成伪成功产物 |

- [ ] **Step 4: 执行最终门禁**

```powershell
npm run typecheck
npm test
npm run lint
npm run format:check
npm run build
```

macOS 额外执行：

```bash
npm run test:e2e
npm run dist:mac:x64
npm run dist:mac:arm64
```

Release blocking conditions：

- 任意 typecheck、unit test、lint、format、build 或 packaged E2E 失败。
- 任意架构 native module 加载失败。
- 任意签名、公证或 Gatekeeper 验证失败。
- 发现 Renderer 能取得完整密钥。
- DMG 未包含正确图标、app id 或目标架构。

允许保留但必须记录的非阻塞项：

- 既有 Vite 静态/动态 import warning。
- 没有 Apple Developer 凭据导致的 unsigned 本地包。
- Claude/Codex 仅使用明文 API Key 文件时的既有检测范围；本期不新增 Keychain OAuth 导入。

## 完成定义

macOS 支持只有在以下条件全部满足时才算完成：

1. Windows 现有质量基线没有回归。
2. macOS x64 与 arm64 都能从干净依赖安装开始构建。
3. 两个 DMG 都能启动真实 Electron 应用并加载 preload。
4. 日志路径、CLI 检测、SQLite、safeStorage 和核心页面通过实机验收。
5. 冗余扫描确认平台分支和外部链接校验没有重复实现。
6. 所有 P0/P1 Bug 已修复；P2/P3 问题已记录在 `docs/PROGRESS.md`。
7. 若为正式发布，两个架构的签名、公证、Staple 和 Gatekeeper 验证全部成功。
