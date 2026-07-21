# Drive

MoonMeter 云同步服务端开发区：

- `src/server/`：HTTP、认证、PostgreSQL、迁移和同步协议实现。
- `Dockerfile` 与 `docker-compose*.yml`：本地和生产部署定义。
- `ops/`：安装、备份、升级、健康检查、卸载和隐私审计脚本。
- `docs/`：服务端部署说明。
- `.env.example`：仅包含占位值的环境变量示例。

服务端本地启动命令：`npm run server:start`。
