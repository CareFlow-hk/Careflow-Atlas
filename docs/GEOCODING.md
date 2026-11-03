# 大厦名称搜索：来源核实与落地方案

2026-11-01 起草。需求：在系统里直接搜索大厦名称，选中后在该坐标新增大厦。

**2026-11-01 决定：Google 的数据先不接，只留槽位**（第 3.3 节）；搜索入口放「新增大廈」面板顶部，搜到的地址默认填进「地址」栏。

**同日补充（`docs/ha_hahdweb_dataspec.pdf`）**：这份文件**不是 ALS**，是房屋委员会（HA）的公共屋邨／居屋／商场／工厂大厦名册。它是另一个服务，**今天就能用、不需要 key**，保留为可切换的备选（第 3.2 节）。

**2026-11-02 更新：ALS 已接通**。服务在 `https://www.als.gov.hk/lookup`（不是旧的 `www.als.ogcio.gov.hk`），**不需要 key**，回的是逐座／逐幢的处所，覆盖私人楼宇。它现在是默认来源；响应结构与适配见 3.1.1、3.1.2。

## 1. 结论先说

「从 Google 只记录位置、地址、大厦名称」**仍然违规**，而且正好踩在 Google Maps Platform 条款最明确的两处，不是模糊地带。

| 条款 | 要求 | 本系统的实际情况 |
| --- | --- | --- |
| 内容必须显示在 Google 地图上（ToS 3.2.4「No Use of Content in a Non-Google Map」） | Google 返回的名称、地址、坐标属于它的 Content，只能配 Google 地图使用 | 底图是 MapLibre + OpenFreeMap，属于「非 Google 地图」 |
| 缓存上限（Maps Service Specific Terms） | 只有 **place ID** 可以无限期保存；名称、地址、坐标等其他 Content 最多缓存 30 个连续日历日 | 工作区是长期业务记录：跨装置同步、导出 Excel、留档数年 |

这三样东西恰好就是 Places 返回的核心 Content，没有一件是「不含 Google 内容」的，所以「只记录」不是折中方案，而是把两条例外一次踩全。

place ID 是唯一的长期保存例外，但它本身不可显示：要显示就得回查 Google，回查后仍然受第一条限制。因此在非 Google 地图上用 Google 数据，没有合规路径。

> 本节按整理时理解的现行条款写成，不是法律意见。阶段 0 以官网原文复核，把版本日期与摘录补进本节。

## 2. 边界

- 只服务「新增大廈」这一个流程，不做通用地址查询、不做批量抓取、不做整条街采集。
- 搜到的是**位置参考**，不是资料：名称和地址预填后仍由人确认，与既有「AI 只建议、人确认」同一口径。
- **不承诺「任何大厦都搜得到」**。搜不到时明确指向「在地圖上點選」，那仍是主路径。

## 3. 方案

### 3.1 搜索源（按合规性排序）

| 源 | 覆盖 | 条款 | 是否采用 |
| --- | --- | --- | --- |
| 香港政府地址数据库（ALS） | 已登记处所（逐座／逐幢），中英文门牌与大厦名，**覆盖私人楼宇** | 免费、免 key，允许长期保存与在自家地图显示 | **默认主源（2026-11-02 实测可用，3.1.1）** |
| 房屋委员会名册（HA） | 公共屋邨 245、居屋／绿置居 245、商场 56、工厂大厦 2；**没有私人楼宇**，一个屋邨只有一个点 | 政府开放数据（data.gov.hk「Housing」类），免 key | **备选**：`PLACE_PROVIDER=ha` |
| OSM Nominatim | 与底图同源，香港大厦名覆盖较稀 | ODbL：标注署名；公共实例禁止逐字联想 | **补充（未接）** |
| Google Places | 覆盖最好 | 见第 1 节 | **仅作外链，不接数据** |

