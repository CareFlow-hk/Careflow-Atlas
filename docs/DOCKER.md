# CareFlow Atlas · Docker 部署手册

> 面向**要在 VPS 上跑这个工作台的人**。项目定位见 [README.md](../README.md)，容器定义见 [Dockerfile](../Dockerfile)，路由与缓存规则见 [deploy/nginx.conf](../deploy/nginx.conf)，本次封装的契约与取舍见 [DOCKER_PLAN.md](../DOCKER_PLAN.md)。

## 1. 这个镜像是什么

把 `npm run build` 出来的静态产物装进 nginx 的**纯前端容器**：一个 HTTP 服务，一个页面。

**它不是什么**（这些不是「还没做」，是「按设计不做」）：

- 没有后端、没有数据库、没有迁移脚本，镜像里没有 Node。
- **没有登录、没有权限**。任何能访问这个端口的人都能打开并操作它。
- 业务数据**不在容器里**：整份 snapshot 存在**访问者自己浏览器**的 `localStorage`。换浏览器、换电脑、清缓存，数据都不一样；容器重启既不丢也不共享数据。所以**不需要数据卷**，也没有「服务端备份」这回事。
- 镜像内只有**合成演示资料**（`public/demo/*.xlsx`）。**绝对不要**把真实居民资料、正式导入文件或导出文件放进来。

## 2. 前置条件

- VPS 上已装 Docker Engine（建议 20.10+）与 Compose v2（`docker compose version` 能打印版本）。
- 构建时需要**外网**：`npm ci` 要从 `registry.npmjs.org` 取包，其中 `xlsx` 是指向 SheetJS CDN 的 tarball 依赖。构建机不通外网会停在 `npm ci`。
- 访问者的浏览器需要能联外网，否则地图底图（OpenFreeMap）不会显示——应用其余部分仍可用。

## 3. 部署

### 方式一：docker compose（推荐）

```bash
git clone <本仓库地址> careflow-atlas
cd careflow-atlas
docker compose up -d --build
```

默认打开宿主机 `http://127.0.0.1:8080`，远程访问通过反向代理。只为公开合成演示直接开放端口时，显式运行 `WEB_BIND=0.0.0.0 docker compose up -d --build`。

默认映射到宿主机 **8080**，因为 VPS 的 80/443 通常已经给了反代或其他站点。想换端口：

```bash
WEB_PORT=8081 docker compose up -d
```

想让它直接占 80（宿主机 80 空闲时）：

```bash
WEB_BIND=0.0.0.0 WEB_PORT=80 docker compose up -d
```

### 方式二：不用 compose

```bash
docker build -t careflow-atlas:0.1.0 .
docker run -d --name careflow-atlas -p 8080:80 --restart unless-stopped careflow-atlas:0.1.0
```

### 方式三：VPS 构建慢或没有外网 —— 在有网的机器上构建，搬运镜像

VPS 拉 `node_modules` 慢、或根本不给出外网时，别在 VPS 上构建，而是把**构建好的镜像**搬过去（镜像约几十 MB，比源码依赖小得多）：

```bash
# 在有网的机器上
docker compose build
docker save careflow-atlas:0.1.0 | gzip > careflow-atlas-0.1.0.tar.gz
scp careflow-atlas-0.1.0.tar.gz user@vps:/tmp/

# 在 VPS 上（只放容器定义，不需要源码，也不需要 Node）
gunzip -c /tmp/careflow-atlas-0.1.0.tar.gz | docker load
docker run -d --name careflow-atlas -p 8080:80 --restart unless-stopped careflow-atlas:0.1.0
```

注意：`VITE_MAP_STYLE_URL` 是**构建期**参数，搬运镜像这条路下它已经被烘进镜像了，到 VPS 上改环境变量不会生效，要改就得重新构建。

### 常用命令

```bash
docker compose logs -f web     # 看日志
docker compose ps              # 看状态与健康检查
docker compose down            # 停止并移除容器
```

## 4. 部署后请验证

### 一键自检（推荐先跑这个）

```bash
bash deploy/verify.sh
```

它会自己构建、启动、跑完全部自动检查项（镜像大小、Up 状态、日志无报错、各条路由的状态码与缓存头、健康检查、换端口、删容器重建、`stop`/`start`/`restart`、`save`→`rmi`→`load`、构建参数是否真的烘进产物），最后打印通过/失败汇总。它只碰自己创建的 `careflow-verify-*` 容器与镜像，跑完自动清理，**不会动你已经跑着的服务**。失败时退出码为 1，可以直接接进 CI。

跑完它还会提醒你 4 项脚本替代不了的人工确认（白屏、範例按钮、地图底图、localStorage 持久化）。

### 浏览器端到端（可选，想连「应用真的能跑」一起验时用）

```bash
npm i -D playwright && npx playwright install chromium   # 一次性，约 150MB
node deploy/verify-browser.mjs                           # 默认 http://127.0.0.1:8080
node deploy/verify-browser.mjs http://<你的域名>          # 也可直接打远端
```

