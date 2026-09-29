# 着色状态管线 · 目标成果设计（定稿）

> 目标读者：后续执行的 Agent。本文只定义「要改成什么」与验收标准，不含实现步骤。
> 所有「待决策」项已与负责人确认并写入正文。
> 仓库根：`Careflow-Atlas` @ `main`

**范围声明**：本文档以**着色管线与层级标签**为主。会议提出的「简化 schema / 合并记录维度」**不在本次执行范围**，仅在第 9 节留待决清单，须与 aa 讨论后才能定稿。
**优先级提示**：NGO 试用在即，本改动是解锁试用的前置项。
**流程约束**：本设计产出的代码必须经人工验证后才能交付 NGO。AI 生成的 UX/交互逻辑尤其需要人工复核易用性与学习成本。

## 0. 2026-09-29 修订（负责人审核 4b343de 后的裁决，与下文冲突时以本节为准）

本节记录负责人逐项试用 `4b343de` 后作出的决定。下文各节保留作为原设计记录；凡与本节冲突之处，**以本节为准**，对应段落已在此注明被取代。

| # | 裁决 | 取代的原文 |
| --- | --- | --- |
| R1 | 录入表单只保留三个覆盖选项。界面标签改为与选项一致：`ATTEMPTED` 显示「未能完成探訪」，`VISITED_NO_FINDING` 显示「已完成探訪」；较早记录的 `PARTIAL`／`INACCESSIBLE`／`VISITED_WITH_FINDING` 保留原有更细的措辞。旧标签「曾嘗試」「已訪，無記錄發現」进入 `retiredLabels`，仍可导入。纸本／Excel 措辞不变。 | §7.1 覆盖标签表 |
| R2 | 接触结果不再询问，**也不再自动写入**。新记录的 `contactOutcome` 留空：没有人确认过的值不是事实（`CLAUDE.md` §4「覆盖、接触结果、住房判断相互独立」）。管线把空值与原先派生的值读成同一颜色，所以颜色不变。 | 4b343de 提交说明中「derived via impliedByCoverage」 |
| R3 | 住房判断**不设**「其他」自由文字。它是固定等级，必须可检索；补充说明写在「觀察／發現」或「證據說明」。资料来源与跟进类别仍保留「其他」。 | §10.1 住房判断一行的自由填写 |
| R4 | 自订常用选项从录入表单移出，放到「工作台設定 › 高級設定」。表单里只保留「覆蓋狀態原話」。 | §10.4 选项管理的位置 |
| R5 | 跟进可在工作台直接「標記完成」或「取消跟進」（取消须写原因），**不产生新的探访记录**。记录操作人（登入帐号，不是纸本工作员）与操作时间；可「撤銷」，撤销是追加一条 `REOPENED` 事件，不删除原事件。事件存于 `snapshot.followUpEvents`，随「關聯封存」进出 Excel，并另有只读的「跟進處理」工作表。纸本路径的「結束跟進編號」保持不变。 | 无（新增） |
| R6 | 打开大厦后，大厦层面的待跟进固定显示在面板顶部，不随所选楼层或单位消失。 | §3.5 未覆盖此情形 |
| R7 | 楼层**没有自身记录**：楼层颜色只是其单位的汇总（再按 R8 处理未完成任务）。录入不产生楼层记录；Excel 回录中「有楼层、没有单位」的行标为错误：「請填單位；如果是整棟的情況，樓層留空。」旧数据中若已有楼层记录，只作历史显示，并在历史中标明所属楼层。大厦仍按 §3.3 与其楼层汇总按时序竞争。 | §3.3 楼层的时序竞争、§3.2「三层共用」中楼层读自层记录的部分 |
| R8 | 保留「有未完成任务就不是绿色」（`withOpenTasks`）：节点本应为绿、但其下仍有未完成任务时显示黄。红与灰不受影响。 | §11「`followUps > 0` 不得单独改变任何层级的底色」 |
| R9 | 手动 Tag 是**独立标记**：只在被标记的大厦／楼层旁显示旗标，**不改变任何颜色、不向下级联、不参与汇总**。 | §4 全节的级联染黄、红色豁免与向上传播；§11 中对应验收项 |
| R10 | 3D 地图的楼层标签右侧显示构成（每种状态一个色点加数量）；右侧面板不显示。 | §3.5「构成明细」的位置 |

### 验收方式

每条裁决都有回归测试（`src/domain/state.test.ts`、`src/domain/followUpEvents.test.ts`、`src/components/labels.test.tsx`、`src/map/mapModel.test.ts`、`src/app/store.test.ts`），并须按场景在页面上人工走一遍后才交付 NGO。

## 1. 背景与目标

当前「全视图 → 楼栋 → 楼层 → 房间单元」的着色逻辑分散在三个文件、且不同层级用不同规则，颜色在不同缩放维度下不一致。

本设计把着色收敛为**单一四态模型**，并定义**自底向上的聚合规则**，使单元（room）、楼层（floor）、楼栋（building）在任意维度用同一套语义、同一套颜色。另新增**楼层/楼栋级统一 tag**，支持对整层/整栋快捷着色。

## 2. 现状梳理（供对照）

### 2.1 现有数据模型（`src/domain/types.ts`）

`Observation` 携带三条**互相独立**的轴：

| 字段 | 枚举 | 语义 |
| --- | --- | --- |
| `coverage` | `UNKNOWN` / `UNVISITED` / `ATTEMPTED` / `PARTIAL` / `VISITED_NO_FINDING` / `VISITED_WITH_FINDING` / `INACCESSIBLE` | 覆盖状态（本次探访做到哪一步） |
| `contactOutcome` | `NOT_ATTEMPTED` / `NO_ANSWER` / `DECLINED` / `CONTACTED` / `UNKNOWN` | 接触结果（是否接触到人） |
| `followUp` | `status: OPEN/DONE` + `category`（GENERAL/HOUSING_CHANGE/HEALTH_SUPPORT/SERVICE_INVITATION）+ `action`/`dueDate`/`assignee`/`timingNote` | 可选跟进任务 |

关键既有函数：
- `effectiveObservations(snapshot)` — 排除被更正事件后的有效观察集。
- `getOpenFollowUps(snapshot)` — 返回所有仍 OPEN 且未被 resolve 的跟进（含 `unitId`/`floorId`/`buildingId`/`action`/`dueDate`）。
- `compareObservationTime(a, b)` — 按「发生时间 → 录入时间」比较，用于取 latest。

### 2.2 现有着色逻辑（将替换）