- ALS 不给建筑轮廓。轮廓继续用现有的 `findOsmFootprint`（`src/map/osmFootprint.ts`）按坐标匹配 OSM 底图，与现在新增大厦的路径完全一致。
- Nominatim 公共实例有限流，只按 Enter 查询（不做逐字联想），与 3.3 的触发方式天然吻合。
- Google 只留一个「在 Google 地圖查看」外链：新分页打开，人不带任何内容回来。零风险，但只帮人确认「是不是这幢」。

#### 3.1.1 端点核实（2026-11-02 实际调用）

2026-11-01 记录的是旧域名 NXDOMAIN。**换到 `www.als.gov.hk` 后服务正常**，以下都是当天实测：

| 查询 | 结果 |
| --- | --- |
| `GET https://www.als.gov.hk/lookup?q=德朗邨` | `200 application/xml;charset=UTF-8`，根元素 `<AddressLookupResult>` |
| 同一请求加 `Accept: application/json` | `200 application/json`，同一份结果的 JSON 写法 |
| `q=zzzzqqqqxxxx` | `200`，只回 `RequestAddress`，**没有 `SuggestedAddress` 键** |
| `q=` 或完全不给 `q` | `200`，`AddressLine` 为空，同样没有结果 |
| `q=銅鑼灣` | `200`，**最多 200 条**（服务端上限），已按 score 降序 |
| 连续 15 次请求 | 全部 `200`，未见限流 |
| 延迟 | 40–150 ms（本机 → 服务） |

**不需要 key**，网址里也不带任何凭据。旧域名 `www.als.ogcio.gov.hk` 至今 NXDOMAIN，`als.ogcio.gov.hk` 只有 TXT 记录；代码默认指向 `www.als.gov.hk`，可用 `ALS_ENDPOINT` 覆盖。

#### 3.1.2 真实响应与适配（实测，不是文档推测）

一条结果 = 一个**处所（premises）**，不是抽象的「一幢大厦」：查「德朗邨」回来的是德瑜楼、德珮楼……每座独立、各有座标。这正是「新增大厦」需要的粒度。

JSON（`Accept: application/json`）结构：

```json
{ "RequestAddress": { "AddressLine": ["德朗邨"] },
  "SuggestedAddress": [ {
    "Address": { "PremisesAddress": {
      "EngPremisesAddress": { "EngBlock": { "BlockDescriptor": "BLK", "BlockNo": "1" },
        "BuildingName": "TAK YU HOUSE",
        "EngEstate": { "EstateName": "TAK LONG ESTATE" },
        "EngStreet": { "StreetName": "SHING KAI ROAD", "BuildingNoFrom": "28" },
        "EngDistrict": { "DcDistrict": "KOWLOON CITY DISTRICT" }, "Region": "KLN" },
      "ChiPremisesAddress": { "Region": "九龍", "ChiDistrict": { "DcDistrict": "九龍城區" },
        "ChiStreet": { "StreetName": "承啟道", "BuildingNoFrom": "28" },
        "ChiEstate": { "EstateName": "德朗邨" },
        "ChiBlock": { "BlockDescriptor": "座", "BlockNo": "1" },
        "BuildingName": "德瑜樓" },
      "GeoAddress": "3896321295T20131227",
      "GeospatialInformation": { "Latitude": "22.3307", "Longitude": "114.20303" } } },
    "ValidationInformation": { "Score": 70.0 } } ] }
```

XML 与其同构：根 `<AddressLookupResult>`，每条 `<SuggestedAddress>`；JSON 的 `EngEstate` 对应 `<EngEstate><EstateName>`，`Region` 在 XML 里是 `<Region>` 的文本。

| 参数／返回 | 行为 |
| --- | --- |
| `q` | 查询词。空或未知词都回 `200`，不是 `400` |
| `n` | 返回条数上限：`n=8` 回 8 条；`n<=0` 或大于结果总数等于不设限，`q=銅鑼灣` 最多 200 条 |
| `Accept: application/json` | 回 JSON；不给就回 XML |
| `Content-Language` | `en, zh-Hant`；**不给 `Accept-Language` 时每条同时带中英两个语言块** |
| `Cache-Control` | `max-age=900, private`——**不共用缓存**，服务器也不缓存查询结果 |
| `GeoAddress` | 每个处所一个稳定代号（含更新日期），用作结果 `id` |
| `Score` | 相似度分数，服务已按它降序 |

