# CareFlow Atlas —— 静态前端容器。
#
# 这个镜像只做一件事：把 `npm run build` 出来的 dist/ 用 nginx 提供出去。
# 里面没有后端、没有数据库、没有任何业务数据；业务记录存在访问者浏览器的
# localStorage，容器重启不会带走也不会共享它们。详见 docs/DOCKER.md。

# ---------- 构建阶段 ----------
# 用 Debian slim（glibc）：与 README 记录的实测 Node v24.15.0 对齐；rollup /
# esbuild 等原生依赖在 glibc 下有预编译包，比 musl 少一类失败模式。构建阶段
# 不进最终镜像，体积无所谓。
FROM node:24.15.0-slim AS build

WORKDIR /app

# 依赖清单单独一层：锁文件不变时 npm ci 可直接复用缓存。
# 注意 npm ci 会从 registry.npmjs.org 与 SheetJS CDN 取包，构建需要外网。
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY shared ./shared

# 底图样式地址在构建期烘进 bundle（VITE_ 变量会进浏览器，不要放密码）。
# 留空则用代码内默认值 https://tiles.openfreemap.org/styles/positron
ARG VITE_MAP_STYLE_URL=""
ENV VITE_MAP_STYLE_URL=${VITE_MAP_STYLE_URL}

# 与 README「靜態部署」小节一致的配方。demo:generate 只重写英文演示簿
# careflow-field-outreach-demo.xlsx（确定性，输出与入库副本逐字节一致），
# 不会碰手造的 careflow-paper-excel-mock.xlsx。
RUN npm run demo:generate && npm run build

# ---------- 运行阶段 ----------
# 只带 nginx 和静态产物：node_modules、源码、测试、.git 都不进镜像。
FROM nginx:1.29-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# 探针用 alpine 自带的 busybox wget，不必为了 HEALTHCHECK 装 curl。
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

EXPOSE 80

# 官方镜像的默认 CMD 就是这一条，显式写出来方便阅读。
CMD ["nginx", "-g", "daemon off;"]
