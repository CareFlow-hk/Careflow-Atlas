> **2026-09-26 账号系统更新**：现已加入独立账号后端（Node + SQLite）、邀请激活、登录、会话管理、密码修改／恢复、管理员权限与审计。启动必须同时运行账号服务；仅静态部署不再是完整运行方式。参见 [账号系统与 VPS 部署](docs/ACCOUNTS.md)。业务数据仍是按账号隔离的浏览器合成演示，尚无共享业务数据库。下文旧的静态原型说明以此更新为准。

# CareFlow Atlas

> 西营盘社区客厅「洗樓」外展工作台 —— 用合成资料砌出嚟嘅前端原型。

呢个 repo 系一个**示范原型**同前端基础，**唔系**已经上线嘅 NGO 系统。已加入独立账号后端与登录；仍无共享业务数据库、多租户、离线同步或审批流程；亦都**唔可以**入任何真实居民资料。

## 而家做得到啲乜

**纸本／Excel**

- **照片回录**：支援多张洗楼纸本照片，经 Azure `gpt-6-luna` 辨识后，在原图旁逐笔核对，再追加到访与待跟进记录。包括草稿恢复、逐张重试、手动补录、相同文件重复保护，以及桌面／手机界面。API key 只在服务器配置。见 [照片回录与 Azure 配置](docs/PHOTO_INTAKE.md)。

- 格式识别与字段对应只供预览。改动对应后会撤销旧的待导入资料，请整理原档再重新载入；三种推测格式尚不支援写入。

- 喺浏览器直接解析合成 `.xlsx`，逐行列出验证问题，唔会静静哋丢咗有问题嘅行。
- 导出／合并中文六表工作簿，有历史保护同行级复核。
- **追加式更正**：错嘅记录唔改唔删。另开一行，喺「更正原記錄編號」填返要更正𠮶条，更正链链尾生效；被更正嘅原行退出覆盖计算，但保留喺历史度兼标明「已被更正」。同一条原记录有两条并行更正就报冲突，要人手拣；修改跟进或结案关系必须写明更正原因。

**地图同外展**

- 喺真实 OpenStreetMap 西营盘底图上面睇合成楼宇，拣楼 → 俯冲视角 → 展开楼层堆叠。
- 睇楼层／单位状态：明确否定结果、不确定判断、接触结果、待跟进。
- 追加新观察，唔会覆盖旧历史。
- 载入 20 幢楼嘅街区 mock（123 层、362 个单位、56 个合成人物、多次探访纪录），合并时保留现有记录。
- 底板或者 WebGL 唔得嘅时候，楼宇清单同表单一样行得到。

**其他**

- 整份合成 snapshot 经 repository + `localStorage` 存喺呢个浏览器，亦可以导出做 JSON。

## 唔好当真嘅嘢

- 所有业务记录、人物、地址、层数、单位间隔**全部系合成**。地图图砖同周边楼宇系真实地理资料，高亮嘅 CareFlow 目标系示意。
- **未做**：共享业务数据库、租户隔离、离线同步、审批、任何自动医疗或法律判断。
- 照片辨识需由使用者按「開始辨識」，将处理后的照片传送至配置的 Azure OpenAI 服务；请只使用合成或获准的测试样本。没有新增模型训练流程。

## 本机运行

实测环境：**Node.js v24.15.0 / npm 11.12.1**。

```bash
npm ci
npm run demo:generate   # 由 src/data/demoFixture.ts 確定性重建示範工作簿
npm run typecheck
npm run lint
npm test                # 執行全部回歸測試；最新驗證見 docs/VALIDATION.md
npm run build
npm run dev             # vite --host 127.0.0.1
```

请先按 [账号开发步骤](docs/ACCOUNTS.md#本机开发) 配置 `.env`、初始化管理员并启动 `npm run auth:dev`。登入后拣 **載入示範資料**；想睇 Excel 核对流程，就拣 **紙本與 Excel** → **重新載入示範資料**。生产验证请使用 Docker 同源双服务部署。

| 文件 | 用途 |
| --- | --- |
| [docs/EXCEL_WORKFLOW.md](docs/EXCEL_WORKFLOW.md) | 中文六表流程同更正规则 |
| [public/demo/careflow-paper-excel-mock.xlsx](public/demo/careflow-paper-excel-mock.xlsx) | 手造范本。入面有 14 个下拉选单同冻结窗格，SheetJS 读唔到呢啲格式资讯 —— **唔好**用 SheetJS 重写佢，会静静哋拆走 |
| [public/demo/careflow-field-outreach-demo.xlsx](public/demo/careflow-field-outreach-demo.xlsx) | 旧英文工作簿，一样支援 |

## 设定

预设底图系 OpenFreeMap Positron，要连网先攞到图砖、glyph 同 style 资源。

```bash
VITE_MAP_STYLE_URL=https://example.org/style.json npm run dev
```

`VITE_` 开头嘅嘢会入到浏览器 bundle，**唔好**放密码，见 [.env.example](.env.example)。应用程序码唔会将业务记录送去地图供应商；供应商收到嘅系正常请求地图资源时附带嘅网络资讯。

## VPS 部署

现在必须运行 Nginx 前端和 Node 账号服务。复制 `.env.example` 为 `.env` 并设定实际 HTTPS 域名与空闲端口，然后运行：

```bash
docker compose up -d --build --wait
docker compose exec auth node server/manage.mjs bootstrap admin@example.org 管理员
```

使用命令输出的一次性链接设定密码。完整的 HTTPS 反代、邀请、备份与恢复步骤见 [docs/ACCOUNTS.md](docs/ACCOUNTS.md)。只上传 `dist/` 或使用 `.openai/hosting.json` 的旧静态托管目标无法运行账号系统。

## 专案结构

- [`server/`](server/) — 账号 API、SQLite、会话、审计及运维脚本
- [`src/auth/`](src/auth/) — 登录、激活、账号管理界面
- [`src/domain/`](src/domain/) — 领域记录同覆盖摘要（浏览器无关）
- [`src/data/`](src/data/) — 工作簿适配、repository 边界、本机持久化、合成 fixtures
- [`src/app/`](src/app/) — Zustand 工作区状态同应用组装
- [`src/map/`](src/map/) — MapLibre 场景同与 renderer 无关嘅空间 view model
- [`src/components/`](src/components/) — 导入、楼宇、观察、历史流程
- [`scripts/generate-demo.ts`](scripts/generate-demo.ts) — 确定性合成工作簿生成器
- [`docs/`](docs/) — 来源评审、架构、决策、示范剧本
- [`public/demo/`](public/demo/) — 应用会 fetch 嘅工作簿；[`samples/`](samples/) — 归档用嘅重复副本，build 唔会用到

边啲系源代码、边啲系生成、点重建，睇 [INDEX.md](INDEX.md)；证据边界睇 [docs/SOURCE_REVIEW.md](docs/SOURCE_REVIEW.md)；已实作设计睇 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 真正试点之前

要攞到同核实：真实纸本表格、人物层／楼宇层工作簿、覆盖同重访定义、成员同住户规则、装置同网络条件，仲有机构嘅存取、保留、删除、备份同外部供应商政策。合成适配器要逐步换走，**唔好**将真实记录上传入呢个原型。

自动检查、浏览器验证同未测试嘅运行条件见 [docs/VALIDATION.md](docs/VALIDATION.md)。
