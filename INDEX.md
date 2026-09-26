> 2026-09-26 更新：独立账号系统已实现。本文原有“纯静态／无后端／无登录”段落属于历史基线；当前运行与部署以 [docs/ACCOUNTS.md](docs/ACCOUNTS.md) 为准。业务共享持久化仍未实现。

# CareFlow Atlas · 目录索引

> 本文件是**仓库地图**：回答「某个东西在哪、是不是源文件、怎么重新生成」。
> 项目定位、运行方式和边界说明以 [README.md](./README.md) 为准；工作约定与硬规则以 [CLAUDE.md](./CLAUDE.md) 为准；后端计划正文以 [BACKEND_GAP_ANALYSIS.md](./BACKEND_GAP_ANALYSIS.md) 为准。
> 本文件只做导航，不复制上述任何一份的内容。

## 0. 当前状态

- 分支：`feat/w0-candidate-format-recognition`
- 本质：**纯前端原型**。React + Zustand + SheetJS + MapLibre，数据整份存在浏览器 `localStorage`。
- 仓库内**没有后端**：无 HTTP API、无数据库、无服务端迁移脚本。`fetch` 只用于取演示工作簿和地图底图。
- 测试基线：最新检查和运行边界见 [docs/VALIDATION.md](./docs/VALIDATION.md)。
- 全部业务数据（人名、地址身份、楼层、外展记录）均为**合成数据**，不得替换为真实住户资料。

图例：**🟢 源文件**（受版本管理，改动对象） · **🔵 生成物**（可再生产，勿手改） · **⚪ 已忽略**（在 `.gitignore` 内）

## 1. 顶层结构

```
Careflow-Atlas/
├── 🟢 index.html              应用入口 HTML
├── 🟢 vite.config.ts          Vite 配置
├── 🟢 tsconfig.json           TypeScript 配置
├── 🟢 eslint.config.js        ESLint 配置
├── 🟢 package.json            依赖与 npm scripts
├── 🟢 .env.example            环境变量样例（VITE_MAP_STYLE_URL）
├── 🟢 .openai/hosting.json    仅所有者可见的静态托管配置（指向 dist/）
├── 🟢 Dockerfile              容器定义 · 两阶段：Node 构建 → nginx 提供 `dist/`
├── 🟢 .dockerignore           构建上下文排除清单（依赖、产物、资料、文档不进镜像）
├── 🟢 docker-compose.yml      VPS 启动入口 · `docker compose up -d --build`
├── 🟢 deploy/                 容器与部署配置 · 见第 4.1 节
├── 🟢 README.md               项目介绍、运行方式、部署说明
├── 🟢 INDEX.md                本文件 · 仓库地图
├── 🟢 CLAUDE.md               仓库内工作约定与四条硬规则
├── 🟢 BACKEND_GAP_ANALYSIS.md 后端缺口分析与实施计划（计划正文）
├── 🟢 DOCKER_PLAN.md          Docker 封装的执行契约与计划（过程产物）
├── 🟢 src/                    应用源码 · 见第 2 节
├── 🟢 docs/                   设计/演示/验证/部署文档 · 见第 3 节
├── 🟢 scripts/                工作簿与几何再生成脚本 · 见第 4 节
├── 🟢 public/demo/            应用运行时抓取的演示工作簿 · 见第 5 节
├── 🟢 samples/                已归档的重复工作簿副本（不参与构建）· 见第 5 节
├── 🔵 dist/                   构建产物（`npm run build` 生成）
├── 🔵 tsconfig.tsbuildinfo    TS 增量编译缓存
└── ⚪ node_modules/           依赖安装目录
```

根目录保持只放「配置 / 文档 / 目录」。容器与部署配置（`Dockerfile`、`.dockerignore`、`docker-compose.yml`、`deploy/`）归「配置」，说明文档写进 `docs/`。`DOCKER_PLAN.md` 是 Docker 封装任务的契约与计划，属**过程产物**，任务收尾后应并入 `docs/`。

## 2. 源码地图 `src/`

依赖方向自上而下，**不要反向引用**：`components` → `app` → `{domain, data, map}`，`domain` 不依赖任何浏览器 API。

### `src/domain/` — 领域规则（浏览器无关，优先放这里）

