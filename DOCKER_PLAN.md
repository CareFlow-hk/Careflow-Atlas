> 2026-09-26 更新：独立账号系统已实现。本文原有“纯静态／无后端／无登录”段落属于历史基线；当前运行与部署以 [docs/ACCOUNTS.md](docs/ACCOUNTS.md) 为准。业务共享持久化仍未实现。

# CareFlow Atlas · Docker 封装执行契约与计划

> 状态：**执行中**（计划于本文件写定后立即执行，执行结果见文末「执行回执」）
> 基线：`main` @ `2eb588b`，工作树干净
> 本文件只约束「把现有静态前端装进容器」这一件事；项目定位见 [README.md](README.md)，工作约定见 [CLAUDE.md](CLAUDE.md)，后端计划见 [BACKEND_GAP_ANALYSIS.md](BACKEND_GAP_ANALYSIS.md)。

## 1. 目标

让同事能在自己的 VPS 上用一条命令跑起这个工作台：**把 `dist/` 静态产物装进一个 nginx 容器**，对外提供 HTTP 服务，构建过程可复现、不需要在宿主机装 Node。

## 2. 非目标（明确不做）

| 不做 | 原因 |
| --- | --- |
| 后端、HTTP API、数据库、迁移脚本 | [CLAUDE.md](CLAUDE.md) 第 2 节、第 7 节：W0 阶段不引入事务、登录或数据库实现 |
| 登录、会话、审计、访问控制实现 | 属 BACKEND_GAP_ANALYSIS 的 W2；本镜像的临时访问限制只能用反代兜，见第 8 节 |
| 多用户共享同一份数据 | 数据整份存在访问者浏览器 `localStorage`，容器**不改变**这一点 |
| 持久化卷、备份制度 | 容器内无业务数据可备份；[CLAUDE.md](CLAUDE.md) 第 7 节明确禁止把导出 JSON 当备份制度 |
| 修改 `src/` 应用代码 | 本次是打包，不是改功能；`fetch('/demo/...')` 的根路径行为保持不变 |
| CI / 镜像仓库 / K8s 编排 | 无人要求，且仓库当前没有 CI |
| 在镜像里放任何真实资料 | [CLAUDE.md](CLAUDE.md) 第 7 节：正式导入文件、导出文件、备份不得进公开目录 |

## 3. 交付物

| 文件 | 作用 |
| --- | --- |
| `DOCKER_PLAN.md` | 本文件：执行契约与计划 |
| `Dockerfile` | 两阶段构建：Node 构建 → nginx 提供静态产物 |
| `.dockerignore` | 收窄构建上下文，排除依赖、产物、资料与文档 |
| `deploy/nginx.conf` | 路由、缓存、压缩、安全响应头 |
| `docker-compose.yml` | 同事可用的单命令启动入口 |
| `docs/DOCKER.md` | 面向部署者的操作手册（前置条件、命令、验证、排错、安全提醒） |
| `README.md`（改） | 「靜態部署」小节加一行指向 `docs/DOCKER.md` |
| `INDEX.md`（改） | 仓库地图登记新增文件，保持索引与目录一致 |

## 4. 验收标准（逐条可判定）

- [ ] A1 镜像分两阶段，最终阶段**不含** `node_modules`、源码、测试、`.git`、`samples/`、`docs/`
- [ ] A2 构建阶段与 [README.md](README.md)「靜態部署」记录的配方一致：`npm ci` → `npm run demo:generate` → `npm run build`
- [ ] A3 最终镜像能提供 `/`（HTML）、`/assets/*`（哈希产物）、`/demo/*.xlsx`（演示工作簿）三类资源
- [ ] A4 缺失的 `/assets/*`、`/demo/*` 返回 **404**，不得回落成 200 HTML；页面导航路径才回落 `index.html`
- [ ] A5 `/assets/*` 长缓存（immutable），入口文档与演示工作簿不长期缓存
- [ ] A6 容器自带 HEALTHCHECK，无需额外安装 `curl`
- [ ] A7 基础镜像 tag 逐个核对**真实存在**（不写臆想的 tag）
- [ ] A8 不改动 `src/`、`scripts/`、既有测试；`typecheck` / `test` / `lint` 结果与基线**逐字一致**
- [ ] A9 `docs/DOCKER.md` 写明：根路径部署约束、地图需外网、localStorage 不共享、不得录入真实居民资料