上面那 4 项人工确认，这个脚本能自动做掉前 3 项。它用真实 Chromium 走一遍：开页 → 导入中文範本 → 解析 → 合并 → 写 `localStorage` → 刷新 → 检查地图画布与底图瓦片 → 扫控制台报错。**故意不放进 `package.json`**，免得所有人平白多装一个浏览器。地图那项在连不上 OpenFreeMap 的网络里会标成「存疑」而不是「失败」。

### 手动逐条验证

```bash
# 1) 健康检查应为 healthy（容器启动后约 10 秒再查）
docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q web)

# 2) 三条路由的状态码（资源路径从首页 HTML 里取，不需要本地有 dist/）
curl -s -o /dev/null -w 'index   %{http_code}\n' http://127.0.0.1:8080/
ASSET=$(curl -s http://127.0.0.1:8080/ | grep -o '/assets/[^"]*\.js' | head -1)
curl -s -o /dev/null -w 'asset   %{http_code}\n' "http://127.0.0.1:8080$ASSET"
curl -s -o /dev/null -w 'demo    %{http_code}\n' http://127.0.0.1:8080/demo/careflow-paper-excel-mock.xlsx

# 3) 缺失资源必须是 404，不能是 200（回落成 HTML 会掩盖打包问题）
curl -s -o /dev/null -w 'missing %{http_code}\n' http://127.0.0.1:8080/assets/nope.js
```

浏览器里还应确认：

1. 页面正常打开，不是白屏；
2. **紙本與 Excel → 檢視 mock 範例** 能载入中文工作簿（这一步验证 `/demo/` 路由通了）；
3. 地图有底图（验证访问者侧能连 OpenFreeMap）。

## 5. 配置项

| 变量 | 何时生效 | 说明 |
| --- | --- | --- |
| `WEB_PORT` | 启动时 | 宿主机端口，默认 `8080` |
| `VITE_MAP_STYLE_URL` | **构建时** | 底图样式地址，默认 `https://tiles.openfreemap.org/styles/positron`。`VITE_` 变量会进浏览器 bundle，**不要放密码**。改了必须重建镜像才生效 |

两者都可以写在仓库根目录的 `.env` 里（该文件已被 git 忽略，不要提交）：

```bash
WEB_PORT=8080
VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/positron
```

## 6. 放在 HTTPS 反代后面

镜像只监听 HTTP 80。证书与 443 交给宿主机的 nginx / Caddy，反代到 `127.0.0.1:8080` 即可。

**可以直接复制的完整配置**在 [deploy/nginx-site.conf.example](../deploy/nginx-site.conf.example)：含 HTTP→HTTPS 跳转、certbot 证书路径、访问限制（Basic Auth 与 IP 白名单两套，注释掉的，按需打开）。

```bash
cp deploy/nginx-site.conf.example /etc/nginx/sites-available/careflow-atlas.conf
# 改掉里面的 example.org / 端口 / 路径，然后：
ln -s /etc/nginx/sites-available/careflow-atlas.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

**必须由根路径提供**：应用用根相对路径 `fetch('/demo/...')` 取演示工作簿（见 [src/app/App.tsx](../src/app/App.tsx#L117)），所以请给它一个独立域名或独立端口，**不要挂在 `https://example.org/careflow/` 这样的子目录下**，否则那两个範例按钮会失败。

## 7. 更新与回滚

```bash
git pull
docker compose up -d --build     # 重建并滚动替换

# 回滚到上一个镜像（前提是构建时打过不同 tag）
docker compose down
docker run -d --name careflow-atlas -p 8080:80 careflow-atlas:<旧tag>
```

镜像 tag 与 `package.json` 的 `version` 对齐（当前 `0.1.0`）。版本号变了请同步改 [docker-compose.yml](../docker-compose.yml) 里的 `image:`，否则新构建会覆盖旧 tag。

## 8. 公开暴露之前请先想清楚

这个镜像**没有任何认证**。放到公网等于把一个演示工作台给所有人看。在对外之前至少做一层限制：

**Basic Auth（反代层，最省事）**

```bash
# 生成口令文件（用户名 careflow）
docker run --rm httpd:2.4-alpine htpasswd -nbB careflow '换成你的口令' > /etc/nginx/.htpasswd
```

```nginx
location / {
    auth_basic           "CareFlow Atlas";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:8080;
}
```

**或只允许特定来源**

```nginx
location / {
    allow 203.0.113.0/24;   # 机构出口 IP
    deny  all;
    proxy_pass http://127.0.0.1:8080;
}
```

使用访问限制时保留默认 `WEB_BIND=127.0.0.1`，否则公开的容器端口可绕过反向代理认证。

两点必须说清楚：

1. Basic Auth 在**没有 HTTPS 的情况下口令是明文传输的**，只适合临时挡一下搜索引擎和路人。
2. 它**不是**项目要求的那套登录／会话／审计能力。正式系统的认证属于后端计划的范围，见 [BACKEND_GAP_ANALYSIS.md](../BACKEND_GAP_ANALYSIS.md)。

## 9. 排错

