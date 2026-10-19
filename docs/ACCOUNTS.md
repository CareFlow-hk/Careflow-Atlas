# 账号系统与部署决策

2026-09-26：用户授权加入账号系统；从 W0 演示阶段进入独立账号实现。

- D4：独立账号，机构管理员发放邀请，无公开注册；邮箱作为登录标识，不代表已验证邮箱所有权。管理员通过既有可信渠道交付一次性链接。
- D5：单节点 Node 24.15+ HTTP 服务与 SQLite（账号、会话、邀请/重置、限流、审计），通过同源 Nginx 代理；账号数据使用独立持久卷。
- 角色：ADMIN 管理账号、管理整个机构的工作区；MEMBER 参与同一份工作区。没有按人员隔离机构业务的服务端规则。
- 2026-10-18 起，演示工作台 snapshot 另存一份到账号端。2026-10-19 起改为**每个机构一份**（`org_workspaces` 表，每个 `org_id` 一行整份 JSON，带单调递增 `version`），同机构的账号读写同一份；这不是业务数据库，不接受未标记合成的资料。旧的无账号缓存仍不自动迁入。详细行为见本节下文「机构工作区与权限」。
- 账号权限在服务端执行；客户端界面隐藏不作为授权依据。

运行步骤和验证入口如下。

## 已实现的账号流程

1. 运维在 VPS 上通过 CLI 初始化第一位管理员，无默认密码、无公开初始化接口。
2. 管理员创建成员／管理员账号，生成 1 小时有效的一次性链接。链接放在 URL fragment，打开后从地址栏移除，不进入 HTTP 请求路径或 Referer。创建新链接会使旧链接失效。
3. 成员设置 15–128 字符密码后登录。账号激活不等于邮箱所有权验证；本版本由管理员核实身份并私下交付链接，没有 SMTP、公开注册、SSO 或 MFA。
4. 「設定」頁（標題欄帳號選單 › 設定）支持改密、查看当前会话及退出其他设备。改密和重置均撤销全部会话；停用、角色或姓名更新也撤销该账号已有会话。不能停用或降级最后一位已激活管理员。
5. 忘记密码由管理员发出重置链接。管理员自己无法登录时，由持有 VPS 运维权限的人运行 `recover-admin`。这是显式的管理恢复渠道，不是匿名邮箱找回。
6. 成员不能调用管理接口；管理员可查看最近 100 条账号操作记录。密码、会话原始 token、重置链接均不进入审计记录。

## 机构工作区与权限（2026-10-19）

登录后，工作台先读 `GET /api/workspace`，再以本机副本作为工作副本；每次改动成功后把整份 snapshot 写到 `PUT /api/workspace`。接口按会话里的 `user.org_id` 取资料，请求里没有账号或机构 ID：**同一机构的所有账号看到、写到同一份**，其他机构读不到。