| 文件 | 职责 |
| --- | --- |
| [types.ts](./src/domain/types.ts) | 领域类型、覆盖状态、`compareObservationTime` / `latestObservation` / `getCoverageStatus` / `getCoverageSummary` |
| [schema.ts](./src/domain/schema.ts) | Zod 校验：集合、日期与时刻字段、重复 ID、父子链、跟进引用 |
| [presentation.ts](./src/domain/presentation.ts) | 覆盖状态的标签与配色映射 |
| [types.test.ts](./src/domain/types.test.ts) · [schema.test.ts](./src/domain/schema.test.ts) | 对应测试 |

> 追加更正已生效：覆盖与摘要只使用有效版本，历史保留原事件。更正分叉会被拒绝；跟进结案按整条更正链识别，修改跟进关系须注明原因。

### `src/data/` — 数据适配与仓储边界

| 文件 | 职责 |
| --- | --- |
| [readWorkbook.ts](./src/data/readWorkbook.ts) | 所有 Excel 读取共用的文件大小和行列上限 |
| [repository.ts](./src/data/repository.ts) | 数据访问边界；`PersistenceAdapter` 目前是**同步整份快照**接口，底层 `localStorage`。正式 repository 需另建 Promise 接口，不要假装它是同步的 |
| [workbookImport.ts](./src/data/workbookImport.ts) | 旧英文单工作簿解析与校验 |
| [workflowWorkbook.ts](./src/data/workflowWorkbook.ts) | 中文六表工作簿的导出与解析 |
| [workflowFormat.ts](./src/data/workflowFormat.ts) | 六张工作表的表头与格式规格 |
| [workflowMerge.ts](./src/data/workflowMerge.ts) | 导入结果与现有工作区的合并（含历史保护） |
| [workflowDemo.ts](./src/data/workflowDemo.ts) | 纸本／Excel 工作流的基准合成快照 |
| [districtDemo.ts](./src/data/districtDemo.ts) | 街区扩展快照，在 `workflowDemo` 之上扩展（20 幢 / 123 层 / 362 单位 / 56 人） |
| [demoFixture.ts](./src/data/demoFixture.ts) | 旧英文演示快照，`npm run demo:generate` 的输入 |
| [demoGeometry.ts](./src/data/demoGeometry.ts) · [demoGeometry.json](./src/data/demoGeometry.json) | 旧版建筑占地几何；`alignDemoSnapshot` **只升级内置演示地点**，不对导入记录做地理编码 |
| [districtGeometry.json](./src/data/districtGeometry.json) | 街区几何，由固定来源瓦片提取（**不按虚构名称地理编码**），由 [districtDemo.ts](./src/data/districtDemo.ts) 直接 import，**没有 `.ts` 包装层** |

同名 `*.test.ts` 为对应回归测试；[districtWorkbook.test.ts](./src/data/districtWorkbook.test.ts) 直接读取 `public/demo/` 下的成品工作簿做往返验证。

### `src/imports/` — W0 候选格式识别（本期新增的封闭范围）

| 文件 | 职责 |
| --- | --- |
| [detector.ts](./src/imports/detector.ts) | 有界格式识别：只认计划第 8.1.2 节清单内的候选格式，超出范围**明确拒绝并给出原因**，不猜、不静默丢列 |
| [profiles.ts](./src/imports/profiles.ts) | 各候选格式的档案定义（表头别名、工作表提示、字段映射） |
| [samples.ts](./src/imports/samples.ts) | 内存构造的回归样例：每种格式都要有**成功 / 歧义 / 拒绝**三类 |

> ⚠️ 识别**不是**身份匹配，也**不构成**自动批准入库。见 [CLAUDE.md](./CLAUDE.md) 第 3.1、3.2 条。

### `src/app/` — 应用装配与共享状态

| 文件 | 职责 |
| --- | --- |
| [App.tsx](./src/app/App.tsx) | 应用外壳、侧栏、弹窗装配；演示工作簿的抓取与下载入口 |
| [store.ts](./src/app/store.ts) | Zustand 工作区状态 |
| [webmcp.ts](./src/app/webmcp.ts) | 以只读工具形式暴露覆盖摘要 |
| [motion.ts](./src/app/motion.ts) | 空间动效时长与缓动（刻意慢于界面动效） |

### `src/map/` — 地图与空间视图模型