**四个按文档猜会踩的坑**（都已实测）：

1. **中英两个语言块的先后顺序每条不同**：有的 `EngPremisesAddress` 在前，有的 `ChiPremisesAddress` 在前。用「取第一个 `<BuildingName>`」会把英文名当成中文名。实现按块分开读。
2. **找不到时不是空数组，而是整个 `SuggestedAddress` 键不存在**：只回 `RequestAddress`。当成格式错误会报 `502`，当成「无结果」才对。
3. **它会硬凑结果**：查「不存在的地方」仍回 8 条（一家酒店、一幢大厦、一个工厂），因为服务返回的是「最接近的处所」。直接用会把无关大厦塞给同事。**服务器要自己判相关性**：查询词与每条的名称、屋邨、街道、地区、分区（中英皆可）比对，对不上的丢弃；判法见 3.1.3。查不到就真的是空列表。
4. **同一幢大厦会重复**：同名字同坐标出现两次（两个门牌共用一个点，或服务端重复行）。结果按「名称 + 坐标」去重。

适配后的结果：

| 字段 | 来源 |
| --- | --- |
| `name` | 中文 `BuildingName` → 中文屋邨名 → 英文 `BuildingName` → 英文屋邨名 → 「街道 门牌」 |
| `address` | `区域 · 分区 · [屋邨] · [座] · 街道 门牌`，例：`九龍 · 九龍城區 · 德朗邨 · 1座 · 承啟道 28`。**没有的信息不补** |
| `lng`／`lat` | `GeospatialInformation`，WGS84；缺座标或落在香港框外一律丢弃 |
| `id` | `als-` + `GeoAddress` |

请求上限 `n = 24`（`ALS_MAX_RESULTS`），去重、比对后最多给面板 8 条（`PLACE_MAX_RESULTS`）。上游不可达、超时、拒绝、格式认不出，一律 `502` 并写明原因，**绝不返回空列表假装「没有这幢大廈」**。

### 3.1.3 查询词怎么对上结果（2026-11-02）

名称和地址共用面板上同一个搜寻框，所以查询词要同时能当名称和当地址用。判法只有一条路径（`server/placeSearch.mjs` 的 `readQuery` / `overlap` / `leastFound`），量过的例子如下。

**先拆成「文字」和「数字」**：`下鄉道 3 號` → 文字 `下鄉道`、数字 `3`；`德朗邨 1 座` → 文字 `德朗邨`、数字 `1`。`號`、`座`、`室`、`樓` 这类字跟着数字一起拿掉，`第` 也一样。**`3 樓` 不算数字**——楼层不是地图上的位置，把它当门牌号会把整幢楼筛掉。

| 输入 | 行为（2026-11-02 实测 ALS） |
| --- | --- |
| `福滿大廈` | 只回「福滿大廈」两幢，同一街上名称接近的「富滿大廈」「樂滿大廈」不再跟出来 |
| `福滿大樓`、`福滿大厦`、`福滿大屢`、`福滿廈` | 仍然找到「福滿大廈」：错一个字、漏一个字都不影响 |
| `德朗村`、`太古誠` | 仍然找到德朗邨、太古城：三个字的名字也容错一个字 |
| `承啟道28號` | 只留承啟道 28 的处所；服务会一并回承啟道 38 的启德体育园，被数字筛掉 |
| `德朗邨1座` | 只回德瑜楼：座数对上 |
| `下鄉道3號` | 服务里没有 3 号这个处所，于是把该街的处所原样列出（各自显示真实门牌），**不是空列表** |
| `土瓜灣下鄉道` | 找到「土瓜灣遊樂場 · 下鄉道 66」：字序不必连续 |
| `不存在的地方` | 空列表 |

