#!/usr/bin/env bash
# CareFlow Atlas —— 容器部署自检脚本。
#
# 在**装有 Docker 的机器**上跑（VPS 或本地），逐项验证部署清单：
#
#   bash deploy/verify.sh
#
# 它只碰自己创建的容器/镜像/临时目录，名字都带 careflow-verify- 前缀，
# 跑完自动清理，不会动你正在跑的服务。
#
# 说明：本脚本无法替代「浏览器里手点一遍核心功能」——那一项会明确标成
# MANUAL，需要你自己在浏览器里确认。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/careflow-verify-XXXXXXXX")" || exit 1
RUN_ID="${RUN_DIR##*/}"
IMAGE="careflow-verify:${RUN_ID}"
CONTAINER="$RUN_ID"
PORT="${VERIFY_PORT:-18080}"
ALT_PORT="${VERIFY_ALT_PORT:-18081}"
TARBALL="$RUN_DIR/image.tar"
PASS=0
FAIL=0
declare -a RESULTS

# ---------- 小工具 ----------
c_ok()   { printf '\033[32m%s\033[0m' "$1"; }
c_bad()  { printf '\033[31m%s\033[0m' "$1"; }
c_warn() { printf '\033[33m%s\033[0m' "$1"; }

# 记录一项结果：check <描述> <0=通过>
check() {
  local desc="$1" rc="$2"
  if [ "$rc" -eq 0 ]; then
    RESULTS+=("PASS  $desc"); PASS=$((PASS + 1))
    printf '  [%s] %s\n' "$(c_ok '通过')" "$desc"
  else
    RESULTS+=("FAIL  $desc"); FAIL=$((FAIL + 1))
    printf '  [%s] %s\n' "$(c_bad '失败')" "$desc"
  fi
}

skip() {
  RESULTS+=("SKIP  $1"); printf '  [%s] %s\n' "$(c_warn '跳过')" "$1"
}

manual() {
  RESULTS+=("MANUAL  $1"); printf '  [%s] %s\n' "$(c_warn '需人工')" "$1"
}

section() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "${CONTAINER}-alt" >/dev/null 2>&1 || true
  docker rmi -f "$IMAGE" >/dev/null 2>&1 || true
  docker rmi -f "${IMAGE}-arg" >/dev/null 2>&1 || true
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT

# 等容器就绪（最多 30 秒），避免 curl 撞上启动窗口
wait_ready() {
  local url="$1" i
  for i in $(seq 1 30); do
    curl -fsS -o /dev/null "$url" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

code_of() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

# ---------- 0. 前置检查 ----------
section "0. 前置检查"
if ! command -v docker >/dev/null 2>&1; then
  echo "  找不到 docker 命令。请先安装 Docker Engine 与 Compose 后重跑。"; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "  docker 命令在，但守护进程不可达（docker info 失败）。"; exit 1
fi
printf '  docker: %s\n' "$(docker --version)"
printf '  仓库根: %s\n' "$REPO_ROOT"

# ---------- 1. 构建与镜像 ----------
section "1. 构建镜像 / docker images"
if docker build -t "$IMAGE" . >"$RUN_DIR/build.log" 2>&1; then
  check "docker build 成功" 0
else
  check "docker build 成功" 1
  echo "    构建失败，日志尾部："; tail -25 "$RUN_DIR/build.log" | sed 's/^/    /'
  printf '\n构建都没过，后面的项目无法继续。\n'; exit 1
fi

IMG_SIZE_BYTES="$(docker image inspect "$IMAGE" --format '{{.Size}}' 2>/dev/null || echo 0)"
IMG_SIZE_MB=$((IMG_SIZE_BYTES / 1024 / 1024))
printf '  镜像大小: %s MB\n' "$IMG_SIZE_MB"
# nginx:alpine 基础约 50MB，加静态产物。超过 200MB 说明有东西不该进来（比如 node_modules）。
if [ "$IMG_SIZE_MB" -gt 0 ] && [ "$IMG_SIZE_MB" -lt 200 ]; then
  check "镜像大小合理（< 200MB，实测 ${IMG_SIZE_MB}MB）" 0
else
  check "镜像大小合理（实测 ${IMG_SIZE_MB}MB，预期 < 200MB）" 1
fi

# 最终镜像不该包含构建期的东西。
# 注意：不能只看退出码——容器起不来时退出码也是非 0，那会被误判成「通过」。
ROOTLS="$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls -1 /' 2>/dev/null)"
if [ -z "$ROOTLS" ]; then
  check "最终镜像不含源码/依赖目录（容器无法启动，无法判定）" 1
else
  LEAK=""
  printf '%s\n' "$ROOTLS" | grep -qx 'app' && LEAK="app"
  docker run --rm --entrypoint sh "$IMAGE" -c 'ls -1 /usr/share/nginx/html' 2>/dev/null \
    | grep -qx 'node_modules' && LEAK="$LEAK node_modules"
  [ -z "$LEAK" ] && check "最终镜像不含源码/依赖目录" 0 || check "最终镜像含不该有的目录：$LEAK" 1
fi

if docker run --rm "$IMAGE" nginx -t >"$RUN_DIR/nginx.log" 2>&1; then
  check "nginx -t 配置预检" 0
else
  check "nginx -t 配置预检" 1
  cat "$RUN_DIR/nginx.log"
fi

# ---------- 2. 启动、状态、日志 ----------
section "2. 启动容器 / Up 状态 / 日志"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
if docker run -d --name "$CONTAINER" -p "127.0.0.1:${PORT}:80" "$IMAGE" >/dev/null 2>&1; then
  check "docker run 成功" 0
else
  check "docker run 成功" 1
fi

if wait_ready "http://127.0.0.1:${PORT}/"; then
  check "服务在 30 秒内就绪" 0
else
  check "服务在 30 秒内就绪" 1
fi

STATE="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing)"
printf '  docker ps 状态: %s\n' "$STATE"
[ "$STATE" = "running" ] && check "docker ps 状态为 Up/running" 0 || check "docker ps 状态为 Up/running" 1

# 日志里不该有 error/emerg/alert/crit
if docker logs "$CONTAINER" 2>&1 | grep -Eiq '\[(error|emerg|alert|crit)\]'; then
  ERRORS="$(docker logs "$CONTAINER" 2>&1 | grep -Ei '\[(error|emerg|alert|crit)\]' | head -5)"
  check "docker logs 无报错" 1
  echo "    日志片段："; printf '%s\n' "$ERRORS" | sed 's/^/    /'
else
  check "docker logs 无报错" 0
fi

# ---------- 3. HTTP 路由 ----------
section "3. curl 接口返回"
check "GET / 返回 200" "$([ "$(code_of "http://127.0.0.1:${PORT}/")" = "200" ] && echo 0 || echo 1)"

BODY="$(curl -s "http://127.0.0.1:${PORT}/")"
printf '%s' "$BODY" | grep -q 'id="root"' && check "首页含应用挂载点 id=\"root\"" 0 || check "首页含应用挂载点 id=\"root\"" 1

# 首页引用的每个 /assets/ 资源都应能取到（顺带验证入口与产物一致）
ASSETS="$(printf '%s' "$BODY" | grep -oE '/assets/[^"]+' | sort -u)"
if [ -n "$ASSETS" ]; then
  BAD_ASSET=""
  for a in $ASSETS; do
    [ "$(code_of "http://127.0.0.1:${PORT}${a}")" = "200" ] || BAD_ASSET="$BAD_ASSET $a"
  done
  if [ -z "$BAD_ASSET" ]; then
    check "首页引用的 $(printf '%s\n' "$ASSETS" | grep -c .) 个 /assets/ 资源全部 200" 0
  else
    check "首页引用的 /assets/ 资源全部 200（缺失:$BAD_ASSET）" 1
  fi
else
  check "首页引用了 /assets/ 资源" 1
fi

for f in careflow-paper-excel-mock.xlsx careflow-field-outreach-demo.xlsx careflow-district-demo.xlsx; do
  check "GET /demo/$f 返回 200" "$([ "$(code_of "http://127.0.0.1:${PORT}/demo/$f")" = "200" ] && echo 0 || echo 1)"
done

check "缺失资源 /assets/nope.js 返回 404（不得回落成 200 HTML）" \
  "$([ "$(code_of "http://127.0.0.1:${PORT}/assets/nope.js")" = "404" ] && echo 0 || echo 1)"
check "缺失工作簿 /demo/nope.xlsx 返回 404" \
  "$([ "$(code_of "http://127.0.0.1:${PORT}/demo/nope.xlsx")" = "404" ] && echo 0 || echo 1)"
check "深链回落 200 HTML（单页应用）" \
  "$([ "$(code_of "http://127.0.0.1:${PORT}/some/deep/link")" = "200" ] && echo 0 || echo 1)"

# 缓存头分层
CC_ASSET="$(curl -s -D - -o /dev/null "http://127.0.0.1:${PORT}${ASSETS%%$'\n'*}" 2>/dev/null | tr -d '\r' | grep -i '^cache-control' || true)"
printf '%s' "$CC_ASSET" | grep -q 'immutable' && check "/assets/ 带 immutable 长缓存" 0 || check "/assets/ 带 immutable 长缓存" 1

# 404 不该带长缓存：带 always 的 add_header 会把缺失资源的 404 也标成 immutable，
# 让浏览器/CDN 把一次取错钉死一年。
CC_404="$(curl -s -D - -o /dev/null "http://127.0.0.1:${PORT}/assets/nope.js" | tr -d '\r' | grep -i '^cache-control' || true)"
if printf '%s' "$CC_404" | grep -qE 'immutable|max-age=31536000'; then
  check "/assets/ 的 404 不带长期缓存（实测：$CC_404）" 1
else
  check "/assets/ 的 404 不带长期缓存" 0
fi
CC_DEMO="$(curl -s -D - -o /dev/null "http://127.0.0.1:${PORT}/demo/careflow-paper-excel-mock.xlsx" | tr -d '\r' | grep -i '^cache-control' || true)"
printf '%s' "$CC_DEMO" | grep -q 'no-cache' && check "/demo/ 不长期缓存" 0 || check "/demo/ 不长期缓存" 1

# 健康检查。HEALTHCHECK 有 start-period + interval，刚起来时还是 starting，
# 必须轮询等它变 healthy，否则会误报失败。
HC="none"
for _ in $(seq 1 45); do
  HC="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo none)"
  [ "$HC" = "healthy" ] && break
  sleep 1
done
printf '  HEALTHCHECK: %s\n' "$HC"
[ "$HC" = "healthy" ] && check "HEALTHCHECK 变为 healthy" 0 || check "HEALTHCHECK 变为 healthy（实测 '$HC'）" 1

# ---------- 4. 换端口 ----------
section "4. 换端口映射"
docker rm -f "${CONTAINER}-alt" >/dev/null 2>&1 || true
if docker run -d --name "${CONTAINER}-alt" -p "127.0.0.1:${ALT_PORT}:80" "$IMAGE" >/dev/null 2>&1 \
   && wait_ready "http://127.0.0.1:${ALT_PORT}/"; then
  check "映射到宿主机 ${ALT_PORT} 后仍可访问（容器内仍是 80）" 0
else
  check "映射到宿主机 ${ALT_PORT} 后仍可访问" 1
fi
docker rm -f "${CONTAINER}-alt" >/dev/null 2>&1 || true

# ---------- 5. 删除重建 ----------
section "5. 删容器重建后功能一致"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -p "127.0.0.1:${PORT}:80" "$IMAGE" >/dev/null 2>&1 || true
if wait_ready "http://127.0.0.1:${PORT}/" \
   && [ "$(code_of "http://127.0.0.1:${PORT}/demo/careflow-paper-excel-mock.xlsx")" = "200" ] \
   && printf '%s' "$(curl -s "http://127.0.0.1:${PORT}/")" | grep -q 'id="root"'; then
  check "删除容器后重建，首页与 /demo/ 行为一致" 0
else
  check "删除容器后重建，首页与 /demo/ 行为一致" 1
fi

# ---------- 6. stop / start / restart ----------
section "6. stop / start / restart"
docker stop "$CONTAINER" >/dev/null 2>&1
S="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null)"
[ "$S" = "exited" ] && check "docker stop 后状态为 exited" 0 || check "docker stop 后状态为 exited（实测 $S）" 1

docker start "$CONTAINER" >/dev/null 2>&1
if wait_ready "http://127.0.0.1:${PORT}/"; then
  check "docker start 后服务恢复" 0
else
  check "docker start 后服务恢复" 1
fi

docker restart "$CONTAINER" >/dev/null 2>&1
if wait_ready "http://127.0.0.1:${PORT}/" \
   && [ "$(code_of "http://127.0.0.1:${PORT}/demo/careflow-district-demo.xlsx")" = "200" ]; then
  check "docker restart 后服务恢复且功能一致" 0
else
  check "docker restart 后服务恢复且功能一致" 1
fi

# ---------- 7. save / rmi / load ----------
section "7. save → rmi → load"
if docker save "$IMAGE" -o "$TARBALL" 2>/dev/null && [ -s "$TARBALL" ]; then
  check "docker save 导出镜像（$(du -h "$TARBALL" | cut -f1)）" 0
else
  check "docker save 导出镜像" 1
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker rmi -f "$IMAGE" >/dev/null 2>&1 || true
docker image inspect "$IMAGE" >/dev/null 2>&1 \
  && check "docker rmi 后镜像已移除" 1 || check "docker rmi 后镜像已移除" 0

if docker load -i "$TARBALL" >/dev/null 2>&1; then
  check "docker load 重新导入镜像" 0
else
  check "docker load 重新导入镜像" 1
fi

if docker run -d --name "$CONTAINER" -p "127.0.0.1:${PORT}:80" "$IMAGE" >/dev/null 2>&1 \
   && wait_ready "http://127.0.0.1:${PORT}/" \
   && [ "$(code_of "http://127.0.0.1:${PORT}/demo/careflow-field-outreach-demo.xlsx")" = "200" ]; then
  check "load 回来的镜像仍能正常跑" 0
else
  check "load 回来的镜像仍能正常跑" 1
fi

# ---------- 8. 构建参数 ----------
section "8. 环境变量 / 构建参数"
# VITE_MAP_STYLE_URL 是**构建期**参数：改了必须重建镜像才生效。
# 这里用仓库里的真实源码重新构建一个带标记的镜像来验证这条链路。
MARK="https://verify.invalid/style.json"
if docker build --build-arg "VITE_MAP_STYLE_URL=${MARK}" -t "${IMAGE}-arg" . >"$RUN_DIR/arg.log" 2>&1; then
  if docker run --rm --entrypoint sh "${IMAGE}-arg" -c "grep -rq 'verify.invalid' /usr/share/nginx/html/assets/" 2>/dev/null; then
    check "构建参数 VITE_MAP_STYLE_URL 确实烘进了产物" 0
  else
    check "构建参数 VITE_MAP_STYLE_URL 确实烘进了产物" 1
  fi
else
  check "带 --build-arg 重新构建" 1
  tail -15 "$RUN_DIR/arg.log" | sed 's/^/    /'
fi
docker rmi -f "${IMAGE}-arg" >/dev/null 2>&1 || true

# WEB_PORT 由 compose 在宿主机侧消费，不是注入容器的运行时变量。
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  WP="$(WEB_PORT=19090 docker compose config 2>/dev/null | grep -A2 'published' | grep -oE '[0-9]+' | head -1)"
  if [ "$WP" = "19090" ]; then
    check "compose 变量 WEB_PORT 生效（解析出 published=19090）" 0
  else
    check "compose 变量 WEB_PORT 生效（实测解析出 '${WP:-空}'）" 1
  fi
else
  skip "compose 变量 WEB_PORT（本机无 docker compose）"
fi

# ---------- 9. 数据 ----------
section "9. 重启后数据"
# 这个应用**没有服务端数据**：业务记录存在访问者浏览器的 localStorage，
# 容器内没有任何可变状态。所以「重启数据不丢」在这里是个空命题；
# 真正要验的是「重启后功能一致」，已在上面的 stop/start/restart 覆盖。
skip "重启容器数据不丢 —— 本应用无服务端数据（数据在浏览器 localStorage），此命题不适用"
# 同理不能只看退出码：容器起不来也会让 grep 落空，那会被误判成「通过」。
WEBROOT="$(docker run --rm --entrypoint sh "$IMAGE" -c 'ls -1 /usr/share/nginx/html' 2>/dev/null)"
if [ -z "$WEBROOT" ]; then
  check "容器内无可变业务数据（无法读取 web root，不能判定）" 1
elif printf '%s\n' "$WEBROOT" | grep -qE 'snapshot|localStorage|\.db$'; then
  check "容器内无可变业务数据" 1
else
  check "容器内无可变业务数据（只有静态产物：$(printf '%s' "$WEBROOT" | tr '\n' ' ')）" 0
fi

# ---------- 10. 人工项 ----------
if [ "${VERIFY_BROWSER:-0}" = "1" ]; then
  if node deploy/verify-browser.mjs "http://127.0.0.1:${PORT}" >"$RUN_DIR/browser.log" 2>&1; then
    check "容器内静态产物通过浏览器回归" 0
  else
    check "容器内静态产物通过浏览器回归" 1
  fi
  cat "$RUN_DIR/browser.log"
else
  manual "浏览器核心流程：可安装 Playwright 后设置 VERIFY_BROWSER=1 自动验证"
fi

# ---------- 汇总 ----------
section "汇总"
printf '%s\n' "${RESULTS[@]}" | sed 's/^/  /'
printf '\n  通过 %d 项，失败 %d 项。\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s\n' "$(c_bad '存在失败项，请先处理再交付。')"
  exit 1
fi
printf '  %s\n' "$(c_ok '自动项全部通过。')"
cat <<'EOF'

  浏览器核心流程清单（未设置 VERIFY_BROWSER=1 时需另行验证）：
    1. 页面正常打开，不是白屏，控制台无红色报错；
    2. 「紙本與 Excel」→「檢視 mock 範例」能载入中文工作簿（验证 /demo/ 路由与应用解析）；
    3. 地图有底图（验证访问者浏览器能连 OpenFreeMap）；
    4. 改一条观察记录，刷新页面后仍在（验证 localStorage 持久化）。
EOF
