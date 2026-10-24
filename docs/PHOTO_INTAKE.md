# 照片回录

基于 CareFlow-hk/Atlas `7805e03`，参考初版 CareFlow 的 `VolunteerUpload.tsx`、`VolunteerReview.tsx` 和 `backend/app/llm/vision.py`，把上传、原图核对与确认保存接到 Atlas 现有到访／跟进模型。

## 操作

1. 登入并载入街区；按页首「照片回錄」。
2. 选择或拖入 JPG、PNG、WebP，手机也可拍摄。每张最多 15 MB，每批 8 张。HEIC/PDF 需要先转成支援的图片格式。
3. 按「開始辨識」后逐张送往 Azure；每张最多 60 笔。可停止，失败可只重试该张。已完成页面可以先核对。
4. 原图旁逐笔确认位置、日期、纸本工作员与探访结果。大厦／单位只做唯一配对，明确的数字楼层写法（例如 `1樓`／`1層`／`1/F`／`1F`）视为同一楼层；有歧义时保留空白。不确定的选项、缺少年份及未辨识位置由人补上。也能略过某笔、手动补录。
5. 每笔都确认后，预览新增到访和待跟进，再一次保存。结果会反映到地图、位置历史及 Excel 导出。

「試用示範紙本」是固定合成内容，不呼叫 AI，历史会标明示范。API 未配置时不会偷偷用示范内容替代辨识；可选择手动对照照片回录。

## Azure 配置

服务器 `.env`：

```dotenv
AZURE_OPENAI_ENDPOINT=https://CareFlow-VPS.services.ai.azure.com/openai/v1
AZURE_OPENAI_DEPLOYMENT=gpt-6-luna
AZURE_OPENAI_FALLBACK_DEPLOYMENT=gpt-6.1-sol
AZURE_OPENAI_API_KEY=
```

填入自己的 API key，重启 `npm run auth:dev`。不要使用 `VITE_` 前缀。前端、浏览器保存及 Git 都不接收 API key。配置状态只表示服务器已读到配置，不代表已验证 Azure 配额或模型能力。

本机开发另需 `APP_ORIGIN=http://127.0.0.1:5173` 和 `ALLOW_INSECURE_LOCALHOST=true`；执行 `npm run auth:dev`、`npm run dev`。账号初始化沿用 [ACCOUNTS.md](./ACCOUNTS.md)。

服务使用 Azure OpenAI v1 Responses REST endpoint、`input_image`（`detail: original`）、strict JSON schema 和 `store:false`。首轮部署为 `gpt-6-luna`，符合下述门槛才以同一 endpoint/key 呼叫 `gpt-6.1-sol`。`AZURE_OPENAI_FALLBACK_DEPLOYMENT` 留空可停用第二轮；与首轮同名时也不重复呼叫。既有 Node 服务使用内建 fetch，无须另起 Python 服务。认证采 API key；目前没有新增 Entra ID token 流程。