- **一个机构一份**：`org_workspaces(org_id, snapshot, version, updated_at)`。默认机构 `org-default`（`organizations` 表）在打开账号库时创建；现有账号的 `org_id` 在迁移时补成它。账号的 `orgId` 会回到浏览器，用来决定本机副本的 key。
- **本机副本也按机构**：`careflow-atlas.org.<orgId>.demo` / `.demo.base` / `.options`。同一部电脑上两个同事登录，看到的是同一份。第一次启用机构 key 时，如果该账号旧的 `careflow-atlas.account.<id>.demo` 有资料而机构副本还没有，会把旧副本抄一份过去（旧 key 不删除），避免升级后看起来像是资料被清空。第二个账号在同一部电脑的旧副本不会自动合并，以账号端为准。
- **保存语义**：`PUT` 带 `baseVersion`。服务端记录的版本与之不符时返回 `409`，不覆盖。首次写入不带 `baseVersion`，若服务端已有记录同样返回 `409`。
- **写前先拉、逐笔合并**：每次把改动写回账号端之前，先 `GET` 账号端最新版本，与本机副本逐笔记录合并，再写合并结果；版本不符（`409`）时重新拉取并再合并一次（最多 3 次）。所以另一部装置、另一位同事的更新会先被收进来，不会被这一部整份盖掉。
- **合并按记录 id，不按内容**：三份输入是「上次与本机一致的版本（`base`，存于 `…org.<orgId>.demo.base`）」「本机改过的副本」「账号端现在的版本」。只有一边改过 → 取那一边；一边新增 → 保留；一边删除、另一边没动 → 删除生效；两边都改过且不同 → **不猜**，见下条。引用完整性（`src/domain/schema.ts` superRefine）不通过时保留两边记录并在横幅说明删改被撤回，不会静默丢弃。
- **两边改同一笔就停下来问**：同一记录两边都改过时，本机副本原封不动，横幅提示「未有自動決定」，点「立即處理」打开对话框逐笔选择「保留本機／保留帳號端」（一边删除了就显示「本機（刪除）」这类），选好之前不写账号端。对话框可以「稍後處理」，横幅也可以直接关闭。
- **失败不假装成功**：写到账号端失败时，界面横幅说明「已儲存在本機，但未能同步到帳號端」，本机副本仍在，不会显示为已保存到账号端。`403` 例外：那是服务端拒绝这个改动本身，不是网络问题，所以横幅直接写拒绝原因，并把本机副本退回账号端当前的版本，免得之后每次保存都带着这个改动再被拒一次。清空工作区同样受「先下载 Excel 备份」闸门约束，且只有管理员可以执行。
- **清空留下一个空版本，不是删掉那一行**：`DELETE /api/workspace` 把机构副本换成一个空工作区并把 `version` 加一，返回新版本。如果直接删行，其他同事的浏览器会读到「服务器上什么都没有」，把他们手里那份旧资料当成第一次写入再传上来，清空就等于没做。保留空版本后，他们的旧副本会因版本落后被拒绝，再读时看到的是空工作区。
- **本机副本不会被另存为找不到的 `.backup`**：旧行为「载入账号端版本、本机那份存成 `.backup`」已取消。本机改动留在原处参与合并；真正无法合并时也留在本机，并在横幅里给出「以本機版本覆寫帳號端」的显式出口（两次点击确认）。
- **边界**：服务端只接受 `isSynthetic: true` 且 `schemaVersion: "0.1-demo"` 的资料，其他一律 `400`。这是演示／正式的硬边界：W2 建好业务数据库前，未标记的资料无法停放在这张表里被误当成正式数据。
- **请求体上限** 5 MB（工作区专用，不扩大账号接口的 8 KB 上限）；每账号 15 分钟内最多 1200 次写入。整份 snapshot 约几百 KB，一次改动一次写。
- 账号端是整份 JSON，不是关系型业务表：没有按大厦／观察事件的行级事务、没有导入批次与去重。这些仍属 W2–W4。

### 角色能做什么

服务端在整份文档写入前逐笔比对（`server/workspaceAccess.mjs`），不是只看界面按钮：

| 操作 | ADMIN | MEMBER |
| --- | --- | --- |
| 新增记录（表单、批次、照片回录、Excel 导入） | 可以 | 可以 |
| 处理跟进（完成／取消／撤销） | 可以 | 可以 |
| 新增楼层、新增单位、把单位分拆成更多劏房 | 可以 | 可以 |
| 删除楼层、删除单位、把劏房合并回更少间 | 可以，仍受「先下载 Excel 备份」闸门（带记录时） | 拒绝（`403`），即使是自己刚加的、或没有记录的单位 |
| 撤回**自己建立、内容未被改动**的记录 | 可以 | 可以 |
| 撤回别人的记录、或没有作者（旧资料）的记录 | 可以 | 拒绝（`403`） |
| 清空整个机构工作区 | 可以 | 拒绝（`403`），界面也不显示 |
| 管理账号、查看审计、切换功能开关 | 可以 | 拒绝（`403`） |

