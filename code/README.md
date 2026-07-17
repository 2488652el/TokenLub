# Code

TokenLub 桌面应用的可执行源码：

- `src/main/`：Electron 主进程、SQLite、Provider、IPC 与调度。
- `src/preload/`：主进程与渲染层之间的安全桥。
- `src/renderer/`：React 前端界面。
- `src/shared/`：跨进程共享类型、契约和纯函数。
- `scripts/`：安装与构建需要的项目脚本。

工作区级构建配置和 `package.json` 保留在项目根目录，开发命令仍从根目录执行。