依据：[OpenAI 图片输入文件](https://developers.openai.com/api/docs/guides/images-vision)、[Azure Responses 文件](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses?view=foundry-classic)。

## 保守 fallback

门槛固定于 `server/photos.mjs` 的 `FALLBACK_POLICY`，不是前端可覆写的参数。Luna 必须在 strict JSON 中指出实际看不清的字段；原本空白或缺少年份不算辨识疑点。

- 至少 60% 的记录同时满足：`confidence < 0.70`，且有至少 2 个不同的关键字段看不清。关键字段包含大厦、地址、楼层、单位、范围、探访／接触结果、原话、跟进及时间原话；日期、工作员不参与门槛。
- 可辨为模糊而整张读不出记录（`UNREADABLE`），或 Luna 回复不是有效 JSON／不符合 schema／因 output token 上限截断，也可升级。
- 空白表格、非外展照片、超过 60 行、一般 warnings，以及 UI 的 `confidence < 0.8` 人工核对提示，都不会自行升级。登入／权限／配额／HTTP／网络错误、首轮逾时、内容拒绝和使用者停止不触发第二轮。
- 每张最多两次 provider 呼叫，没有自动重试循环。Sol 独立读同一张处理后图片，不接收 Luna 的猜读答案。账号／全域并发名额涵盖两轮；停止或断线会中止进行中的呼叫。
- Sol 完成后，UI 显示「已完成進階辨識」、原因和实际模型，仍须人工逐笔核对。Sol 失败或记录数减少时保留可用 Luna 结果并明示；两轮皆失败则报错。内容拒绝不以首轮资料绕过。
- 草稿、入库 metadata 及 Excel 关联封存保留 primary/fallback model、触发原因、采用或保留状态；`photoSource.model` 永远是目前结果的实际模型。

这是成本较保守的启发式门槛，不是准确率保证。模型的把握分数与疑点都是模型自评，高把握误读可能不升级。不能把未触发 fallback 解读成辨识正确。

## 部署

Compose 的 auth 服务会接收这四个 server-only 环境变数。每轮最多 90 秒，整张最多 180 秒；浏览器等待 200 秒。Nginx 为 `/api/photos/recognize` 单独设定 5 MB 请求限制及 195 秒回复等待；账号接口仍为 8 KB。需要重新建置 **web 与 auth 两个服务**，不能只发布静态 `dist`。

沿用原 Compose project 与 `accounts` volume，按现有账号备份流程处理。部署前确认 APP_ORIGIN、HTTPS、volume 与 key；此改动没有执行远端部署。

## 资料与核对边界

- 照片先在浏览器校正 EXIF 方向，缩至最长边 2400px、转 JPEG 并去除原档 metadata。只有按辨识才传送处理后图片。此处「原圖」是用于核对的处理后图片。
- 服务器需要有效账号、同源请求、CSRF，并限制每账号 40 次／15 分钟、单账号同时 1 张、服务最多同时 4 张。只在内存处理，不把照片写入服务器文件；不记录图片、API key 或原始 provider error。
- 使用 Azure 外部模型，不是离线 OCR。`store:false` 不构成对 Azure 所有服务日志或保留政策的保证。
- 草稿（包括处理后图片）按账号隔离保存在本浏览器 IndexedDB；刷新可恢复。保存到访成功后移除该批草稿。草稿保存失败会显示提示；原有不合法草稿不会自动覆盖。
- 到访仍沿用 Atlas 的账号分隔 localStorage 工作区，**没有新增跨装置业务资料同步**。现有 domain 仍是合成资料模式，不能把本功能当成真实 NGO 个资上线验收。
- 只转录明确记载的跟进；相对时间保持原话，未明的日期、工作员、接触与住房判断不自行补全。核对人与纸本工作员分开保存。
- 每批全部校验后做一次资料写入；任何格式、关联或保存失败都不发布部分成功状态。旧记录不覆写。
- 原始文件 SHA-256 与行序产生稳定记录 ID，相同文件改名再导入会略过已保存行。不同照片、裁切或重新编码的同一张纸本不保证自动判重，需要人工核对。
- 保存档名、纸本行、模型、来源指纹、核对账号／时间；图片不包含在入库记录或 Excel 里。既有 Excel 关联封存保留照片来源 metadata。

## 验证

`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:auth`、`npm run build`。

新增测试包含未知／歧义位置、缺栏、非法日期、跨大厦单位、整厦结果不代填子单位、逐笔核对、原子追加、重复入库、相对时间、Excel 往返、API key 隐藏、图片格式／容量、Responses payload、provider 错误／拒绝／不完整回复、逾时与并发限制、登入／CSRF／同源检查。

浏览器验证：桌面 1440×960、手机 390×844；未配置状态、示范原图与字段、刷新恢复已核对草稿、逐笔确认、入库摘要、保存后地图／历史／待跟进连动。

2026-10-03 已使用配置的 Azure `gpt-6-luna` 做 4 次真实呼叫，输入为自制、含 2 笔虚构记录的繁体中文印刷表格，不含真实个人资料。前两次 `high` 模式对「社區客廳活動」出现漏字／误字；改用 `original` 后，两次重测均保留完整活动名称。这只证明该样本的改善，不代表一般 OCR 准确率或手写验收。

最终设定已从浏览器上传、经真实 API 返回并核对：2 笔结果、唯一楼层／单位配对、无跟进行动时类别留空、未记载的住房判断留空、「下星期再聯絡」保留原话、没有推算确定日期或填入负责人。首轮结果已人工修正并入库为 2 笔到访与 1 项跟进；重复上传同档后略过 2 笔，没有新增或覆写历史。实际手写纸本、反光／倾斜照片和多人操作仍需要另外验证。


2026-10-04 fallback 真实 API 测试使用三张先前生成的合成手写图片：

| 图片 | 路由 | 耗时 | 结果与限制 |
| --- | --- | --- | --- |
| 01 清晰手写 | Luna，一次 | 18.1 秒 | 没有触发；仍误读地址、工作员和「社區客廳」等字词。 |
| 02 潦草涂改 | Luna，一次 | 17.3 秒 | 没有触发；仍误读地址及若干探访／跟进原话。 |
| 04 模糊缺栏 | Luna → Sol，两次 | 35.3 秒 | Luna 自评 0.38、4 个关键字段不清，达到门槛；Sol 读回德昌樓、西营盘示范街16号、全幢大厦、门禁未能进入／未接触及改日再访。年份、工作员、确定跟进日期、负责人留空；「時間未定」保留疑点。 |

修改前的 Luna 基线也曾把模糊图的大厦读成「沙田大樓」、跟进读成「致電查詢」（自评 0.67）。这是同一合成图片上的前后比较，模型输出有随机性；三张图片不能估计整体正确率或一般 fallback 比率。

自动测试涵盖门槛边界、缺栏／单一疑点不升级、同图独立呼叫、最多两轮、错误／拒绝／取消不误升级、失败保留首轮与模型来源、账号并发锁，以及草稿／入库／Excel 的 fallback metadata 往返。

浏览器另以相同像素、加入测试 metadata 的 PNG 副本走过 JPEG 前处理、登入／CSRF、真实 Luna→Sol 呼叫及核对画面：显示进阶辨识，正确配对德昌樓与全厦范围；未能进入、未接触住户及改日再访有保留，未补日期／工作员。原有草稿保留，测试副本未入库。浏览器这次 Sol 把「時間未定」也放进跟进行动，仍需人工核对字段拆分。

本次检查：380 项前端／资料测试与 30 项服务器测试通过，build、lint 通过。