- 单元：`getCoverageStatus` 取最新观察的 `coverage` → `coverageColors`（7 色）。
- 楼层/楼栋：`getCoverageSummary` 派生 7 态，但 `src/app/App.tsx:67` 与 `src/map/mapModel.ts:56` 在 `followUps > 0` 时**无条件覆盖为琥珀色**，与单元色不同源。
- 颜色表在 `src/domain/presentation.ts`；「待跟進」图标（`RotateCcw`）在楼层条、单元格、大廈列表三处各自渲染。

## 3. 四态判定（定稿）

### 3.1 四态语义

| 态 | 语义 |
| --- | --- |
| `GREEN` 绿 | 已完成探访、有记录，且无 OPEN 跟进 |
| `YELLOW` 黄 | **需留意**。有兩義，見 §3.5 —— 單元層＝有 OPEN 跟進；聚合層＝子狀態混雜（可能無任何跟進） |
| `RED` 红 | 探访失败（无应答/未能进入），或已接触但未完成且无跟进 |
| `GRAY` 灰 | 未探访 / 未知 |

### 3.2 单元判定函数（规范）

以「最新有效观察」为准（latest-wins，沿用 `getCoverageStatus` 语义），无观察即灰。

```ts
type State = 'GREEN' | 'YELLOW' | 'RED' | 'GRAY';
type Scope = { buildingId: string; floorId?: string; unitId?: string };

/** 取某范围的「最新有效观察」。scope 逐级收窄：三层共用同一个函数。 */
function latestInScope(snapshot, scope: Scope): Observation | undefined {
  return effectiveObservations(snapshot)
    .filter(o => o.buildingId === scope.buildingId
      && (scope.floorId === undefined || o.floorId === scope.floorId)
      && (scope.unitId  === undefined || o.unitId  === scope.unitId)
      // 「无子范围」的节点级记录：楼栋级须无 floorId/unitId，楼层级须无 unitId。
      && (scope.unitId  !== undefined || o.unitId  === undefined)
      && (scope.floorId !== undefined || o.floorId === undefined))
    .reduce<Observation | undefined>((latest, cur) =>
      !latest || compareObservationTime(cur, latest) > 0 ? cur : latest, undefined);
}

/** coverage + hasOpen → State。三层共用。scope 决定读哪一级的记录。 */
function stateOf(snapshot, scope: Scope, hasOpen: boolean): State {
  const obs = latestInScope(snapshot, scope);
  if (!obs) return 'GRAY';                                // 该范围完全没有记录
  switch (obs.coverage) {
    case 'UNKNOWN':
    case 'UNVISITED':                                     return 'GRAY';
    case 'VISITED_NO_FINDING':
    case 'VISITED_WITH_FINDING':                          return hasOpen ? 'YELLOW' : 'GREEN';
    case 'PARTIAL':                                       return hasOpen ? 'YELLOW' : 'RED';
    case 'ATTEMPTED':
    case 'INACCESSIBLE':
      return obs.contactOutcome === 'CONTACTED' ? (hasOpen ? 'YELLOW' : 'RED') : 'RED';
  }
}
```