| 现象 | 原因与处理 |
| --- | --- |
| 构建停在 `npm ci`，报网络或 404 | 构建机不通外网，或取不到 SheetJS CDN 的 `xlsx` tarball。换能出网的构建机，或改用内网镜像源 |
| 容器起不来，日志里有 `bind() to 0.0.0.0:80 failed` | 宿主机 80 被占用。用 `WEB_PORT=8081` 换端口 |
| 打开是 404 / 空页 | 看 `curl -I http://127.0.0.1:8080/assets/...`。若 `/assets/` 404，说明反代把请求指到了别处 |
| 打开是 nginx 欢迎页 | 反代指向了别的 web 根目录，不是这个容器 |
| 範例按钮报「未能載入示範資料」 | `/demo/*.xlsx` 取不到。确认没挂在子目录下（见第 6 节），并 `curl` 一下 `/demo/` 路径 |
| 地图一片空白 | 访问者浏览器连不上 `tiles.openfreemap.org`；或构建时 `VITE_MAP_STYLE_URL` 填了个错的地址（需重建镜像） |
| 换了台电脑，数据不见了 | 正常：数据在原来那台浏览器的 `localStorage` 里，不在容器里 |

## 10. 验证记录

2026-09-26 审查版本已重新验证；当前结果见 [VALIDATION.md](VALIDATION.md)。下面保留 2026-09-23 的历史记录，不代表本次审查重新验证了其中每项。

这套容器定义已在真实 Docker 上实跑过（2026-09-23，Docker 29.5.2 / Compose 5.5.1，Apple Silicon 上的 colima）。结论：**下面这些全部实跑通过**。

| 项目 | 结果 |
| --- | --- |
| `docker build` | 通过，产出 `careflow-atlas:0.1.0`，**26.6MB**（nginx alpine + 静态产物 2.33MB） |
| 镜像内容 | 无 `node`、无 `/app`、web root 只有静态产物 —— 多阶段与 `.dockerignore` 都生效 |
| `docker run` / `docker ps` | `Up ... (healthy)`，健康检查确实转到 `healthy` |
| `docker logs` | 无 `error` / `emerg` / `alert` / `crit` / `warn` |
| HTTP 路由 | 见下方「路由断言」 |
| 换端口 | 映射到宿主机 19090 / 18081 均可访问；此时容器内仍是 80 |
| 删容器重建 | 功能一致 |
| `stop` / `start` / `restart` | 状态与行为均正常 |
| `save` → `rmi` → `load` | 25M 归档导出、移除、导入后仍能正常跑 |
| `docker compose` | `up -d --build` 成功；`WEB_PORT` 与 `VITE_MAP_STYLE_URL` 两个变量均验证生效（后者确实烘进产物，且默认地址被替换） |
| 浏览器端到端 | 见下方「浏览器端到端」 |

**路由断言**（对运行中的容器 `curl`）：`/` 200；`/assets/<真实>` 200 且 `immutable`；`/demo/*.xlsx` 三份均 200、字节数与仓库逐一相符；缺失的 `/assets/nope.js`、`/demo/nope.xlsx` 均 **404**；深链回落 200 HTML；`/assets/` 的 **404 不带长期缓存**。

**浏览器端到端**（真实 Chromium 走一遍）：开页 → 打开「紙本與 Excel」→「檢視 mock 範例」→ 解析出 `大廈 4 / 個人 2 / 單位 36 / 觀察 28` → 确认合并 → `localStorage` 写入 → 刷新后数据仍在 → MapLibre 画布 1134×742、WebGL 正常、OpenFreeMap 瓦片已取 → 无页面异常、控制台无 error。**15 项全通过。**

### 实跑中发现并修掉的一个真缺陷

首轮实跑发现：`/assets/` 的 404 响应也带着 `Cache-Control: public, max-age=31536000, immutable`。原因是 `add_header ... always` 对错误响应同样生效，会让浏览器或 CDN 把一次取错的 404 钉死一年。已改为该条缓存头**不带 `always`**（只作用于 2xx/3xx），安全响应头保留 `always` 以便 404 也有 `nosniff`。

> 这个缺陷在只有静态检查、没有真实运行环境时**看不出来**——它需要看到真实响应头才会暴露。

### 仍未覆盖的

- **`nginx -t` 未单独执行**：容器能正常启动并服务全部路由，等价于配置被 nginx 接受，但没跑过独立的语法预检。
- **未在 x86/amd64 VPS 上实跑**：以上全部在 Apple Silicon 的 arm64 上完成。镜像用到的两个基础镜像都是多架构的，但「在你那台 VPS 上跑一次」仍是必要的最后一步 —— 跑 `bash deploy/verify.sh` 即可。

## 11. 回归工具

`bash deploy/verify.sh` 使用每次运行独有的容器和镜像名称，仅绑定回环端口；清理覆盖本次构建参数镜像和日志，避免误删另一轮测试资源。

浏览器检查可独立执行：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node deploy/verify-browser.mjs http://127.0.0.1:8080
```

检查使用隔离浏览器上下文，不读取个人浏览器。覆盖映射变更阻止旧数据写入、中文和英文导入、街区合并、观察追加、刷新持久化、下载和地图不可达时的降级。底图必须收到成功瓦片响应才能标记已验证，单有请求不算成功。