| 文件 | 职责 |
| --- | --- |
| [MapScene.tsx](./src/map/MapScene.tsx) | MapLibre 场景、建筑选中与楼层拉伸动画 |
| [mapModel.ts](./src/map/mapModel.ts) | 渲染器无关的空间视图模型；**只接收空间 ID 与摘要，人员与观察备注不进地图模型** |
| [focusContext.ts](./src/map/focusContext.ts) | 聚焦上下文 |
| [map.css](./src/map/map.css) | 地图样式 |

### `src/components/` — 界面工作流

| 文件 | 职责 |
| --- | --- |
| [ImportDialog.tsx](./src/components/ImportDialog.tsx) | 导入对话框（含演示入口与导出） |
| [RecognitionPanel.tsx](./src/components/RecognitionPanel.tsx) | 识别结果与字段映射预览（可筛可改） |
| [BuildingDetail.tsx](./src/components/BuildingDetail.tsx) | 建筑详情与楼层单位状态 |
| [ObservationEditor.tsx](./src/components/ObservationEditor.tsx) | 追加观察（不覆盖历史） |
| [ObservationHistory.tsx](./src/components/ObservationHistory.tsx) | 观察历史 |
| [PaperForm.tsx](./src/components/PaperForm.tsx) | A4 纸本表单打印 |
| `paper.css` · `workflow.css` | 组件样式 |

其余样式在 `src/styles.css`（全局）与 `src/refinement.css`（界面细化）。入口 [main.tsx](./src/main.tsx)。

## 3. 文档索引 `docs/`

| 文档 | 读它的场景 |
| --- | --- |
| [SOURCE_REVIEW.md](./docs/SOURCE_REVIEW.md) | **先读这篇。** 证据边界：哪些是实测、哪些是假设、哪些未验证 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 想了解已实现的整体设计 |
| [DECISIONS.md](./docs/DECISIONS.md) | 想知道某个技术选型为什么这么定（ADR） |
| [EXCEL_WORKFLOW.md](./docs/EXCEL_WORKFLOW.md) | 改纸本／Excel 回录工作流时 |
| [DISTRICT_DEMO.md](./docs/DISTRICT_DEMO.md) | 改街区扩展情境或重建其工作簿／几何时 |
| [DEMO_SCRIPT.md](./docs/DEMO_SCRIPT.md) | 要做一场约两分钟的演示时 |
| [UI_REFINEMENT.md](./docs/UI_REFINEMENT.md) | 改界面层级与交互细节时（2026-09-11 的定向细化，非新视觉识别） |
| [VALIDATION.md](./docs/VALIDATION.md) | 想知道验证了什么、浏览器实测做了什么、哪些工况**没测** |
| [DOCKER.md](./docs/DOCKER.md) | 要在 VPS 上用容器部署给人用时（构建、验证、反代、访问限制、排错；含**尚未实跑**的诚实声明） |

> `DEMO_SCRIPT.md` 与 `UI_REFINEMENT.md` 此前没有被 [README.md](./README.md) 链接，是从这里进入的入口。

## 4. 脚本与再生成 `scripts/`

| 脚本 | 产出 | 是否接入 `npm run` |
| --- | --- | --- |
| [generate-demo.ts](./scripts/generate-demo.ts) | `public/demo/careflow-field-outreach-demo.xlsx`（旧英文样例） | ✅ `npm run demo:generate` |
| [generate-district-workbook.ts](./scripts/generate-district-workbook.ts) | 先写 `outputs/excel-workflow/CareFlow_街區擴展_mock.xlsx`，再复制到 `public/demo/careflow-district-demo.xlsx` | ❌ 需手动 `node --import tsx ...` |
| [district-workbook-builder.mjs](./scripts/district-workbook-builder.mjs) | 上面那个脚本的排版构建器，不单独运行 | — |
| [extract-district-geometry.mjs](./scripts/extract-district-geometry.mjs) | 从固定来源瓦片提取 `districtGeometry.json` | ❌ 需手动 `node scripts/extract-district-geometry.mjs <来源瓦片.pbf>` |

**现状说明（后续迭代需注意）**：`generate-district-workbook.ts` 依赖 Codex bundled spreadsheet runtime（默认 `~/.cache/codex-runtimes/...`，可用 `CAREFLOW_ARTIFACT_RUNTIME` 覆盖），**在普通 checkout 上跑不起来**；`npm run demo:generate` 也只重建旧英文样例，**不重建全部三份工作簿**。这两个脚本目前仍是唯一的重建路径，尚未收编为应用内依赖。

`outputs/` 在 `.gitignore` 内。