- **文字按最长公共子序列比对**，不要求连续，也不要求字序连在一起。容错按长度给（`leastFound`）：**三个字以上至少容许错／漏一个**，之后每四个字再多容许一个（三、四、七字错一个，八字错两个）；**两个字必须完全一样**——两个字错一个是不同的词，不是打错。
- **只留最好的一档**。有完全对上的，就不再给只差一个字的；一个都对不上时，才把最接近那档拿出来。否则每次搜寻都会拖一串「富滿大廈」「樂滿大廈」。
- **数字是对得上才算**，比对名字里的门牌号与座数。一个结果都不带这个数字时，**不用数字把结果掏空**，照原样给出来，让同事自己看门牌。
- 房屋委员会名册只有邨名和地区，没有街道和门牌：带数字的查询在那里一律是空列表（3.2）。

**已知不处理**：简繁转换（`福满大厦` 与 `福滿大廈` 差两个字，超出容错），以及同音字。真要放宽，得另有一份对照表，不能靠调阈值。

### 3.2 房屋委员会名册（`docs/ha_hahdweb_dataspec.pdf`）

**先纠正一件事**：这份 PDF 介绍的不是 ALS，是房屋委员会（Hong Kong Housing Authority）的「Location and Profile of Public Housing Estates」，托管在 data.gov.hk「Housing」类。它和 ALS 是两回事：

| | ALS（默认） | HA 名册（可选） |
| --- | --- | --- |
| 是什么 | 地址／门牌查询 | 公共屋邨、居屋、商场、工厂大厦的**整份名册** |
| 覆盖 | 全部已登记处所，**含私人楼宇** | 只有公共房屋 |
| 有没有查询参数 | 有（`q`、`n`） | **没有**：一次回全部 |
| 要不要 key | **不要**（2026-11-02 实测） | **不要**（规格书：Requires authentication: No） |
| 粒度 | 逐座／逐幢，各有座标 | 整个屋邨一个座标 |
| 今天能不能用 | **能** | **能** |

因此 **ALS 是默认来源**；HA 名册保留为 `PLACE_PROVIDER=ha` 的备选——它给的是屋邨层面的一个点，适合「只想标出这条邨」，但私人楼宇完全搜不到。

#### 3.2.1 端点与实测（2026-11-01 实际调用）

```
https://data.housingauthority.gov.hk/psi/rest/criteriafilter/{resource}/{lang}/json
resource: prh-estates | hos-courts | shopping-centres | flatted-factory
lang:     en | tc | sc
```

| 实测项 | 结果 |
| --- | --- |
| 是否需要 key | **不需要**，直接 200 |
| 各资源笔数 | `prh-estates` 245、`hos-courts` 245、`shopping-centres` 56、`flatted-factory` 2 |
| 座标 | 全部在 WGS84 香港范围内（纬 22.20–22.51、经 113.87–114.27），无缺座标 |
| 单次体积 | 每资源每语言约 200–300 kB |
| 更新频率 | data.gov.hk 页面写「As and when there are new entries or records」 |

#### 3.2.2 规格书与真实响应的四处出入（都已实测）

规格书写得很清楚，但线上行为有四处不一样。**按规格书写会出错**，所以实现按实测写：

1. **字段命名不一致**：`prh-estates` 回 PascalCase（`Estate_Name`），另外三个资源回 snake_case（`estate_name`）。实现两种拼法都读。
2. **不是数据字典里的嵌套结构**：数据字典描述 `{ "en": …, "zh-Hant": … }`，实际是**一条语言一个 URL**，每行只有一个语系的平铺字符串。实现按语言分别取。
3. **未知资源／语言回 `200` + 空 body**，不是规格书承诺的 `400`。空 body 若当成「没有结果」，会把「配置写错了」伪装成「香港没有这幢楼」。实现把空 body 判为 `502`。
4. **格式后缀被忽略**：`/xml` 回的是 XML、`/csv` 回的是 CSV，但 `Content-Type` 一律写 `application/json`。**不能信 header，要读 body。**

