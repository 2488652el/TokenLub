# GitHub 发布准备区

这里是唯一允许作为 GitHub 上传来源的准备区。

1. 先在项目分类目录中完成并验证代码修改。
2. 如需改变公开范围，人工审查并更新 `manifest.txt`。
3. 运行 `npm run github:prepare`，重新生成 `github/repository/`。
4. 生成过程会自动执行 `audit.ps1`；也可单独运行 `npm run github:audit`。
5. 只从 `github/repository/` 提交或上传，禁止从项目根目录直接发布。

`repository/` 是可重复生成的临时镜像，因此被外层项目忽略。内部计划、依赖、安装包、数据库、日志、真实 `.env`、工具缓存和本机配置不会进入该目录。