## 4.1 容器与部署 `deploy/`

| 文件 | 作用 |
| --- | --- |
| [nginx.conf](./deploy/nginx.conf) | **容器内**的 nginx 配置：路由、缓存分层、gzip、安全响应头 |
| [verify.sh](./deploy/verify.sh) | 部署自检脚本。在装有 Docker 的机器上跑 `bash deploy/verify.sh`，自动跑完全部可自动化的检查项（镜像大小、Up、日志、各路由状态码与缓存头、健康检查、换端口、删容器重建、stop/start/restart、save→rmi→load、构建参数），末尾提示需人工确认的 4 项 |
| [verify-browser.mjs](./deploy/verify-browser.mjs) | 浏览器端到端检查（可选）。用真实 Chromium 走一遍导入→解析→合并→刷新→地图，覆盖 shell 脚本够不着的「应用是否真的能跑」。需自行 `npm i -D playwright`，**故意不进 `package.json`** |
| [nginx-site.conf.example](./deploy/nginx-site.conf.example) | **宿主机**反代样例（HTTPS、certbot、Basic Auth / IP 白名单），可选 |

容器定义在根目录：[Dockerfile](./Dockerfile)、[.dockerignore](./.dockerignore)、[docker-compose.yml](./docker-compose.yml)；操作手册见 [docs/DOCKER.md](./docs/DOCKER.md)。

> ⚠️ `deploy/` 里没有任何**密钥**。反代样例中的口令文件路径、域名、IP 都是占位符，实际值留在宿主机上，**不要**提交进仓库。

## 5. 演示与样例数据

### `public/demo/` — 应用运行时抓取（🔵 产物，勿手改）

| 文件 | 说明 |
| --- | --- |
| `careflow-field-outreach-demo.xlsx` | 旧英文演示工作簿，由 `npm run demo:generate` 生成 |
| `careflow-paper-excel-mock.xlsx` | 中文六表**排版范本**（下拉选项、文字电话栏、日期格式、冻结栏列），手工维护，无生成脚本 |
| `careflow-district-demo.xlsx` | 街区扩展工作簿，由 `generate-district-workbook.ts` 生成 |

这里的路径是**根相对**的 `/demo/...`，子目录部署需相应调整 base path。这三份是**演示资料**，不是待核对清单或正式导入文件。

### `samples/` — 已归档的重复副本（🟢 目录，内容不参与构建）

存放 `CareFlow_紙本回錄_mock範本.xlsx` 与 `CareFlow_街區擴展_mock.xlsx`。

- 二者与 `public/demo/careflow-paper-excel-mock.xlsx`、`public/demo/careflow-district-demo.xlsx` **逐字节相同**（md5 一致）。
- 它们正是应用「下载 mock 範例 / 下载街区工作簿」按钮**下载出来的文件名**（见 [App.tsx](./src/app/App.tsx)），属于**取用产物**而非源文件。
- **全仓没有任何代码或文档按此路径读取它们**；重建工作簿请走第 4 节的脚本，改排版范本请直接改 `public/demo/` 下那一份。
- 保留在此仅作归档样本，**不要**在此目录新增会误导来源的文件。

## 6. 上手顺序

```bash
npm ci                 # 安装依赖
npm run demo:generate  # 重建旧英文演示工作簿
npm run typecheck      # tsc -b --pretty false
npm run test           # vitest run，运行全部回归测试
npm run lint           # eslint .
npm run dev            # vite --host 127.0.0.1
```

阅读顺序建议：[README.md](./README.md) → [CLAUDE.md](./CLAUDE.md)（尤其第 3 节四条硬规则）→ [docs/SOURCE_REVIEW.md](./docs/SOURCE_REVIEW.md) → 本文件第 2 节 → [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

**改动前先跑基线，改动后必须复跑 typecheck / test / lint**；既有测试断言的是演示语义，不要为了让新代码通过而放宽它们。

## 7. 本索引的维护约定

下列情况发生时更新本文件，其余情况不要动它：

- 新增／移动／删除**顶层目录或顶层文件**。
- `docs/` 增删文档，或某篇文档的定位发生变化。
- `scripts/` 增删脚本，或某个脚本接入／移出 `npm run`。
- `public/demo/` 或 `samples/` 的文件增删。
- `deploy/` 增删文件，或容器／部署方式发生变化。

仅修改 `src/` 内部实现、不改变模块划分时，**不需要**更新本文件。