另外两点影响实现：

- `Cache-Control: no-cache`，等于每次都回源。名册一天才变几次，所以**服务器自己缓存 24 小时**（`HA_CACHE_MS`），冷启动约 180 ms（四个请求并行），暖查询 0–1 ms。
- 名称里可能有全角空格：实测 `嘉田苑　　`（U+3000）。比对前统一 `NFKC` + 去空白，否则人手打「嘉田苑」永远搜不到。

#### 3.2.3 搜索怎么做

名册没有查询参数，所以**词在服务器这边比对**：

1. 取 `prh-estates` 与 `hos-courts` 的繁体（`tc`）与英文（`en`）共四份，按座标配对（今日两语顺序一致，但不依赖顺序）。
2. 词做 `NFKC` + 去空白 + 小写后，比对**中文名与英文名**：`德朗` 与 `Tak Long` 都能找到德朗邨。
3. 排序：以该词开头的优先，其次名字短的在前。
4. 结果与 ALS 同一格式 `{id, name, address, lng, lat}`；`address` 由来源的「区域 · 分区」拼成（例：`九龍 · 九龍城`），**不是街道门牌，也不替它补门牌**。

英文那半失败时只用中文名继续（有降级、不静默）；繁体那半失败就报错，不回空列表。

#### 3.2.4 边界

- 只搜住宅资源；`shopping-centres`、`flatted-factory` 默认不搜，需要时改 `HA_RESOURCES`。
- 切到这个来源时**私人楼宇搜不到**，面板会照常提示「可換個名稱再試，或直接在地圖上點選」。默认的 ALS 没有这个限制。
- 名册是参考位置，不是记录：名称、地址预填后仍由人确认，与原路径一致。
- 使用前应核对 data.gov.hk 的使用条款与署名要求；本文只记录「免 key、可访问」，不宣称条款已审阅完毕。

### 3.3 流程

```
搜索框（Enter / 按鈕）
  → 结果列表（名称 · 地址 · 距离）
  → 选中：地圖飛到座標 + 匹配 OSM 輪廓
  → 預填「大廈名稱」「地址」
  → 人確認 → 走原有 addBuilding
```

- 搜索框放在 `AddBuildingPanel` 顶部（`src/map/AddBuildingPanel.tsx`），在「在地圖上點一下」提示之前。
- 搜到的**地址默认填进「地址」栏**；名称同样预填，两个字段都可改。
- 选中后复用现有的 `picked` 状态与 `seedRing` / `buildingInput` 逻辑，不新建第二条写入路径。

### 3.4 决策：Google 先不接，槽位留着（2026-11-01）

按第 1 节的结论走：ALS 主、OSM 补、Google 只外链，**本期不写 Google 的接入代码**。要改成接 Google，只有两条路，都需要先落实：

1. 取得 Google 的书面许可；
2. 换一家条款允许「存储 + 在自家地图显示」的地理编码服务，逐个核对条款。

槽位留在 `server/placeSearch.mjs` 的 `providers`：`PLACE_PROVIDER=google` 一律回 `501` 并说明「條款不允許把它的名稱、地址和座標長期存進工作區」，不会静默走到 ALS，也不会假装搜过。以后换源只改这一个注册表和 `.env`，路由、开关、面板都不用动。

### 3.5 防重与命名

- 结果落在已有大厦 15 米内 → 提示「這幢好像已存在：×××」并给跳转，**不直接新增**。
- 名称比对先做空白规范化（CLAUDE.md 第 4 节「名称里的空格不是身份差别」）。
- 搜索结果里没有坐标的条目不得展示为可选（宁可不给，也不猜位置）。

## 4. 服务器与开关

按 CLAUDE.md 第 6 节：把查询送到新的外部服务属于「数据送到新地方」，必须用服务器开关、默认关闭、服务器端也拦。

