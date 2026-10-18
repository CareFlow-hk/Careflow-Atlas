# 账号系统与部署决策

2026-09-26：用户授权加入账号系统；从 W0 演示阶段进入独立账号实现。

- D4：独立账号，机构管理员发放邀请，无公开注册；邮箱作为登录标识，不代表已验证邮箱所有权。管理员通过既有可信渠道交付一次性链接。
- D5：单节点 Node 24.15+ HTTP 服务与 SQLite（账号、会话、邀请/重置、限流、审计），通过同源 Nginx 代理；账号数据使用独立持久卷。
- 角色：ADMIN 管理账号，MEMBER 使用演示工作台。没有按人员隔离机构业务的服务端规则。
- 2026-10-18 起，演示工作台 snapshot 另存一份到账号端（`workspaces` 表，每账号一行整份 JSON，带单调递增 `version`）；这不是业务数据库，不接受未标记合成的资料。旧的无账号缓存仍不自动迁入。详细行为见本节下文「账号端工作区」。
- 账号权限在服务端执行；客户端界面隐藏不作为授权依据。

运行步骤和验证入口如下。

## 已实现的账号流程

1. 运维在 VPS 上通过 CLI 初始化第一位管理员，无默认密码、无公开初始化接口。
2. 管理员创建成员／管理员账号，生成 1 小时有效的一次性链接。链接放在 URL fragment，打开后从地址栏移除，不进入 HTTP 请求路径或 Referer。创建新链接会使旧链接失效。
3. 成员设置 15–128 字符密码后登录。账号激活不等于邮箱所有权验证；本版本由管理员核实身份并私下交付链接，没有 SMTP、公开注册、SSO 或 MFA。
4. 「設定」頁（標題欄帳號選單 › 設定）支持改密、查看当前会话及退出其他设备。改密和重置均撤销全部会话；停用、角色或姓名更新也撤销该账号已有会话。不能停用或降级最后一位已激活管理员。
5. 忘记密码由管理员发出重置链接。管理员自己无法登录时，由持有 VPS 运维权限的人运行 `recover-admin`。这是显式的管理恢复渠道，不是匿名邮箱找回。
6. 成员不能调用管理接口；管理员可查看最近 100 条账号操作记录。密码、会话原始 token、重置链接均不进入审计记录。

## 账号端工作区（2026-10-18）

登录后，工作台先读 `GET /api/workspace`，再以本机副本作为工作副本；每次改动成功后把整份 snapshot 写到 `PUT /api/workspace`。接口只按会话里的 `user_id` 取资料，请求里没有账号 ID，因此一个账号读不到另一个账号的工作区。

- **保存语义**：`PUT` 带 `baseVersion`。服务端记录的版本与之不符时返回 `409`，不覆盖；界面上方横幅说明「已在其他裝置更新」，本机副本保留。首次写入不带 `baseVersion`，若服务端已有记录同样返回 `409`。
- **失败不假装成功**：写到账号端失败时，界面横幅说明「已儲存在本機，但未能同步到帳號端」，本机副本仍在，不会显示为已保存到账号端。清空工作区也会删除账号端副本，且同样受「先下载 Excel 备份」闸门约束。
- **两份不同不自动合并**：登录时若账号端与本机副本不一致，载入账号端版本，本机那份另存到 `careflow-atlas.account.<id>.demo.backup`，并明确提示「未有自動合併」。没有可靠业务键就不合并（CLAUDE.md §3.2）；核对请先导出 Excel。
- **边界**：服务端只接受 `isSynthetic: true` 且 `schemaVersion: "0.1-demo"` 的资料，其他一律 `400`。这是演示／正式的硬边界：W2 建好业务数据库前，未标记的资料无法停放在这张表里被误当成正式数据。
- **请求体上限** 5 MB（工作区专用，不扩大账号接口的 8 KB 上限）；每账号 15 分钟内最多 1200 次写入。整份 snapshot 约几百 KB，一次改动一次写。
- 账号端是整份 JSON，不是关系型业务表：没有按大厦／观察事件的行级事务、没有导入批次与去重。这些仍属 W2–W4。

## 安全边界

- 密码以异步 scrypt（N=32768,r=8,p=3）和每密码随机盐存储；并发哈希最多 4 个。会话／链接 token 仅保存 SHA-256 摘要。
- HTTPS 下使用 `__Host-`、Secure、HttpOnly、SameSite=Strict Cookie；所有写请求需要精确 Origin 和 JSON，会话写操作额外需要 CSRF token。
- 会话 6 小时无活动／12 小时绝对过期（2026-09-29 由 30 分钟放宽）。前端只在近期有操作时续查，并在网络错误或会话失效时关闭工作台；其他设备撤销最迟在下一次检查（活动页约 30 秒）生效。被闲置的本机演示不受服务端事务控制。
- 登录按账号和来源地址限流，计数存入 SQLite，重启不清空。Nginx 覆盖 X-Real-IP；账号服务不发布宿主机端口。若另有外层反代，限流中的来源地址可能是该代理，同代理用户共享 IP 限额；部署者应在可信边界配置真实地址，不能直接信任公网传入头。
- SQLite 是单节点账号持久化，不适合多个副本同时写共享网络卷。启动拒绝比程序更新的数据库版本。账号库与静态资源分离；仅 Node 容器挂载账号卷。
- **业务边界仍是演示状态**：工作台 snapshot 仍以浏览器 localStorage 为工作副本（按账号 ID 使用不同 key），同时写一份到账号端 `workspaces` 表。退出会清空 React/Zustand 内存，不删除该账号本机副本。共享浏览器使用者仍可通过开发者工具读取本机未加密缓存。账号端工作区不改变「业务数据库未实现」这一事实，也不是真实机构多人共享业务服务。
- Node 24 的 `node:sqlite` 仍有 ExperimentalWarning；运行时已固定镜像版本，升级需要重跑测试。