**实现须知（伪代码不是最终签名，Agent 须按此落地）**：
- `latestInScope` / `stateOf` 是**新写的**，仓库中不存在。现有可复用的零件：`effectiveObservations`（已导出）、`compareObservationTime`（已导出）、`latestObservation`（[types.ts:145](src/domain/types.ts#L145)，**私有未导出**，需自行导出或内联其 reduce）。
- 过滤条件必须带 `buildingId`（现有 `getCoverageStatus` 即如此），不能只按 `unitId`。
- **三层共用同一函数**：单元传 `{buildingId, unitId}`，楼层传 `{buildingId, floorId}`，楼栋传 `{buildingId}`。这正是「统一着色逻辑」的落点 —— 不得为每层各写一套 switch。
- 节点级记录的范围收窄是刻意的：楼栋级记录必须无 `floorId`/`unitId`，楼层级记录必须无 `unitId`，否则会串味（这正是现有 `getCoverageSummary` 里 `!item.floorId && !item.unitId` 的用意）。
- `hasOpen` 由调用方按 scope 算出：单元级传 `f.unitId === unitId`，楼层级传 `f.floorId === floorId`，楼栋级传 `f.buildingId === buildingId`。

**决策依据（已确认）**：
- 红判定用两轴结合：`coverage ∈ {ATTEMPTED, INACCESSIBLE}` 且 `contactOutcome ≠ CONTACTED`（即未接触到人）才判失败。
- 中间态（`PARTIAL`，或 `ATTEMPTED/INACCESSIBLE + CONTACTED`）：有跟进 → 黄，无跟进 → 红。
- 失败 + 有 OPEN 跟进：**红优先**，跟进以徽章显示，不改变底色。
- 灰 + 有 OPEN 跟进：**灰优先**，跟进以徽章显示，不改变底色（见第 5 节）。
- **hasOpen 是判定输入，不是覆盖开关**：它只在 `VISITED_*`、`PARTIAL`、`ATTEMPTED/INACCESSIBLE+CONTACTED` 三种情况下参与决定黄/绿或黄/红；在红与灰两种情况下**完全不改变底色**。
- **层级级跟进不标记单元**：挂在楼层级/楼栋级观察上的跟进（无 `unitId`）不会让任何单元变黄，这是**故意设计**——层级意图走第 4 节的 tag 通道，不是本函数的漏洞。Agent 不得为「修好」这点而让单元级判定去匹配 `floorId`/`buildingId`。
  （注意与 §3.3 的时序竞争区分：层级跟进仍然会让**该层级节点自身**的 `stateOf` 产生黄，只是不向下污染单元。）

### 3.3 层级聚合函数（规范）

```ts
function aggregate(states: State[]): State | undefined {
  if (states.length === 0) return undefined;                 // 交由上层 fallback
  if (states.every(s => s === states[0])) return states[0];  // 全部同色 → 该色
  return 'YELLOW';                                           // 任何异色 → 黄
}
```

等价于负责人原规则：
- 楼层只含绿 → 绿；有绿 + 黄/红/灰 → 黄；只含黄/红/灰且同色 → 对应色；黄/红/灰混搭 → 黄。
- 两个显式子情形（按原规则均落黄，已确认）：`绿+红 → 黄`、`红+灰 → 黄`。

> **已裁决的歧义：黄优先于灰。**
> 2026-09 会议记录中出现过「灰色优先级比黄色高」「黄色不会覆盖灰色」的说法，与本节规则冲突。
> 负责人已确认**以本文规则为准：异色即黄，黄压过灰**。即一个楼层里只要有任一单元是黄的，该层即显黄，即使同时存在未探访（灰）的单元。
> 后续 Agent 不得以会议记录为由改回「灰优先」。

**层级判定 = 自层显式记录 与 子单元聚合 按时序竞争（非纯 fallback）**

> **已裁决**：节点自身级显式记录与子单元聚合结果**按时间比较，新的胜出**。这保留了今日 `getCoverageSummary` 的行为（`types.ts:169`），也符合领域里「occurredAt → recordedAt」的 latest-wins 原则。
>
> **修正说明**：本设计早期草稿曾写成「节点记录仅在无子单元时作 fallback」，那会导致**一栋已声明单位、但整体未能进入的大厦显示灰色**——楼栋级 `INACCESSIBLE` 记录被整个丢弃，而今日代码会正确显示红棕。那是改造引入的退步，已作废。

```ts
function nodeState(snapshot, scope, childStates: State[], childLatest?: Observation): State {
  const own = latestInScope(snapshot, scope);                    // 该节点自层记录（范围收窄，见 3.2）
  const aggregated = aggregate(childStates);                     // 子单元/子楼层聚合
  if (!own) return aggregated ?? 'GRAY';                         // 无自层记录 → 用聚合（可能为空）
  if (!childLatest) return stateOf(snapshot, scope, hasOpenFor(scope));   // 无子记录可竞争 → 自层记录胜出
  return compareObservationTime(own, childLatest) >= 0
    ? stateOf(snapshot, scope, hasOpenFor(scope))                // 自层记录更新 → 自层胜出
    : aggregated ?? 'GRAY';                                      // 否则用聚合
}
```

- `childLatest` 为**子范围中最新的一条记录**（按 `compareObservationTime`），与今日 `getCoverageSummary` 的 `latestChildRecord` 同义。
- 竞争只发生在「有自层记录」时；无自层记录一律用聚合结果，不做任何覆盖。
- **不得**改成「自层记录优先」或「聚合优先」的单纯覆盖 —— 必须是时序竞争，否则会重现退步。

### 3.4 四态颜色（默认值，语义必须唯一，视觉值可调）

| 态 | 建议 hex | 说明 |
| --- | --- | --- |
| `GREEN` | `#4c9f70` | 完成 |
| `YELLOW` | `#d4a35e` | 复用现有琥珀 |
| `RED` | `#c0564f` | 失败 |
| `GRAY` | `#acb8b2` | 复用现有灰 |

颜色集中在 `src/domain/presentation.ts` 新增 `stateLabels` / `stateColors`（单一来源），替换现有 7 态颜色表在着色处的使用（7 态 label 仍可用于历史/详情展示）。

### 3.5 黄色的两义与文案（定稿）

**黄色有 6 条产生路径，分属两种语义。** 这是本设计里唯一「一色两义」之处，必须显式处理，否则图例文案会误导。

| # | 层级 | 条件 | 语义 |
| --- | --- | --- | --- |
| 1 | 单元 | 已访（`VISITED_NO_FINDING`/`VISITED_WITH_FINDING`）+ 有 OPEN 跟进 | 有跟進 |
| 2 | 单元 | `PARTIAL` + 有 OPEN 跟进 | 有跟進 |
| 3 | 单元 | `ATTEMPTED`/`INACCESSIBLE` + `CONTACTED` + 有 OPEN 跟进 | 有跟進 |
| 4 | 楼层/楼栋 | **子狀態聚合異色**（§3.3 `aggregate`） | **狀態混雜（可無任何跟進）** |
| 5 | 楼层/楼栋 | 自層記錄按時序勝出，且滿足 #1–#3 | 有跟進 |
| 6 | 楼层/楼栋 | 手動 tag（§4） | 人工標記需跟進 |

**問題**：#4 與 #1–#3 不是同一個意思。一層樓「A 單元綠（已訪、無跟進）+ B 單元灰（未訪）」→ 聚合異色 → 黃，**但該層沒有任何待辦**。而圖例現寫「待跟進」，會直接誤導。

> **這不是邊緣情況，而是最常見的情況** —— 任何部分完成的樓層都是「綠 + 灰」→ 黃。真實資料裡大多數黃色都會是 #4（混雜）而非 #1–#3（待辦）。

**裁決：黃色在所有層級統讀作「需留意」。**

- 顏色**不變**（仍是一個黃，四色模型不動）—— 符合負責人「顏色在不同維度下統一和諧」的目標。
- **「有跟進」的具體含義由徽章承擔**（§5.1）。判別方式：**黃 + 徽章 = 有跟進（#1–#3、#5、#6）；黃無徽章 = 狀態混雜（#4）**。
- 這正是 §5「標記與顏色解耦」的又一次應用：顏色回答「要不要留意」，標記回答「留意什麼」。

**文案要求（必改）**：
- 地圖圖例（`MapScene.tsx:360`）現為「琥珀 = 待跟進」——**必須改**，不得再讓圖例把黃色等同於待跟進。改為涵蓋兩義的措辭（如「需留意」）。
- 樓層 hover／`aria-label`（`MapScene.tsx:177`、`:336-337`）的「待跟進」由 `hasFollowUp` 驅動（**真實有跟進**），語義正確，**保留**；它是疊加在顏色之上的額外標記，與解耦原則一致。
- 需為 #4 提供**構成明細**（hover／tooltip 顯示「2 綠 · 1 紅 · 3 未訪」），否則用戶看到黃色無徽章時無法得知原因。這是「需留意」可操作的前提。

## 4. 楼层/楼栋统一 tag / 向下同步标签（定稿）

> 术语对齐：会议称此为「从大楼/楼层向下同步标签」（为低概率的整栋、整层事件预留）。**主入口仍以单位记录为主**，层级标签是补充通道，不是替代。

- **粒度**：楼层、楼栋两级。
- **语义**：手动打「需跟进」标签，**向下同步**着色 —— 楼层节点着色，且其下所有单元一致显示黄；楼栋节点着色，且其下楼层/单元一致显示黄。可一键清除。
- **仅展示层**：标签只影响显示，**不写入**任何单元的观察记录。真实 `stateOf` 不被标签改写（历史、详情、导出仍呈真实数据）。
- **颜色范围**：仅「黄（需跟进）」+ 清除。红/灰由真实数据自然决定，不支持手动标红/灰。
- **存储**：作为层级属性持久化（不写入每条观察），与真实逐单元记录区分。建议在领域类型上新增 `tag?: 'FOLLOW_UP'`（`Floor` 与 `Building` 各加一个可选字段）；正式库迁移时随 snapshot 一起落库。
- **覆盖关系**：手动 tag 覆盖该节点聚合计算结果；清除后回到聚合色。
- **向上传播**：无需特殊处理 —— 被打黄的楼层参与楼栋聚合，自然使楼栋变黄（异色→黄）。
- **级联展示**：被打黄节点的子单元在 UI 上按「tag 黄」显示，但**不改变其真实 `stateOf`**（历史/详情仍显示真实状态）。以 `effectiveState` 区分「展示态」与「真实态」。

**红色豁免（定稿）**：`RED` 是「探訪失敗」，比人工標記更重要，**不得被 tag 掩蓋**。tag 級聯對紅單元無效：

```ts
// 展示態：tag 只在節點計算態不是 RED 時才染黃。
function effectiveState(node): State {
  const computed = computedState(node);                     // §3.2 stateOf / §3.3 nodeState
  return node.tag === 'FOLLOW_UP' && computed !== 'RED' ? 'YELLOW' : computed;
}
```

- 適用於**所有層級**：不只是子單元，節點自身亦然。若某樓層的計算態是紅（如自層「未能進入」記錄按時序勝出），打 tag 後**仍顯示紅**。
- **tag 仍然成立且可見**：用戶打了 tag 卻見底色不變時，必須能看到 tag 已設定 —— tag 以**徽章／標記**形式顯示於節點上，並可正常清除。不得因底色不變而讓用戶以為操作失敗。
- 這與 §5 的原則一致：底色回答「要不要留意」，標記回答「留意什麼」。紅底 + tag 標記 = 「這層失敗了，而我另外標了要跟進」。
- 副作用（可接受）：若某層全部單元皆紅，該層在 tag 下仍顯紅，樓棟聚合也因此不受該層的 tag 影響 —— 這是正確的，紅的訊息量高於人工標記。

## 5. 标记与颜色解耦（定稿）

> **核心原则：标记由各自的事实驱动，与底色无关。** 底色只回答一个问题——「这次探访成不成」；其他事实（还有没有事要做、有没有线索）由标记回答。两者分开显示，互不覆盖。
>
> 这条原则是针对今日代码缺陷的正面修正：今天 `followUps > 0` 会把底色整个覆盖成琥珀，用**一个信号**同时表达「探访结果」和「待办事项」两件事，结果是任何一维的信息都会被另一维吃掉。解耦后两个维度各自完整。
>
> **同理，四态是有损的**：底色的四个值无法表达「已访有线索（疑似劏房）」与「已访无发现」的差别（今天靠两个深浅不同的绿勉强区分）。因此线索必须由标记承担，不能指望底色。

本节定义两类标记：**跟进徽章**（5.1）与**线索标记**（5.2）。

### 5.1 跟进徽章

由「是否有 OPEN 跟进」驱动，与底色无关。

- 触发条件：该单元存在 OPEN 且未被 resolve 的跟进（`getOpenFollowUps` 匹配到该 `unitId`），**不管底色是绿、黄、红还是灰**。
- 内容：跟进类别徽章（四类：一般跟進/住屋變動/健康關懷/服務邀約，各配图标）；`hover`/`title` 显示 `action` / `dueDate` / `assignee`。
- **类别兜底**：`followUp.category` 在类型上是**可选**的（`category?:`），演示与导入数据中确实存在无类别的跟进（如 `demoFixture.ts:39`、`:49`）。无类别时显示通用「待跟進」徽章，**不得**默认成「一般跟進」——那会把「未分类」伪装成「已分类为一般」。有多个 OPEN 跟进时按类别去重后并列显示。
- 各底色下的表现：
  | 底色 | 徽章 | 说明 |
  | --- | --- | --- |
  | 黄 | 显示 | 徽章即黄色的成因，两者一致 |
  | 红 | 显示 | 红优先，跟进不改变底色（见 3.2） |
  | **灰** | 显示 | 底色保持灰（未探访过是事实），但跟进任务必须可见，不得被灰吞掉 |
  | 绿 | 理论上不出现 | 绿的定义即「无 OPEN 跟进」；若出现说明数据异常，仍须显示徽章而非静默 |
- 楼层条与大廈列表沿用同一徽章语言，保证跨维度一致。

### 5.2 线索标记

由「已探访且有线索」驱动，与底色无关。**解决四态有损问题**：绿色同时代表「已访无发现」与「已访有线索」，后者在列表扫视时不可见，而会议明确要求「保留必要复杂度以便快速检索，如是否有劏房」。

**住房判斷必须向前继承，不能读「最新观察」。** `assessment` 与 `coverage`、`contactOutcome` 相互独立（`types.ts:42`），且 `NOT_UPDATED` 的字面语义是「今次未更新住房判斷」。若读最新观察，则「上次記錄疑似劏房 → 今次探訪沒碰住房判斷」会导致线索标记消失，违反「觀察事件只追加、住房判斷相互獨立」的領域原則。

```ts
// 取最近一次真正做出住房判斷的觀察：跳過 NOT_UPDATED 與空缺。
// 與更正鏈同理——「沒做判斷的觀察退出候選集」。
function currentAssessment(snapshot, unitId): HousingAssessment | undefined {
  return effectiveObservations(snapshot)
    .filter(o => o.unitId === unitId && o.assessment && o.assessment !== 'NOT_UPDATED')
    .sort(compareObservationTime).at(-1)?.assessment;
}
```

- 触发条件（任一）：该单元最新有效观察的 `coverage === 'VISITED_WITH_FINDING'`，**或** `currentAssessment(snapshot, unitId) ∈ {'SUSPECTED', 'STAFF_VERIFIED'}`。
- **注意两者的时间基准不同且这是故意的**：`coverage` 取最新观察（本次探访做了什么），`assessment` 向前继承（住房判斷是关于该单元持续有效的结论）。Agent 不得为「统一」而把两者改成同一基准。
- **必须区分「疑似」与「已确认」两种变体**（这是网格层唯一能看到的住房信息，混为一谈会丢掉证据强度）：
  | 变体 | 条件 | 说明 |
  | --- | --- | --- |
  | 疑似 | `currentAssessment === 'SUSPECTED'` | 与现有 `cf-chip--uncertain` 的「未確定」语义对齐 |
  | 已确认 | `currentAssessment === 'STAFF_VERIFIED'` | 证据强度更高，视觉上须与「疑似」可区分 |
  | 有发现（无判断） | `coverage === 'VISITED_WITH_FINDING'` 且 `currentAssessment` 不触发 | 本次有记录发现，但住房判斷未升級 |
- 表现：底色之上加一个小标记（区别于跟进徽章；具体图标待定，须与跟进徽章在视觉上可区分）。`hover`/`title` 显示 `assessment` 的中文标签与观察备注。
- 与其他底色的组合：黄/红/灰底同样显示线索标记 —— 例如「失败 + 上次有线索」的历史不能被本次失败抹掉（沿用「观察事件只追加、互不覆盖」的领域原则）。
- **不得**用改底色或加第五种颜色来实现；四色不变。
- 与 `assessment` 语义保持一致：`NOT_UPDATED`（今次未更新）**退出候选集**（即向前继承，见上）；`NO_INDICATION`（今次未见迹象）、`UNKNOWN`（未能确定）**不触发**线索标记，避免把「不知道」或「已看過沒发现」显示成「有线索」。`NO_INDICATION` 视为对本单元住房判斷的明确结论，会覆盖更早的 `SUSPECTED`。

### 5.3 住房判断与资料来源的完整呈现（单元详情）

> **分工原则**：网格层（單位狀態）只给**标记**，不给全文；**完整**的住房判斷與資料來源在**选中单元后的历史卡片**（`ObservationHistory`）里看。这是已确认的分工，Agent 不得把住房判斷全文搬进网格（会推高视觉密度、违背会议「降低学习成本」的要求），也不得把历史 chip 删掉。

**保留现状**：`ObservationHistory` 已渲染 `workerName` / `coverage` / `contactOutcome` / `assessment` 四枚 chip（[ObservationHistory.tsx:26](src/components/ObservationHistory.tsx#L26)），住房判斷的五個值全部可見，`SUSPECTED`/`UNKNOWN` 帶 `cf-chip--uncertain` 樣式。**这套呈现是本设计的组成部分，必须保留。**

**新增：资料来源 chip**。`sourceType` 目前是「只写不读」字段 —— 表单可填、存库、导出 Excel，但**任何阅读界面都不显示**（组件层零渲染）。本设计要求把它加入历史 chip，与住房判斷并列：

> 效果：「居民口述 · 疑似劏房，尚待核實」与「工作人員觀察 · 疑似劏房，尚待核實」必须能一眼区分。
> 这是劏房场景的要害 —— 两者的证据强度差很远，而这正是 `SUSPECTED` → `STAFF_VERIFIED` 之间的关键差别。

- `sourceType` 為可選字段，空缺時**不顯示 chip**（與 `contactOutcome`/`assessment` 的現有處理一致），不得顯示成「來源未明」——「沒填」與「填了來源未明」是兩件事。
- chip 順序建議：`workerName` → `coverage` → `contactOutcome` → `assessment` → **`sourceType`**。

## 6. 单一标准与执行方式（硬约束）

> **核心要求：回溯检查时的标准，与执行时的标准，必须是同一份东西。**
> 若「判定规则」「颜色值」「标签文字」在多处各写一份，那么复查时读到的规则可能已经不是执行时用的那份，就必须**重新验证一遍**。本设计的全部目的即消除这种重复验证 —— 改完之后，回溯检查就是**跑既有的自动检查**，不是重读代码。

### 6.1 单一标准：四类着色全部源自一处

底色、徽章、标记、层级 tag **四类着色共用同一份定义**，不得各自为政：

| 要素 | 唯一定义处 | 所有消费方 |
| --- | --- | --- |
| 状态判定（`stateOf` / `aggregate` / `nodeState`） | `src/domain/types.ts` | 单元网格、楼层条、楼栋列表、地图楼层块、地图楼栋体、地图标记、全视图图例 |
| 四态颜色 `stateColors` | `src/domain/presentation.ts` | 同上全部 |
| 四态标签 `stateLabels` | `src/domain/presentation.ts` | 同上全部 |
| 跟进徽章类别 | `presentation.ts`（由 `supportCategoryLabels` 收编） | 单元格、楼层条、大廈列表 |
| 线索标记两级 | `presentation.ts` | 单元格（及需要标记的层级） |
| 层级 tag 色 | 复用 `stateColors.YELLOW` | 楼层、楼栋 |

- **禁止**在组件、地图模型、demo 数据里出现色值字面量（`'#d4a35e'` 之类）或状态标签字面量。
- **禁止**为「地图要深一点」「列表要浅一点」而另开一套色 —— 需要区分时用透明度/描边/尺寸，不改色值。视觉值本身只允许在 `stateColors` 里调一次。
- `MapBuilding.color` / `MapFloor` 的色也必须是**同源引用**，不得由地图层自行计算状态（地图层只接收已算好的状态色）。

### 6.2 让回溯检查自动化（而非人工复查）

单一定义处解决不了「有人又写死一份」的问题 —— 那需要**机器守门**。要求：

1. **语义断言用状态名，不用色值。** 判定测试断言 `expect(stateOf(...)).toBe('RED')`，**不得**断言 `expect(color).toBe('#c0564f')`。理由：状态名是语义契约（稳定），色值是视觉调参（会变）。这样调色不需要改测试，而语义回归仍然会被抓到。
2. **视觉断言引用常量，不引用字面量。** 若必须验证「单元格拿到了正确的颜色」，写 `expect(cellColor).toBe(stateColors.GREEN)`，**不得**写 `toBe('#4c9f70')`。理由同上：色值只有一处真源。
3. **新增自动守卫测试**（建议 `src/domain/presentation.test.ts` 或 `src/app/consistency.test.ts`）：
   - 扫描 `src/**/*.{ts,tsx}`（排除 `presentation.ts` 自身与测试夹具），断言**不出现十六进制色值字面量**。
   - 断言旧的重复标签表（`ObservationHistory.tsx` / `BuildingDetail.tsx` 内的 `coverageLabels` 等就地定义）**已不存在**。
   - 断言 `stateColors` / `stateLabels` 覆盖四态齐全，无缺漏。
4. 该守卫纳入 `npm run test`。**这样「回溯检查」= 跑测试**，任何人复查时看到的标准与执行时完全相同，无需再人工比對一遍代码。

> 这条是本次改造区别于「改完就算」的关键：如果只统一了定义、没加守卫，几周后又会有人就地写死一份色值，届时复查标准与执行标准再次分叉。

### 6.3 执行顺序：按文件一次改到底

**按文件改，一个文件里的颜色、标签、判定一起换完再动下一个**；不要按维度分几轮（先全改颜色、再全改标签）。

理由：本设计的四类着色耦合在同一批文件里。若分维度分批，中途会出现「颜色已统一、标签还是旧的」的半成品状态 —— 此时跑测试会看到部分通过、部分失败，无法判断是改造未完成还是改造出错，**反而制造了你要避免的重复验证**。

建议顺序（依赖方向由内向外）：
1. `src/domain/presentation.ts` — 四态定义、收编全部标签（§7.1）
2. `src/domain/types.ts` — `stateOf`/`aggregate`/`nodeState`，导出 `latestObservation`，`Floor`/`Building` 加 `tag?`
3. 领域测试（`types.test.ts` 等）— 状态判定回归
4. `src/map/mapModel.ts` → `src/app/App.tsx` → `src/components/BuildingDetail.tsx` → `src/components/ObservationHistory.tsx` → `src/map/MapScene.tsx`
5. 自动守卫测试（§6.2）
6. 全量 `npm run typecheck && npm run test && npm run lint`

每个文件改完即跑相关测试；**任一文件不得只改一半**。

## 7. UI 变更清单

| 位置 | 现状 | 目标 |
| --- | --- | --- |
| `src/domain/presentation.ts` | 7 态颜色表 | 新增四态 `stateLabels`/`stateColors`；并**收编标签的单一来源**（见下方「标签重复」） |
| `src/domain/types.ts` | `getCoverageStatus`/`getCoverageSummary` | 新增统一 `stateOf` + `aggregate`/`nodeState`（见 §3.2/§3.3），`Floor`/`Building` 加 `tag?`；导出 `latestObservation` |
| `src/map/mapModel.ts` | 楼层/楼栋色硬编码 + `hasFollowUp` | 统一读四态色；tag 黄参与 `MapFloor`/`MapBuilding` |
| `src/app/App.tsx` | 楼栋色 `followUps?amber:...` 覆盖 | 改用四态聚合色 + tag |
| `src/components/BuildingDetail.tsx` | 单元格 `cf-status-{coverage}` + 待跟進图标 | 四态色 + 跟进徽章（底色无关）+ 线索标记（疑似/已确认两级）；楼层/楼栋 tag 入口 |
| `src/components/ObservationHistory.tsx` | 4 枚 chip，**无 sourceType** | 新增资料来源 chip（§5.3）；标签改用单一来源 |
| `src/map/MapScene.tsx` | 图例 3 项（teal/amber/gray），琥珀文案為「待跟進」 | 图例 4 项（绿/黄/红/灰）；**琥珀文案改為涵蓋兩義的措辭**（§3.5），不得再等同「待跟進」 |

新增交互：楼层条、楼栋详情各加一个「标记整层/整栋跟进」与「清除标记」操作（tag 入口）。

### 7.1 标签重复（与着色同类的「不统一」，须一并收口）

同一枚举在仓库里有**多份互相冲突的中文标签**，同一个 `coverage` 值在不同界面显示不同文字：

| 枚举 | 定义处 | 冲突示例 |
| --- | --- | --- |
| `coverageLabels` | `presentation.ts:3`、`ObservationHistory.tsx:7`、`BuildingDetail.tsx:7` | `UNKNOWN` 三处三样：「暫無可靠記錄」/「覆蓋未明」/「未能確定」；`VISITED_NO_FINDING` 兩樣：「已查看・無發現」/「已訪，無記錄發現」 |
| `assessmentLabels` | `ObservationHistory.tsx:5`、`workflowFormat.ts:6` | `SUSPECTED`：「疑似劏房，尚待核實」vs「疑似，待核實」；`STAFF_VERIFIED`：「由工作人員確認」vs「工作人員已確認」 |
| `contactLabels` | `ObservationHistory.tsx:6`、`workflowFormat.ts:5` | `UNKNOWN`：「接觸結果未明」vs「未能確定」 |
| `sourceLabels` | 仅 `workflowFormat.ts:7` | 无冲突，但位置偏僻，历史 chip 要用需先收编 |

**要求**：
- 標籤（顯示用）集中到 `presentation.ts`，各組件改為 import，不得就地再定義。
- **Excel 匯出用的標籤與介面標籤可以不同**（`workflowFormat.ts` 的字串是給紙本／Excel 對照用的，長度與措辭需求不同）——**但這是刻意的分歧，須在代碼註釋中寫明**，不要「順手統一」成同一份，否則改壞匯出格式。
- 介面內部（`presentation.ts` / `ObservationHistory` / `BuildingDetail`）**必須統一**，同一個值在所有界面顯示同一句話。
- Agent 收口時須逐條比對三份 `coverageLabels` 的每個值並選定一份，**不得機械地保留第一個遇到的**。

## 8. 决策记录（含被取代的会议建议）

2026-09 与 jhxu 的会议产生过若干与本文不同的结论。下表明确哪些已采纳、哪些已被负责人的后续决定**取代**。后续 Agent 以本表为准，不要据会议记录回改。

| 会议建议 | 处置 |
| --- | --- |
| 三层颜色逻辑不统一，需统一 | **采纳** → 第 3 节 |
| 增加「从大楼/楼层向下同步标签」机制 | **采纳** → 第 4 节 |
| 维持主入口为逐单位记录 | **采纳** → 第 4 节 |
| 灰色优先级高于黄色 | **取代** → 异色即黄，黄压灰（第 3.3 节） |
| 合并为绿/黄/灰三态，去掉红 | **取代** → 保留四态含红（第 3.1 节）；失败的独立语义不能丢 |
| 大幅简化 schema、减少维度与选项 | **延后** → 第 9 节待决清单，不属本次范围 |
| 保留部分复杂度以便快速检索（如劏房） | **延后** → 同上，属 schema 决策 |
| AI 生成的 UX 需人工验证 | **采纳** → 见文首流程约束 |

## 9. 已知缺陷（需一并处理或显式排期）

- **黄色染色 + 建筑高度变换存在 bug**（jhxu 于 2026-09 发现，尚未修复）。执行本设计时须先复现该问题：确认它与本次四态改造是同一处代码（`src/map/mapModel.ts` 的 `floorFeatures` / `buildingFeatures` 颜色与高度计算），若是，则在本次一并修掉；若否，则单列并排期，不得声称已修复。
- 该 bug 与本设计的关联点：楼栋/楼层颜色目前由 `followUps > 0` 无条件覆盖，且高度由 `floors.length * FLOOR_HEIGHT` 派生，两者在同一次渲染中计算 —— 改造时须补充回归测试，覆盖「着色变化不引起高度变化」。

## 10. 四字段选项精简方案

> **动因**：会议指出「记录维度过多、选项复杂、学习成本高」。当前四个录入字段共 **20 个选项**（覆蓋 7 + 接觸 5 + 住房 5 + 來源 3），使用者須逐一理解。
> **目标**：每字段 **3 个选项 + 填空**（住房與來源另可留空），使用者可自行增刪常用選項。
> **状态**：方案已定，惟「枚舉寬度」一項待確認（見 §10.7）—— 該項影響 §3.2 判定函數的寫法。

### 10.1 合并映射（7+5+5+3 → 3+3+3+3）

**覆蓋狀態 7 → 3**

| 新選項 | 合併舊值 | 管線含義 |
| --- | --- | --- |
| 未到訪 | `UNVISITED`、`UNKNOWN` | 灰 |
| 未能完成探訪 | `ATTEMPTED`、`INACCESSIBLE`、`PARTIAL` | 紅（除「已接觸 + 有跟進」→ 黃） |
| 已完成探訪 | `VISITED_NO_FINDING`、`VISITED_WITH_FINDING` | 綠／有跟進則黃 |

**接觸結果 5 → 3**

| 新選項 | 合併舊值 |
| --- | --- |
| 未嘗試接觸 | `NOT_ATTEMPTED` |
| 未能接觸 | `NO_ANSWER`、`DECLINED` |
| 已接觸 | `CONTACTED` |

**住房判斷 5 → 3 + 空白**

| 新選項 | 合併舊值 |
| --- | --- |
| 未見相關跡象 | `NO_INDICATION` |
| 疑似，待核實 | `SUSPECTED` |
| 已確認 | `STAFF_VERIFIED` |
| （**留空**） | `NOT_UPDATED`、`UNKNOWN` |

> 留空即「今次未更新住房判斷」，與 §5.2 的向前繼承一致 —— 留空**退出候選集**，不覆蓋先前的判斷。

**資料來源 3 → 3 + 空白**

| 新選項 | 合併舊值 |
| --- | --- |
| 工作人員觀察 | `STAFF_OBSERVATION` |
| 居民口述 | `RESIDENT_REPORT` |
| 其他（自行填寫） | `UNKNOWN` |
| （**留空**） | 未記錄（不顯示 chip，見 §5.3） |

### 10.2 合并后管线仍然成立（已逐條驗證）

新「3×3」組合可完整復現舊「7×5」語義：

| 新組合 | 結果 | 對應舊行為 |
| --- | --- | --- |
| 未到訪 + 任意接觸 | 灰 | ✓ |
| 未能完成 + 未嘗試／未能接觸 | 紅 | ✓ |
| 未能完成 + 已接觸 | 有跟進黃／無跟進紅 | ✓（即舊 `PARTIAL`、`ATTEMPTED+CONTACTED`） |
| 已完成 + 任意接觸 | 有跟進黃／無跟進綠 | ✓ |

**35 種舊組合全部可對上**，包括 `demoFixture.ts:42` 的「已訪有發現 + 婉拒」。

### 10.3 有損之處（待確認）

`VISITED_NO_FINDING` 與 `VISITED_WITH_FINDING` 合併為「已完成探訪」後，**「有發現」不再由覆蓋狀態承擔**。目前由住房判斷（疑似／已確認）觸發線索標記（§5.2）承擔。

- 演示資料中兩者總是同時出現，故實際無損。
- 但若出現「有發現但住房判斷留空」，線索標記會消失。**此情形須確認是否可接受**，或需為「已完成探訪」再分一個「有發現」子選項（即 3 → 4）。

### 10.4 DIY 常用選項

**核心約束：自訂選項必須聲明「對應哪個內置語義」，否則著色管線無法判定。**

```ts
type CustomOption = { id: string; label: string; mapsTo: 'UNVISITED' | 'INCOMPLETE' | 'COMPLETED' };
```

- **新增**：填顯示文字 + 選擇歸入哪一類（三選一）。管線只看 `mapsTo`，自訂文字僅供顯示。
- **內置 3 項不可刪**（管線依賴）；自訂項可隱藏，**隱藏 ≠ 刪除** —— 舊記錄引用了已隱藏選項時仍正常顯示，只是不再出現於選單。
- **記錄存儲**：`coverage: 'INCOMPLETE'` + 自訂文字另存（如 `coverageNote?: string`），**不污染枚舉**。
- **存儲位置**：隨現有按帳號隔離的 localStorage 偏好。若要全機構共用常用選項，需落到 server（見 `docs/ACCOUNTS.md`）。
- 四個字段均適用同一機制；住房判斷與資料來源的「留空」不佔選項位。

### 10.5 三個必須處理的依賴

1. **W0 識別詞表（最重要）**：`src/imports/profiles.ts:94-98` 直接從標籤表生成候選集，`detector.ts:117` 用單元格文本做字符串匹配。**縮減選項會降低舊表格的識別率** —— 舊表裡的「部分完成」等值將無法匹配，降級為 `CANDIDATE`（軟降級，非拒絕，見 `detector.ts:158`）。
   **要求：識別詞表獨立保留全部舊標籤**，與 UI 選項分開維護 —— 即「UI 精簡、兼容不減」。這不違反 §6.1：識別詞表是**輸入兼容層**，不是著色標準，不參與任何顏色判定。
2. **舊資料**：現有觀察存的是 7 值。見 §10.7 的枚舉寬度決策 —— 建議領域枚舉保持寬（舊值並存），UI 只顯示 3 項，舊值以唯讀方式顯示；避免一次性資料遷移。
3. **Excel 匯出**：`workflowWorkbook.ts` 用 `Object.values(coverageLabels)` 作為下拉選項，須同步調整。

### 10.6 與 §6「單一標準」的關係

本方案會使選項表分裂成「UI 選項 / 識別詞表 / 匯出選項」三份，與 §6.1 有張力。**解法**：在 `presentation.ts` 內定義為**同一份資料的三個視圖**（如 `optionGroups` + `legacyLabels`），而非三份獨立表 —— 這樣 §6.2 的自動守衛測試仍能守住，回溯檢查標準不變。

**不得**為了本方案而在組件內就地定義第二份選項表。

### 10.7 待決事項

| 項 | 問題 | 建議 |
| --- | --- | --- |
| **枚舉寬度** | 領域枚舉收成 3 值（乾淨，需資料遷移）vs 保持 7 值並存（穩，UI 只顯示 3 項） | **保持寬**：不改 §3.2 判定函數、不需遷移、舊資料與舊匯入照常 |
| §10.3 有損 | 「已完成探訪」是否需再分「有發現」子選項 | 待確認 |
| DIY 存儲範圍 | 常用選項為個人偏好 vs 全機構共用 | 前者隨 localStorage，後者需 server |

## 11. 验收标准

- **单一标准（§6）**：四类着色（底色/徽章/标记/tag）全部源自 `presentation.ts` + `types.ts` 两处；`src/` 下除 `presentation.ts` 外无十六进制色值字面量、无状态标签字面量 —— 由**自动守卫测试**断言，非人工复查。
- **回溯检查自动化（§6.2）**：判定测试断言状态名（`'RED'`）而非色值；视觉断言引用 `stateColors.*` 而非字面量；守卫测试纳入 `npm run test`。复查者跑测试即可，无需重读代码。
- **按文件一次改到底（§6.3）**：任一文件不得处于「颜色已改、标签未改」的半成品状态；每个文件改完即跑测试。
- 单一四态函数，unit/floor/building 三层同源调用，无散落硬编码颜色。
- 四态各配回归样例；`stateOf` 覆盖：无记录→灰、`UNKNOWN/UNVISITED`→灰、`VISITED_*` 无/有跟进→绿/黄、`PARTIAL` 无/有跟进→红/黄、`ATTEMPTED+NO_ANSWER`→红、`ATTEMPTED+CONTACTED` 无/有跟进→红/黄、`INACCESSIBLE`→红、失败+OPEN 跟进→红（含角标）。
- `aggregate` 覆盖：空→fallback、全同色→该色、异色→黄（含 `绿+红`、`红+灰`、`绿+灰`）。
- **层级时序竞争**（§3.3）回归样例：
  - 已声明单位且全部无记录 + 楼栋级 `INACCESSIBLE`（较新）→ **红**（锁定本设计早期草稿的退步不复现：不得返回灰）。
  - 同上但楼栋级记录**较旧**、子单元记录较新 → 用聚合结果（不得被旧记录压回红）。
  - 无任何子记录 + 无自层记录 → 灰。
- **三层同源**：`stateOf` 对单元/楼层/楼栋必须走同一函数（以 `scope` 区分），不得每层各写一套 switch；回归样例须证明同样的 `coverage + hasOpen` 组合在三个层级得到相同的 `State`。
- **`latestObservation` 必须导出**（或内联），否则新函数无法复用现有最新值逻辑；构建须通过 `npm run typecheck`。
- tag：打标、级联展示、清除、与聚合色覆盖关系、向上传播，均有测试；真实 `stateOf` 不被 tag 改写。
- **红色豁免 tag**（§4）：回歸樣例須鎖定「樓層打 tag + 其下一個紅單元」→ 該紅單元**仍顯示紅**、且 tag 標記**仍可見可清除**；同時斷言綠/灰/黃單元在此 tag 下**均顯示黃**（豁免只針對紅，不得擴大）。
- **節點自身為紅 + 打 tag** → 節點仍顯示紅，且 tag 標記可見（鎖定豁免適用於所有層級）。
- 徽章与底色解耦：**红+跟进、灰+跟进** 均须显示类别徽章且底色不变（回归样例必须覆盖这两种组合）；黄+跟进显示徽章；hover 显示 action/dueDate/assignee。
- 线索标记：`VISITED_WITH_FINDING` 或 `currentAssessment ∈ {SUSPECTED, STAFF_VERIFIED}` 时显示，底色仍为四态之一；`NO_INDICATION`/`UNKNOWN` 不触发；回归样例须含「绿+有线索」与「黄+有线索」两种组合。
- 线索标记**区分两级**：「疑似（SUSPECTED）」与「已确认（STAFF_VERIFIED）」在网格层视觉可区分；回归样例须各一。
- 历史 chip：`assessment` 五个值全部照旧可见（不得因子着色改造而删减）；新增 `sourceType` chip，且**空缺时不显示**（不得显示成「來源未明」）；回归样例须含「有 sourceType」与「无 sourceType」两种观察。
- 标签单一来源：`presentation.ts` 为介面標籤唯一出處，`ObservationHistory`/`BuildingDetail` 不得就地定義；回归断言：同一個 `coverage` 值在单元格、楼层条、大廈列表、历史 chip 显示**同一句话**。Excel 匯出標籤與介面標籤的分歧須有註釋說明，不被「順手統一」。
- **线索向前继承**：必须有回归样例锁定「SUSPECTED → 之后一条 NOT_UPDATED」仍然显示线索；以及「SUSPECTED → 之后一条 NO_INDICATION」线索消失（明确结论可覆盖）。
- **徽章类别兜底**：无 `category` 的 OPEN 跟进显示通用「待跟進」徽章，不得默认成「一般跟進」；回归样例须含无类别跟进。
- 回归断言：`followUps > 0` **不得**单独改变任何层级的底色（锁定今日覆盖缺陷不再复发）。
- **選項精簡（§10）**：四字段各 3 選項（住房／來源另可留空）；回歸樣例須證明 §10.2 表格中**全部 35 種舊組合**都能得到與舊行為相同的 `State`（逐條，不得只抽樣）。
- **選項表單一來源（§10.6）**：`optionGroups` / 識別詞表 / 匯出選項同源於 `presentation.ts`；回歸斷言組件內**不存在第二份選項表**。
- **識別詞表不因精簡而縮水（§10.5）**：舊標籤（如「部分完成」）仍可被 W0 識別為 `KNOWN` 或至少 `CANDIDATE`，**不得變成拒絕識別**；回歸樣例須含舊標籤的識別測試。
- **DIY 選項**：自訂項須聲明 `mapsTo` 才可入選單；內置 3 項不可刪；隱藏項在舊記錄中仍正常顯示；回歸樣例須含「隱藏後讀取舊記錄」。
- **黃色的兩義（§3.5）**：正例鎖定「綠單元 + 灰單元 → 樓層黃**且無任何跟進**」（#4 混雜義），回歸斷言該層為黃且 `followUps === 0`；並斷言此時**不顯示跟進徽章**（黃無徽章＝混雜），而 #1–#3 的單元黃**顯示徽章**。
- 圖例文案不得把黃色等同「待跟進」：斷言 `MapScene` 圖例中琥珀項的文字**不等於**「待跟進」（鎖定 §3.5 的文案裁決，防止回退）。
- #4 構成明細（「2 綠 · 1 紅 · 3 未訪」）有回歸樣例。
- 回归断言：`VISITED_NO_FINDING` 与 `VISITED_WITH_FINDING` 底色**相同**（都是绿），差异只体现在线索标记 —— 锁定四态不因线索而分裂成五色。
- 图例与所有渲染处使用同一四态色。
- 已知缺陷（第 8 节）已复现并处置，或显式排期，未声称已修复。
- `npm run typecheck` / `npm run test` / `npm run lint` 全绿；不放松既有断言（演示语义断言不得为迁就新色而放宽）。
- 提交前 `git status` 核对，不夹带无关改动。
- 交付 NGO 前须经人工验证；AI 生成的交互逻辑须单独复核易用性与学习成本。