- 新增开关 `placeSearch`：`scope: 'org'`、`who: 'platform'`，与 `workspaceSync` 同一档（`server/features.mjs`）。
- 新增 `GET /api/place-search?q=`，走 `server/http.mjs` 现有登录闸：
  - 未登录 `401`；开关关闭 `403`；查询过长或为空 `400`；超频 `429`；上游失败 `502` 并带可读原因。
  - **查询文本不进审计、不进日志**：用户可能把「5樓B室」打进搜索框。
- ALS key 只在服务器 `.env`，绝不进浏览器。
- 开关关闭时前端不渲染搜索框（服务器仍拦，二者同时成立）。
- 来源由 `PLACE_PROVIDER` 选择：`als`（默认）或 `ha`；`google` 回 `501`。ALS 不做服务器缓存（上游写 `private`）；HA 名册缓存在服务器内存，一天重取一次——**缓存的是公开名册，不是工作区资料**，不涉及 CLAUDE.md 3.6 的加密清单。

## 5. 记录来源

可选给 `Building` 加 `locatedBy: { provider, at }`，只记来源与时间，**不存原始查询文本**。

- 需要同步改 `src/domain/schema.ts` 与相关测试。
- **本期不做（2026-11-01）**：搜索只影响预填，不影响记录本身；加字段就要动 schema、加密清单与旧资料兼容，属于另一件事，不塞进这一个 PR。真要做时按 CLAUDE.md 3.6 评估 `provider`／`at` 是否算「描述人的字段」（不加密，只记来源）。

## 6. 分阶段

| 阶段 | 内容 | 产出 | 状态 |
| --- | --- | --- | --- |
| 0 | 接口核实：curl 打 ALS，确认返回结构、坐标系、配额、中英文与真实命中率；复核 Google 条款原文并摘录 | 结论写进本文件第 1、3 节 | **完成**：ALS 在 `www.als.gov.hk` 实测可用（3.1.1、3.1.2）；HA 的四处规格出入也实测（3.2.2） |
| 1 | 纯函数层 `src/map/placeSearch.ts`：结果标准化、去重判断；夹具测试 | 命中 / 无结果 / 超时 / 缺坐标四类样例 | 完成（`src/map/placeSearch.test.ts`，16 项） |
| 2 | 服务器代理 + `placeSearch` 开关 + 限流 + 测试 | 未登录 / 开关关 / 超长 / 超限 / 上游失败 | 完成（`server/placeSearch.mjs`、`server/placeSearch.test.mjs` 50 项、`server/auth.test.mjs` 路由 1 项） |
| 3 | UI 接入：面板顶部搜索框、结果列表、选中后预填；手机宽度与键盘可达 | — | 完成 |
| 4 | 回归：`typecheck / lint / test / test:auth / build` | 五项全绿 | 见第 9 节 |

阶段 0 不通过（例如 ALS 命中率太低或拿不到响应）就不动 UI，先回来重新选源——本周期的例外是：域名故障属于「无法核实」而非「核实为不可用」，所以按可证伪的方式先把上下游做好，**开关默认关闭**，真实响应到手前不对同事开放。

## 7. 验收

- 搜真实大厦名有结果；无结果时说清原因并指向「在地圖上點選」。
  - **2026-11-02 实测通过**：`德朗邨` → 德瑜楼／德珮楼……（逐座，带座数与门牌）、`太古城` → 太古城中心／太湖阁……、`百德新街` → 百德大厦等、`Tak Long` → 德朗邨各座、`梨木樹邨`、`香港仔大道` 都有结果。
  - **私人楼宇已覆盖**：`太古城` 这类私人屋苑能搜到；换成 `PLACE_PROVIDER=ha` 时才只剩公共房屋。
  - **无关词不得冒充结果**：`不存在的地方`、`zzzzqqqqxxxx` 必须回空列表（3.1.3）。
  - **打错或漏一个字仍找得到**：`福滿大樓`、`福滿大屢`、`福滿廈` → 福滿大廈；`德朗村` → 德朗邨；同时不能把「富滿大廈」「樂滿大廈」一起拖出来（3.1.3）。
  - **名称和地址共用一个框**：`承啟道28號` 只回 28 号的处所，`德朗邨1座` 只回德瑜楼，`下鄉道3號`（服务无此门牌）回该街处所而不是空列表。