实现依据：[Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)、[OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

## 本机开发

需要 Node 24.15+。安装依赖后，在仓库根目录创建 `.env`：

```dotenv
APP_ORIGIN=http://127.0.0.1:5173
ALLOW_INSECURE_LOCALHOST=true
```

```bash
npm ci
npm run auth:manage -- bootstrap admin@example.org 管理员
npm run auth:dev
```

另一个终端运行 `npm run dev`。打开初始化命令输出的链接并设置密码。Vite 将 `/api` 代理到 127.0.0.1:3001，SQLite 默认在忽略的 `.private/auth.sqlite`。不要将开发模式对公网开放。

## VPS 上线

复制 `.env.example` 为 `.env`，设置实际 `APP_ORIGIN=https://你的独立域名`，保留 `ALLOW_INSECURE_LOCALHOST=false`，选择未被原 CareFlow 使用的 `WEB_PORT`（示例 8081）。在宿主机配置 HTTPS 反代到 `127.0.0.1:8081`，必须从域名根路径提供服务。

```bash
docker compose up -d --build --wait
docker compose exec auth node server/manage.mjs bootstrap admin@example.org 管理员
```

把输出的一次性链接私下交给管理员。不要把链接写入工单、Git、公共日志或聊天记录。账号库已有用户时再次 bootstrap 会失败。

```bash
# 管理员身份经运维核实后的恢复入口；会撤销其旧会话。
docker compose exec auth node server/manage.mjs recover-admin admin@example.org
# 当前运行状态与代理健康检查
docker compose ps
curl -fsS http://127.0.0.1:8081/api/health
# 未登录必须得到 401
curl -i http://127.0.0.1:8081/api/admin/users
```

运行镜像是 `web`（Nginx + 前端）和 `auth`（Node + SQLite）。生产账号卷必须保留，**不要对生产执行 `docker compose down --volumes`**。同一台 VPS 的原 CareFlow 使用独立目录、Compose 项目和端口。

`.openai/hosting.json` 的静态托管目标无法运行账号服务。需要完整的同源双服务栈；仅上传 dist 将显示账号连接失败。

## 备份、恢复与回滚

账号库包括密码哈希、邮箱和会话，应作为敏感资料保管，使用加密异地备份。不能在运行时直接只复制 `auth.sqlite` 而忽略 WAL。

```bash
# 文件名须每次不同；脚本拒绝覆盖已有文件。
docker compose exec auth node server/backup.mjs /app/data/accounts-backup-20260926.sqlite
umask 077
docker compose cp auth:/app/data/accounts-backup-20260926.sqlite ./accounts-backup-20260926.sqlite
```

备份脚本使用 SQLite 一致性备份 API。异地副本验证后可移除卷内对应备份以节省空间；不要清除原库。

恢复时先停止 web/auth，保留当前完整卷和镜像，再将已核对的备份放回账号卷，用 Node 容器用户可读写的权限替换数据库并移除旧库 WAL/SHM（必须在服务停止后）。重新开放前清空恢复库中的 `sessions` 与 `grants`，避免复活旧会话或一次性链接，再运行 `PRAGMA integrity_check`、健康检查和管理员登录测试。测试覆盖一致性备份后从独立数据库恢复并重新登录；真实 VPS 灾难恢复仍需现场演练。

升级前备份账号卷、记录两个旧镜像 ID 和 Compose 配置；回滚保留原卷，不要用旧的纯静态镜像将工作台直接公开。出现数据库版本不兼容时应恢复对应版本的数据库备份，不能强行降级。

## 验证入口

```bash
npm run typecheck
npm run lint
npm test
npm run test:auth
npm run build
bash deploy/verify.sh
# 另外安装 Playwright/Chromium 后运行全部真实浏览器回归：
VERIFY_BROWSER=1 bash deploy/verify.sh
```

`deploy/verify.sh` 仅创建独立临时 Compose 项目和测试账号卷，退出时清理这些测试资源。`deploy/verify-browser.mjs` 现在需要测试账号环境变量 `AUTH_TEST_EMAIL` 和 `AUTH_TEST_PASSWORD`；综合脚本自动提供临时合成账号。