- **结构对员工只增不减**：员工可以新增楼层、加单位、把单位分拆成多间劏房（都是新增），但不能删楼层、删单位、或把劏房合并回更少间——判定依据是「这次改动有没有移走某个位置」（`removesStructure`，`src/domain/structure.ts`），与那里有没有记录、是不是自己刚加的无关。界面上员工的删除按钮不出现，结构编辑器改说这条规则；即使绕过界面，服务端也会以 `403` 拒绝，并把原因写在横幅里，不会说成网络问题。
- **撤回不是删除**：记录保留在原处，加一个 `deleted: { at, by }` 标记。它离开覆盖、摘要、待跟进与 Excel「紙本回錄」页，但仍留在历史、`關聯封存` 与巡检记录中。撤回只发生一次，重复撤回不改变第一次的标记。
- **谁建立、谁撤回都留名**：新记录带 `createdBy`（登录账号，不是纸本工作员）。旧记录没有这个字段，不会被补上不存在的身份；这类记录只有管理员能撤回。
- 撤回一条更正后，被它更正的原记录重新成为有效版本；更正链仍按链尾生效。

### 从「每账号一份」迁移（schema v2）

打开账号库时按 `PRAGMA user_version` 迁移 1 → 2：

1. 建 `organizations`、`org_workspaces`，给 `users` 加 `org_id` 并把空值补成 `org-default`。
2. 若旧 `workspaces` 表存在且机构还没有副本，取**最近更新**的一行作为种子（`version = 1`）。旧账号副本的数据互不合并：多个人各有一份不同资料时，只有最近更新的那份进入机构副本。
3. 旧 `workspaces` 表原样保留，升级可以回滚；程序不会删除它。

这项迁移只搬「最近使用的一份」，不是真正的资料合并。升级前各账号若曾各自离线录入，请先各自导出 Excel 再升级。

## 安全边界

- 密码以异步 scrypt（N=32768,r=8,p=3）和每密码随机盐存储；并发哈希最多 4 个。会话／链接 token 仅保存 SHA-256 摘要。
- HTTPS 下使用 `__Host-`、Secure、HttpOnly、SameSite=Strict Cookie；所有写请求需要精确 Origin 和 JSON，会话写操作额外需要 CSRF token。
- 会话 6 小时无活动／12 小时绝对过期（2026-09-29 由 30 分钟放宽）。前端只在近期有操作时续查，并在网络错误或会话失效时关闭工作台；其他设备撤销最迟在下一次检查（活动页约 30 秒）生效。被闲置的本机演示不受服务端事务控制。
- 登录按账号和来源地址限流，计数存入 SQLite，重启不清空。Nginx 覆盖 X-Real-IP；账号服务不发布宿主机端口。若另有外层反代，限流中的来源地址可能是该代理，同代理用户共享 IP 限额；部署者应在可信边界配置真实地址，不能直接信任公网传入头。
- SQLite 是单节点账号持久化，不适合多个副本同时写共享网络卷。启动拒绝比程序更新的数据库版本。账号库与静态资源分离；仅 Node 容器挂载账号卷。
- **业务边界仍是演示状态**：工作台 snapshot 仍以浏览器 localStorage 为工作副本（按机构 ID 使用不同 key：`…demo` 是工作副本，`…demo.base` 是上次与本机一致的版本），同时写一份到服务器端 `org_workspaces` 表（整份 snapshot，按机构一行）。退出会清空 React/Zustand 内存，不删除该机构本机副本。同一部电脑上的同事共用同一份未加密缓存，都能用开发者工具读取。服务器端工作区不改变「业务数据库未实现」这一事实，也不是加密的真实机构业务服务。
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

## 功能开关（2026-10-18）

管理员在「设定 › 功能开关」打开或关闭全站功能，不需要 SSH 改 `.env`。状态存在账号库的 `features` 表，默认全部关闭；每次切换都写进操作记录（谁、何时、开或关）。

| 开关 | 关闭时 |
| --- | --- |
| `photoIntake` 照片回录（Azure 辨识） | 顶栏不显示入口；`POST /api/photos/recognize` 在读取上传内容之前就返回 403，照片不会送出 |

- 读取：`GET /api/features`（登入即可）。修改：`PUT /api/admin/features`，`{ key, enabled }`，仅管理员。
- 机密仍放 `.env`：开关不能代替 Azure key。开了但没配 key，设定页会提示无法辨识。
- 新增开关：在 `server/features.mjs` 的 `FEATURES` 加一项，界面文字加在 `AccountPanel` 的 `featureText`，服务器端在对应接口用 `features.enabled(key)` 拦住。只藏按钮不算关闭。