- 断网 / 超时 / 配额用尽 → 面板写明原因，**不阻塞**原有新增流程。
- 开关关闭时入口不出现；直接调接口得 `403`。
- 已有大厦 15 米内 → 提示疑似重复且不新增。
- 查询文本不出现在工作区、审计记录、服务器日志中。
- 底图上仍有 OpenStreetMap 署名（ODbL 要求）。

## 8. 未做

- 逐字联想、远处自动补全。
- 整条街 / 整个屋苑批量抓取。
- 把 Google 内容写进工作区（见第 1 节）；`providers.google` 只回 `501`。
- 用搜索结果自动建立楼层或单位。
- `locatedBy` 来源字段（第 5 节）。
- OSM Nominatim 补充源：第一期只接 ALS；槽位同样在注册表里，需要时再加。
- 服务器缓存 ALS 查询结果：上游写 `Cache-Control: private`，暂不跨用户缓存；实测单次 40–150 ms，还不需要。

## 9. 实现说明（2026-11-02）

### 9.1 代码位置

| 文件 | 作用 |
| --- | --- |
| `server/placeSearch.mjs` | 唯一对外请求的出口：两个来源（ALS、HA 名册）、超时、上限（8 条）、香港边界过滤、查询词比对（3.1.3）与去重、名册缓存与比对、`google` 槽位 |
| `server/placeSearch.test.mjs` | 50 项：ALS 的 `q`／`n`／JSON、真实响应结构（中英块顺序、`SuggestedAddress` 缺失、去重、XML 回退）、查询词拆分／容错／门牌与座数／`3樓` 不当门牌、超时／拒绝／密钥，以及 HA 的两种字段拼法／全角空格／中英匹配／缓存与过期／并发合并／空 body／越界／资源选择 |
| `server/http.mjs` | `GET /api/place-search`：开关 `403`、每账号 60 次 / 15 分钟、断线即中止上游请求、查询不落审计不落日志 |
| `server/features.mjs` | `placeSearch`：`scope: 'org'`、`who: 'platform'`、默认关闭 |
| `src/map/placeSearch.ts` | 浏览器侧：`readPlaces` 边界复检、`nearbyBuilding`（15 米）、`searchPlaces` |
| `src/map/placeSearch.test.ts` | 16 项：保留 / 丢弃、名称回退、重复判定、查询编码、短查询不打扰服务器、失败不被吞成「找不到」 |
| `src/map/AddBuildingPanel.tsx` | 面板顶部搜索框、结果列表、选中后 `pickAt` + 预填名称与地址、疑似重复提示与跳转 |
| `src/map/MapScene.tsx` / `src/app/App.tsx` | 按 `account.features.placeSearch` 决定是否把搜索能力交给面板 |
| `src/auth/AccountPanel.tsx` / `accountContext.ts` | 开关文案；平台管理员可切换，机构管理员只看到「已開啟的功能」 |
| `.env.example` | `PLACE_PROVIDER`（默认 `als`）／`ALS_ENDPOINT`／`ALS_API_KEY`（可留空）／HA 的 `HA_BASE`、`HA_RESOURCES` |

### 9.2 行为口径

- 选中结果 = 一次「在地图上点位置」：`pickAt` 复用同一套 `picked` / `seedRing` / `buildingInput`，不新建写入路径；轮廓仍由 `findOsmFootprint` 从底图匹配。
- 预填规则：**地址**取结果里的地址；**名称**只在名称为空时填入，不覆盖人已经打的字。
- 15 米内已有大厦 → 黄色提示「這個位置已有「××」，可能是同一幢大廈」＋「前往該大廈」；这是提示，不是阻止，能否新增仍由现有重叠检查决定。
- 失败一定说出来：上游连不上、超时、拒绝、格式认不出，面板显示服务器给的原因，并能继续用「在地圖上點選」。

