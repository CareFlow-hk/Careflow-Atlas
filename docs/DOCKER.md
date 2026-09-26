# Docker 部署

当前版本需要 **web + auth 两个服务和 accounts 持久卷**，请按 [账号系统与 VPS 部署](ACCOUNTS.md) 操作。旧纯静态部署方案仅适用于账号实现之前的历史版本。

- 配置 `.env` 中的 `APP_ORIGIN`（精确 HTTPS origin）和未占用的 `WEB_PORT`。
- 执行 `docker compose up -d --build --wait`。
- 通过 `docker compose exec auth node server/manage.mjs bootstrap 邮箱 姓名` 初始化管理员。
- 宿主机 HTTPS 反代到 `127.0.0.1:WEB_PORT`；auth 端口不对宿主机发布。
- 升级时保留 accounts 卷；备份需使用 `server/backup.mjs`，不要直接复制运行中的 SQLite 主文件。
- 真实 VPS、DNS、TLS、外层代理及异地恢复尚需现场验证。

## 完整隔离验证

```bash
bash deploy/verify.sh
```

带浏览器验证需先安装 Playwright 和 Chromium：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
VERIFY_BROWSER=1 bash deploy/verify.sh
```

脚本仅清理它创建的独立测试项目、测试卷和镜像，不操作生产项目。端口冲突可设置 `VERIFY_PORT`。可用 `PLAYWRIGHT_MODULE` 指向外部 Playwright 模块，避免更改工作依赖。

仅检查构建不能证明账号系统运行正常；必须检查 `/api/health`、未登录 API 返回 401、管理员初始化、邀请激活、成员权限和退出。