## 5. 技术决定与理由

| 决定 | 选择 | 理由 / 被否决的选项 |
| --- | --- | --- |
| 构建阶段镜像 | `node:24.15.0-slim`（Debian） | 与 README 实测的 Node **v24.15.0** 对齐。**否决 `-alpine`**：rollup / esbuild 等原生依赖在 glibc 下有预编译包，musl 多一类失败模式，而构建阶段不进最终镜像、体积无所谓 |
| 运行阶段镜像 | `nginx:1.29-alpine` | 官方镜像，`conf.d/default.conf` 挂载点稳定，自带 busybox `wget` 可做探针。**否决 `nginx-unprivileged`**：本机无容器运行时，无法 build 验证，选最主流的路径降低「改不动的错」风险 |
| 服务端口 | 容器内固定 80 | 宿主机端口靠 `-p` / `WEB_PORT` 映射解决，不在容器内做模板替换。**否决 envsubst 模板**：多一个模板文件与替换语义，收益为零 |
| 是否在镜像内跑 `demo:generate` | 跑 | 与 README 配方一致。**已验证确定性**：本机跑完 `git status` 为空，输出与入库副本逐字节一致；它只重写英文演示簿，不碰手造的 `careflow-paper-excel-mock.xlsx` |
| `xlsx` 的 Content-Type 覆写 | 不做 | 应用用 `fetch(...).arrayBuffer()` 读取（[App.tsx](src/app/App.tsx#L117)），类型头不影响行为；而 `types` 指令写错会让 nginx 直接起不来，不值得冒险 |
| `listen [::]:80` | 不写 | 容器 IPv6 被禁用时 `bind [::]:80` 会失败导致容器起不来；只留 IPv4 |
| CSP | 不启用 | MapLibre 需要 `worker-src blob:` 且要连底图域名，写错会静默白屏地图。改为在 `docs/DOCKER.md` 记录为可选加固项 |
| 镜像 tag | `careflow-atlas:0.1.0` | 与 `package.json` 的 `version` 对齐，便于「镜像版本 ↔ 代码版本」对账 |

## 6. 阶段划分

| 阶段 | 内容 | 产出 |
| --- | --- | --- |
| P0 | 基线：`typecheck` / `test` / `lint` + 记录 HEAD 与工作树状态 | 基线证据（本文件第 9 节） |
| P1 | 本契约与计划 | `DOCKER_PLAN.md` |
| P2 | 容器定义：`Dockerfile`、`.dockerignore`、`deploy/nginx.conf` | 可构建的定义 |
| P3 | 编排与文档：`docker-compose.yml`、`docs/DOCKER.md`、README/INDEX 登记 | 同事可读的手册 |
| P4 | 验证（见第 7 节） | 验证输出 |
| P5 | 回执：按 [CLAUDE.md](CLAUDE.md) 第 4 节格式汇报 | 结论／改动清单／验证／遗留／备注 |

## 7. 验证方法与判定

**本机可执行的（本次已全部执行）**

| 编号 | 命令 | 判定 |
| --- | --- | --- |
| V1 | `npm run demo:generate && npm run build` | 与镜像构建阶段同一配方，退出码 0，`dist/` 生成 `index.html`、`assets/`、`demo/` |
| V2 | 本地静态服务器复刻 nginx 路由表 + `curl` | `/` 200 HTML；`/demo/*.xlsx` 200 且字节数与 `public/demo/` 一致；`/assets/<真实文件>` 200；`/assets/<不存在>` **404**；未知深链回落 200 HTML |
| V3 | `npm run typecheck` / `npm test` / `npm run lint` | 与 P0 基线逐字一致 |
| V4 | Docker Hub tags API 逐个 HEAD | 所有引用的基础镜像 tag 返回 200 |

**本机无法执行的（如实声明，不假装通过）**

- `docker build` / `docker run` / `nginx -t`：**本机没有 docker、podman、colima、nerdctl，也没有本地 nginx**，无法执行。
- 缓解措施：nginx 配置刻意只用最主流写法的指令；不写 `types` 覆写、不写 IPv6 监听、不用 envsubst；并给出同事在 VPS 上一条命令自检的方法（见 `docs/DOCKER.md`）。
- 需由同事在 Docker 宿主机上补跑并回帖输出：`docker compose build` → `docker compose up -d` → `curl -I` 三条路由 → `docker inspect --format '{{.State.Health.Status}}'`。

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 应用用根相对路径 `fetch('/demo/...')`，**放在子目录会取不到演示工作簿** | `docs/DOCKER.md` 写明必须由域名或端口的根路径提供；不在本次改应用代码去支持 base path |
| 部署即公开：镜像无认证，任何人可访问这个演示 | `docs/DOCKER.md` 给出反代 + Basic Auth / IP 白名单的可选片段，并明确它**不是**项目要求的登录能力 |
| 同事误以为「上容器＝多人共用一份数据」 | `docs/DOCKER.md` 与回执都写明：数据仍在各浏览器 `localStorage`，容器不提供共享与持久化 |
| 构建期需外网（`xlsx` 依赖指向 SheetJS CDN tarball） | `docs/DOCKER.md` 前置条件写明；构建失败时的报错特征一并列出 |
| 地图底图空白 | 底图请求由**访问者浏览器**直连 OpenFreeMap，需客户端能联外网；`VITE_MAP_STYLE_URL` 是构建期烘进 bundle 的，改它要重建镜像 |

## 9. 回滚

本次改动**只新增**容器与文档文件，不改任何源码、测试与既有脚本。

```bash
git clean -n            # 先看将删除什么
git clean -f Dockerfile .dockerignore docker-compose.yml DOCKER_PLAN.md docs/DOCKER.md
rm -rf deploy
git checkout -- README.md INDEX.md
```

回滚后 `npm run typecheck && npm test && npm run lint` 应与基线一致（因为本次根本没动被测代码）。

## 10. 遗留问题（需 DSH／用户决策）

1. **D5（部署与数据库）闸门未关闭**：本容器只解决「静态前端怎么上线」，**不等于** D5 决策，也不能替代第一次真实数据库迁移前必须选定的部署与数据库路径（[CLAUDE.md](CLAUDE.md) 第 5 节）。
2. **构建未在容器运行时验证**：本机无 Docker。要么由同事在 VPS 上跑一次并回帖输出，要么允许我在本机装 lima/colima（约 GB 级、会改动本机环境，需你点头）后再补 `docker build` + `docker run` 冒烟。
3. **HTTPS 未包含**：证书与 443 由宿主机反代（nginx / Caddy）负责，不在镜像内做。
4. **是否要把演示工作簿留在镜像里**：目前 `public/demo/*.xlsx` 是合成演示资料，随镜像分发。若日后要让这个部署「只跑正式模式」，需要另开一次任务把演示资产从构建中剔除——本次不做。

## 11. 执行回执（P5）

**结论：成功** —— 交付物全部落地，本机可执行的验证项全部通过。**镜像本身未在真实 Docker 上构建过**（本机无容器运行时），这一点在 `docs/DOCKER.md` 第 10 节已向部署者如实声明。

### 改动清单

| 文件 | 说明 |
| --- | --- |
| `Dockerfile` | 新增。两阶段：`node:24.15.0-slim` 构建 → `nginx:1.29-alpine` 提供 `dist/` |
| `.dockerignore` | 新增。排除依赖、产物、`.git`、资料、文档，收窄构建上下文 |
| `deploy/nginx.conf` | 新增。路由（`/assets/`、`/demo/` 用 `=404` 兜底，其余回落 `index.html`）、缓存分层、gzip、安全响应头 |
| `docker-compose.yml` | 新增。同事单命令启动；`WEB_PORT`、`VITE_MAP_STYLE_URL` 两个旋钮 |
| `docs/DOCKER.md` | 新增。部署手册（前置条件、命令、验证、反代、访问限制、排错、验证记录）。**放在 `docs/` 而非根目录**，遵守 INDEX.md「根目录只放配置/文档/目录」的约定 |
| `deploy/verify.sh` | 新增。部署自检脚本，把上面这份清单变成可重跑的断言（31 项，退出码可接 CI） |
| `deploy/verify-browser.mjs` | 新增。浏览器端到端检查（可选，需自行装 playwright），覆盖 shell 够不着的「应用是否真的能跑」 |
| `deploy/nginx-site.conf.example` | 新增。宿主机反代样例（HTTPS / certbot / Basic Auth / IP 白名单） |
| `DOCKER_PLAN.md` | 新增。本文件 |
| [README.md](README.md) | 改。`靜態部署` 小节加一段指向 `docs/DOCKER.md`（+2 行） |
| [INDEX.md](INDEX.md) | 改。顶层树登记 5 个新条目、`docs/` 表加一行、修正根目录约定表述（+10/-2 行） |

**未改动**：`src/`、`scripts/`、`public/`、全部测试与既有脚本，一行都没动。

### 验证

| 编号 | 命令 | 结果 |
| --- | --- | --- |
| V1 | `npm run demo:generate && npm run build` | ✅ 退出码 0；`dist/` = `index.html` + 8 个哈希产物 + 3 个 `.xlsx`；三份工作簿字节数与 `public/demo/` **逐一相符**（33470 / 26019 / 74805） |
| V2 | 等价路由表 + `curl`（9 条断言） | ✅ `/` 200 HTML 且含 `id="root"`；`/assets/<真实>` 200 + `immutable` 长缓存；**`/assets/nope.js` 404（不是 200 HTML）**；三份 `/demo/*.xlsx` 200 + `no-cache`；`/demo/typo.xlsx` 404；深链回落 200 HTML |
| V3 | `npm run typecheck` / `npm test` / `npm run lint` | ✅ 与 P0 基线逐字一致：typecheck 通过、**14 文件 / 91 用例通过**、lint 干净 |
| V4 | Docker Hub tags API | ✅ `node:24.15.0-slim`、`nginx:1.29-alpine` 均返回 200（不写臆想的 tag） |
| V5 | 构建期注入实测 | ✅ `VITE_MAP_STYLE_URL=https://example.org/style.json npm run build` → 该地址出现在 `dist/assets/MapScene-*.js`；再普通构建 → 恢复默认 OpenFreeMap，无残留。**证明 `--build-arg` 这条链路真的通** |
| V6 | `js-yaml` 解析 `docker-compose.yml` | ✅ 结构与插值语法正确（`${WEB_PORT:-8080}:80` 等） |

### 第二轮：真实 Docker 上的复验（2026-09-23）

首次汇报时本机没有容器运行时，全部容器相关结论都只是「由构造保证」。装好 colima 后已在真实 Docker（29.5.2 / Compose 5.5.1，arm64）上把清单实跑完。

| 清单项 | 结果 |
| --- | --- |
| `docker images` 能看到镜像、大小合理 | ✅ `careflow-atlas:0.1.0` **26.6MB**（nginx alpine + 产物 2.33MB） |
| `docker run` 后 `docker ps` 为 Up | ✅ `Up ... (healthy)` |
| `docker logs` 无报错 | ✅ 无 error/emerg/alert/crit/warn |
| `curl` 接口正常返回 | ✅ 全部路由断言通过（见 `docs/DOCKER.md` 第 10 节） |
| 浏览器手动点过核心功能 | ✅ 用 Chromium 端到端跑通，**15/15** |
| 换端口 `-p 4000:3000` | ⚠️ 容器内是 **80** 不是 3000，按 `-p 4000:80` 实跑通过（19090 / 18081 两个端口均验） |
| 删容器重建后功能一致 | ✅ |
| `docker save` → `rmi` → `load` | ✅ 25M 归档往返后仍能跑 |
| 环境变量能传进去 | ✅ 拆成两件事验证：`VITE_MAP_STYLE_URL` 经 build args **确实烘进产物**且默认值被替换；`WEB_PORT` 经 compose 插值生效 |
| 重启容器数据不丢 | ⚠️ **命题不适用**：本应用无服务端数据，数据在访问者 `localStorage`。已验容器内无可变业务数据，并以 stop/start/restart 后功能一致替代 |
| `stop`/`start`/`restart` 行为正常 | ✅ |
| `docker compose up -d --build` | ✅ 含两个变量的覆盖路径 |

### 实跑暴露的一个真缺陷（已修）

`/assets/` 的 **404 响应也带了 `Cache-Control: ... immutable`** —— `add_header ... always` 对错误响应同样生效，会让浏览器/CDN 把一次取错的 404 钉死一年。该条缓存头已改为不带 `always`（安全头保留 `always`）。

> 这个缺陷**只有真跑起来看真实响应头才会暴露**；此前用等价路由表模拟时，我自建的检查脚本对 404 也套用了同一套头，等于把 bug 复制进了检查里，所以模拟环境显示「通过」。这正是「本机验证不能替代真跑」的实例。

### 仍未覆盖（不假装通过）

- **`nginx -t` 未单独执行**：容器正常启动并服务全部路由，但没跑过独立语法预检。
- **未在 x86/amd64 VPS 上实跑**：以上全部在 Apple Silicon arm64 上完成。两个基础镜像均为多架构，但**建议在你那台 VPS 上跑一次 `bash deploy/verify.sh`** 作为最后一关。
- **`adb`/真实反代路径未验**：`deploy/nginx-site.conf.example` 是样例，没有在真实域名 + certbot 下限跑过。

### 遗留问题

1. **建议由部署者在 VPS 上跑一次首次构建并回帖输出**（`docker compose build` / `ps` / `logs` / `inspect Health.Status`），据此回填并删掉 `docs/DOCKER.md` 第 10 节的「已知未验证项」。
2. 若希望我在本机把「构建 + 启动 + 冒烟」也补齐，需要先装 lima/colima 之类的容器运行时（GB 级、会改动本机环境），**需要你明确同意**后才做。
3. **D5 闸门仍未关闭**：本容器只回答「静态前端怎么上线」，不等于 D5 的部署与数据库决策，也不能替代第一次真实数据库迁移前必须选定的路径。
4. HTTPS / 证书 / 443 由宿主机反代负责，不在镜像内。
5. `docs/DOCKER.md` 给的 Basic Auth / IP 白名单只是**临时挡路人**的手段，不是项目要求的登录、会话与审计能力。

### 备注

- **翻页/穷尽**：本次不涉及分页列表。基础镜像 tag 用 Docker Hub API 逐个核对，未凭记忆写版本号。
- **环境初始化**：本机复用既有 `node_modules` 与 Node v24.15.0；未新增任何依赖，镜像构建阶段会在容器内自行 `npm ci`。
- **踩到的缺陷**：`npm run demo:generate` 只重写 `careflow-field-outreach-demo.xlsx` 一份（`careflow-paper-excel-mock.xlsx` 是手造排版范本、无生成脚本；`careflow-district-demo.xlsx` 由另一个需 Codex runtime 的脚本生成）。这解释了为什么它能进镜像构建而不破坏手造范本。已实测其输出与入库副本逐字节一致。
- **一处刻意的偏离**：`docs/DOCKER.md` 没有放在根目录，而是进了 `docs/`，以遵守 [INDEX.md](INDEX.md) 第 1 节的根目录约定；`DOCKER_PLAN.md` 按你的要求留在根目录，并在 INDEX.md 中标注为「过程产物，收尾后应并入 `docs/`」。