### 9.3 用什么替身（`scripts/als-mock.mjs`）

**正常路径不需要替身**：ALS 和 HA 今天都能连，默认来源是 ALS（3.1.1）。替身只用于演练失败路径——上游 500、超时、返回无法识别的 body——不必拿真实服务做破坏性试验：

```bash
node scripts/als-mock.mjs          # 127.0.0.1:5199
# .env 加两行：
PLACE_PROVIDER=als
ALS_ENDPOINT=http://127.0.0.1:5199/lookup
```

替身按 2026-11-02 抓到的真实形状作答（`AddressLookupResult` + 中英两个语言块，问 JSON 就回 JSON），内容仍是合成的：`示範大廈`、`測試中心` 两笔，坐标在香港境内。`placeSettings` 只对 loopback 开明文 HTTP 例外：`http://127.0.0.1`、`http://localhost` 允许；其他任何明文 HTTP 端点仍然拒绝。三种失败：查询含「失敗」回 500、含「慢」拖 15 秒、含「壞」回一个不是地址答案的 HTML——分别对应面板上的三句不同提示。

替身只用于本机，**不得指向任何存有真实资料的部署**。

### 9.4 要不要申请、怎么配置

**不需要申请**。2026-11-02 实测：`https://www.als.gov.hk/lookup` 免 key、免登记，直接可查，连续 15 次未见限流。因此本项目**没有**「申请 ALS key」这一步，也不需要把任何凭据放进 `.env`。

仍然值得知道的三件事：

1. **若将来被限流或服务改版**（回 `401`／`403`／`429`），面板会直接写出上游状态码。那时先问数字政策办公室（DPO，前 OGCIO）`enquiry@digitalpolicy.gov.hk`：现用端点、是否要登记、返回格式变更。
2. **旧域名不要再用**：`www.als.ogcio.gov.hk` 至今 NXDOMAIN。若有人按旧文件配置，把 `ALS_ENDPOINT` 改回 `https://www.als.gov.hk/lookup` 即可。
3. **使用条款**：正式上线前仍应核对 data.gov.hk／ALS 的使用条款与署名要求。本文只记录「免 key、可访问、实测可用」，不宣称条款已审阅完毕。

**项目这边怎么发请求**：浏览器永远不直接打外部服务，只调自家 `GET /api/place-search?q=`；服务器 `server/placeSearch.mjs` 才对外发请求。所以：

- 换来源 = 改 `.env` 的 `PLACE_PROVIDER`（`als`／`ha`），不用改代码。
- 换端点 = 改 `.env` 的 `ALS_ENDPOINT` 或 `HA_BASE`，不用改代码。
- 想多搜 HA 的商场／工厂大厦 = 改 `HA_RESOURCES`。
- `ALS_API_KEY` 留空即可；留空表示不送 `Authorization` 头，**不是**「不能搜」。

### 9.5 回归结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 0 error（5 条既有的 `react-refresh` warning 在 `AiAssistantDialog.tsx`） |
| `npm run test` | 997 通过；`src/styles.test.ts` 仍因中文路径百分号编码报 `ENOENT`（在干净 HEAD 上同样失败，属环境问题） |
| `npm run test:auth` | 124 通过（含 `server/placeSearch.test.mjs` 50 项） |
| `npm run build` | 通过（地图分包 962 kB，未因搜索增加明显体积） |

另做了一次**真实链路核对**：用临时数据库启动服务器，走完整的 `GET /api/place-search`——
开关关闭时 `403`；平台管理员开启后，`德朗邨`、`太古城`、`Tak Long` 都返回真实结果，`不存在的地方` 返回空列表，一个字的查询返回 `400`；整段操作记录里搜不到查询文本。
