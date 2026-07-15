# 内置 Owner 管理认证

`/v1/admin/*` 复用同步服务的内置账号会话，不接入 OIDC、MFA 插件或共享管理密钥。

- `.env` 的 `ADMIN_EMAIL` 指定唯一 owner；未配置时管理路由保持关闭。
- 请求先完成现有 access token、设备和 refresh session 校验，再比对账号邮箱。
- 非 owner、过期令牌、已撤销设备与已撤销会话统一拒绝，不提供降级旁路。
- 管理路由当前只读，仅返回聚合指标与递归脱敏的审计 metadata。
- 若以后增加危险操作，必须要求近期重新认证并记录操作者、目标、trace ID 与结果。

验收要求：owner 令牌成功；普通用户、缺失令牌和撤销设备均失败；响应不得包含授权头、
access/refresh token、API Key、原始请求响应或 `raw_json`。
