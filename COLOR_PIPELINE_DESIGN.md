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
| R5 | 跟进可在工作台直接「標記完成」或「取消跟進」（取消须写原因），**不产生新的探访记录**。记录操作人（登入账号，不是纸本工作员）与操作时间；可「撤銷」，撤销是追加一条 `REOPENED` 事件，不删除原事件。事件存于 `snapshot.followUpEvents`，随「關聯封存」进出 Excel，并另有只读的「跟進處理」工作表。纸本路径的「結束跟進編號」保持不变。 | 无（新增） |
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
- 颜色表在 `src/domain/presentation.ts`；「待跟進」图标（`RotateCcw`）在楼层条、单元格、大厦列表三处各自渲染。

## 3. 四态判定（定稿）

### 3.1 四态语义

| 态 | 语义 |
| --- | --- |
| `GREEN` 绿 | 已完成探访、有记录，且无 OPEN 跟进 |
| `YELLOW` 黄 | **需留意**。有两义，见 §3.5 —— 单元层＝有 OPEN 跟进；聚合层＝子状态混杂（可能无任何跟进） |
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
| 1 | 单元 | 已访（`VISITED_NO_FINDING`/`VISITED_WITH_FINDING`）+ 有 OPEN 跟进 | 有跟进 |
| 2 | 单元 | `PARTIAL` + 有 OPEN 跟进 | 有跟进 |
| 3 | 单元 | `ATTEMPTED`/`INACCESSIBLE` + `CONTACTED` + 有 OPEN 跟进 | 有跟进 |
| 4 | 楼层/楼栋 | **子状态聚合异色**（§3.3 `aggregate`） | **状态混杂（可无任何跟进）** |
| 5 | 楼层/楼栋 | 自层记录按时序胜出，且满足 #1–#3 | 有跟进 |
| 6 | 楼层/楼栋 | 手动 tag（§4） | 人工标记需跟进 |

**问题**：#4 与 #1–#3 不是同一个意思。一层楼「A 單元綠（已訪、無跟進）+ B 單元灰（未訪）」→ 聚合异色 → 黄，**但该层没有任何待办**。而图例现写「待跟進」，会直接误导。

> **这不是边缘情况，而是最常见的情况** —— 任何部分完成的楼层都是「綠 + 灰」→ 黄。真实资料里大多数黄色都会是 #4（混杂）而非 #1–#3（待办）。

**裁决：黄色在所有层级统读作「需留意」。**

- 颜色**不变**（仍是一个黄，四色模型不动）—— 符合负责人「顏色在不同維度下統一和諧」的目标。
- **「有跟進」的具体含义由徽章承担**（§5.1）。判别方式：**黄 + 徽章 = 有跟进（#1–#3、#5、#6）；黄无徽章 = 状态混杂（#4）**。
- 这正是 §5「標記與顏色解耦」的又一次应用：颜色回答「要不要留意」，标记回答「留意什麼」。

**文案要求（必改）**：
- 地图图例（`MapScene.tsx:360`）现为「琥珀 = 待跟進」——**必须改**，不得再让图例把黄色等同于待跟进。改为涵盖两义的措辞（如「需留意」）。
- 楼层 hover／`aria-label`（`MapScene.tsx:177`、`:336-337`）的「待跟進」由 `hasFollowUp` 驱动（**真实有跟进**），语义正确，**保留**；它是叠加在颜色之上的额外标记，与解耦原则一致。
- 需为 #4 提供**构成明细**（hover／tooltip 显示「2 綠 · 1 紅 · 3 未訪」），否则用户看到黄色无徽章时无法得知原因。这是「需留意」可操作的前提。

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

**红色豁免（定稿）**：`RED` 是「探訪失敗」，比人工标记更重要，**不得被 tag 掩盖**。tag 级联对红单元无效：

```ts
// 展示態：tag 只在節點計算態不是 RED 時才染黃。
function effectiveState(node): State {
  const computed = computedState(node);                     // §3.2 stateOf / §3.3 nodeState
  return node.tag === 'FOLLOW_UP' && computed !== 'RED' ? 'YELLOW' : computed;
}
```

- 适用于**所有层级**：不只是子单元，节点自身亦然。若某楼层的计算态是红（如自层「未能進入」记录按时序胜出），打 tag 后**仍显示红**。
- **tag 仍然成立且可见**：用户打了 tag 却见底色不变时，必须能看到 tag 已设定 —— tag 以**徽章／标记**形式显示于节点上，并可正常清除。不得因底色不变而让用户以为操作失败。
- 这与 §5 的原则一致：底色回答「要不要留意」，标记回答「留意什麼」。红底 + tag 标记 = 「這層失敗了，而我另外標了要跟進」。
- 副作用（可接受）：若某层全部单元皆红，该层在 tag 下仍显红，楼栋聚合也因此不受该层的 tag 影响 —— 这是正确的，红的讯息量高于人工标记。

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
- 内容：跟进类别徽章（四类：一般跟进/住屋变动/健康关怀/服务邀约，各配图标）；`hover`/`title` 显示 `action` / `dueDate` / `assignee`。
- **类别兜底**：`followUp.category` 在类型上是**可选**的（`category?:`），演示与导入数据中确实存在无类别的跟进（如 `demoFixture.ts:39`、`:49`）。无类别时显示通用「待跟進」徽章，**不得**默认成「一般跟進」——那会把「未分类」伪装成「已分类为一般」。有多个 OPEN 跟进时按类别去重后并列显示。
- 各底色下的表现：
  | 底色 | 徽章 | 说明 |
  | --- | --- | --- |
  | 黄 | 显示 | 徽章即黄色的成因，两者一致 |
  | 红 | 显示 | 红优先，跟进不改变底色（见 3.2） |
  | **灰** | 显示 | 底色保持灰（未探访过是事实），但跟进任务必须可见，不得被灰吞掉 |
  | 绿 | 理论上不出现 | 绿的定义即「无 OPEN 跟进」；若出现说明数据异常，仍须显示徽章而非静默 |
- 楼层条与大厦列表沿用同一徽章语言，保证跨维度一致。

### 5.2 线索标记

由「已探访且有线索」驱动，与底色无关。**解决四态有损问题**：绿色同时代表「已访无发现」与「已访有线索」，后者在列表扫视时不可见，而会议明确要求「保留必要复杂度以便快速检索，如是否有劏房」。

**住房判断必须向前继承，不能读「最新观察」。** `assessment` 与 `coverage`、`contactOutcome` 相互独立（`types.ts:42`），且 `NOT_UPDATED` 的字面语义是「今次無更新住房判斷」。若读最新观察，则「上次記錄疑似劏房 → 今次探訪沒碰住房判斷」会导致线索标记消失，违反「觀察事件只追加、住房判斷相互獨立」的领域原则。

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
- **注意两者的时间基准不同且这是故意的**：`coverage` 取最新观察（本次探访做了什么），`assessment` 向前继承（住房判断是关于该单元持续有效的结论）。Agent 不得为「统一」而把两者改成同一基准。
- **必须区分「疑似」与「已确认」两种变体**（这是网格层唯一能看到的住房信息，混为一谈会丢掉证据强度）：
  | 变体 | 条件 | 说明 |
  | --- | --- | --- |
  | 疑似 | `currentAssessment === 'SUSPECTED'` | 与现有 `cf-chip--uncertain` 的「未確定」语义对齐 |
  | 已确认 | `currentAssessment === 'STAFF_VERIFIED'` | 证据强度更高，视觉上须与「疑似」可区分 |
  | 有发现（无判断） | `coverage === 'VISITED_WITH_FINDING'` 且 `currentAssessment` 不触发 | 本次有记录发现，但住房判断未升级 |
- 表现：底色之上加一个小标记（区别于跟进徽章）。`hover`/`title` 显示 `assessment` 的中文标签与观察备注。
- 与其他底色的组合：黄/红/灰底同样显示线索标记 —— 例如「失败 + 上次有线索」的历史不能被本次失败抹掉（沿用「观察事件只追加、互不覆盖」的领域原则）。
- **不得**用改底色或加第五种颜色来实现；四色不变。
- 与 `assessment` 语义保持一致：`NOT_UPDATED`（无更新）**退出候选集**（即向前继承，见上）；`NO_INDICATION`（未见相关迹象）、`UNKNOWN`（未能确定）**不触发**线索标记，避免把「不知道」或「已看過沒发现」显示成「有线索」。`NO_INDICATION` 视为对本单元住房判断的明确结论，会覆盖更早的 `SUSPECTED`。

#### 5.2.1 标记与用字（2026-10-15 决定）

用字与标记收进 `presentation.ts` 一张表（`assessmentLabels` + `assessmentMarks`），表单选项、楼层立面图例、单位帐目、历史 chip 全部读它，界面之间不可能各写各的。

| 住房判断 | 表单选项 | 色块标记 |
| --- | --- | --- |
| `SUSPECTED` | 疑似劏房 | **？** |
| `STAFF_VERIFIED` | 已确认 | **✓** |
| `NO_INDICATION` | 未见相关迹象 | 无 |
| `UNKNOWN` | 住房情况未能确定 | 无 |
| `NOT_UPDATED` | 无更新（留空，不写入） | 无 |
| `FINDING`（非 `assessment`，见 §5.2 触发条件） | —— | 无 |

> **「已確認」不分有没有劏房**：它回答的是「有沒有人確認過這單位的住房情況」，不是「有沒有劏房」。有没有劏房由结构（单位／劏房房间）本身承担，不再另设第二个标记。这也让旧版的「已確認劏房」（◆）与「無劏房」（✓）合并成同一个 ✓。
>
> **「有發現（無判斷）」不画标记**：这解掉了 §10.3 的未决问题。标记的角落只留给「對住房的判斷」，而覆盖状态已经说了这次探访留下了记录；`title`／`aria-label` 仍读出「有記錄發現」，所以萤幕报读不会漏掉它。
>
> **劏房房间不画标记**：房间之所以是房间，就是因为它由单位分拆而来 —— 那一格本身就是「劏房」这件事，再加标记只是重复色块的形状。分拆后的母单位自己没有格子，所以它把自己的那一个标记画在整个分拆格的角落，一个字段仍然只有一个标记。

### 5.3 住房判断与资料来源的完整呈现（单元详情）

> **分工原则**：网格层（单位状态）只给**标记**，不给全文；**完整**的住房判断与资料来源在**选中单元后的历史卡片**（`ObservationHistory`）里看。这是已确认的分工，Agent 不得把住房判断全文搬进网格（会推高视觉密度、违背会议「降低学习成本」的要求），也不得把历史 chip 删掉。

**保留现状**：`ObservationHistory` 已渲染 `workerName` / `coverage` / `contactOutcome` / `assessment` 四枚 chip（[ObservationHistory.tsx:26](src/components/ObservationHistory.tsx#L26)），住房判断的五个值全部可见，`SUSPECTED`/`UNKNOWN` 带 `cf-chip--uncertain` 样式。**这套呈现是本设计的组成部分，必须保留。**

**新增：资料来源 chip**。`sourceType` 目前是「只写不读」字段 —— 表单可填、存库、导出 Excel，但**任何阅读界面都不显示**（组件层零渲染）。本设计要求把它加入历史 chip，与住房判断并列：

> 效果：「居民口述 · 疑似劏房」与「工作人員觀察 · 疑似劏房」必须能一眼区分。
> 这是劏房场景的要害 —— 两者的证据强度差很远，而这正是 `SUSPECTED` → `STAFF_VERIFIED` 之间的关键差别。

- `sourceType` 为可选字段，空缺时**不显示 chip**（与 `contactOutcome`/`assessment` 的现有处理一致），不得显示成「來源未明」——「沒填」与「填了來源未明」是两件事。
- chip 顺序建议：`workerName` → `coverage` → `contactOutcome` → `assessment` → **`sourceType`**。

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
| 跟进徽章类别 | `presentation.ts`（由 `supportCategoryLabels` 收编） | 单元格、楼层条、大厦列表 |
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
4. 该守卫纳入 `npm run test`。**这样「回溯检查」= 跑测试**，任何人复查时看到的标准与执行时完全相同，无需再人工比对一遍代码。

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
| `src/components/BuildingDetail.tsx` | 单元格 `cf-status-{coverage}` + 待跟进图标 | 四态色 + 跟进徽章（底色无关）+ 线索标记（疑似/已确认两级）；楼层/楼栋 tag 入口 |
| `src/components/ObservationHistory.tsx` | 4 枚 chip，**无 sourceType** | 新增资料来源 chip（§5.3）；标签改用单一来源 |
| `src/map/MapScene.tsx` | 图例 3 项（teal/amber/gray），琥珀文案为「待跟進」 | 图例 4 项（绿/黄/红/灰）；**琥珀文案改为涵盖两义的措辞**（§3.5），不得再等同「待跟進」 |

新增交互：楼层条、楼栋详情各加一个「标记整层/整栋跟进」与「清除标记」操作（tag 入口）。

### 7.1 标签重复（与着色同类的「不统一」，须一并收口）

同一枚举在仓库里有**多份互相冲突的中文标签**，同一个 `coverage` 值在不同界面显示不同文字：

| 枚举 | 定义处 | 冲突示例 |
| --- | --- | --- |
| `coverageLabels` | `presentation.ts:3`、`ObservationHistory.tsx:7`、`BuildingDetail.tsx:7` | `UNKNOWN` 三处三样：「暫無可靠記錄」/「覆蓋未明」/「未能確定」；`VISITED_NO_FINDING` 两样：「已查看・無發現」/「已訪，無記錄發現」 |
| `assessmentLabels` | `ObservationHistory.tsx:5`、`workflowFormat.ts:6` | `SUSPECTED`：「疑似劏房」（画面）vs「疑似，待核實」（纸本／Excel）；`STAFF_VERIFIED`：「已確認」vs「工作人員已確認」。**画面的用字已于 2026-10-15 统一（§5.2.1）；纸本栏的用字是往返格式，仍是刻意分歧，不得对齐** |
| `contactLabels` | `ObservationHistory.tsx:6`、`workflowFormat.ts:5` | `UNKNOWN`：「接觸結果未明」vs「未能確定」 |
| `sourceLabels` | 仅 `workflowFormat.ts:7` | 无冲突，但位置偏僻，历史 chip 要用需先收编 |

**要求**：
- 标签（显示用）集中到 `presentation.ts`，各组件改为 import，不得就地再定义。
- **Excel 导出用的标签与界面标签可以不同**（`workflowFormat.ts` 的字串是给纸本／Excel 对照用的，长度与措辞需求不同）——**但这是刻意的分歧，须在代码注释中写明**，不要「順手統一」成同一份，否则改坏导出格式。
- 界面内部（`presentation.ts` / `ObservationHistory` / `BuildingDetail`）**必须统一**，同一个值在所有界面显示同一句话。
- Agent 收口时须逐条比对三份 `coverageLabels` 的每个值并选定一份，**不得机械地保留第一个遇到的**。

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

> **动因**：会议指出「记录维度过多、选项复杂、学习成本高」。当前四个录入字段共 **20 个选项**（覆盖 7 + 接触 5 + 住房 5 + 来源 3），使用者须逐一理解。
> **目标**：每字段 **3 个选项 + 填空**（住房与来源另可留空），使用者可自行增删常用选项。
> **状态**：方案已定，惟「枚舉寬度」一项待确认（见 §10.7）—— 该项影响 §3.2 判定函数的写法。

### 10.1 合并映射（7+5+5+3 → 3+3+3+3）

**覆盖状态 7 → 3**

| 新选项 | 合并旧值 | 管线含义 |
| --- | --- | --- |
| 未到访 | `UNVISITED`、`UNKNOWN` | 灰 |
| 未能完成探访 | `ATTEMPTED`、`INACCESSIBLE`、`PARTIAL` | 红（除「已接觸 + 有跟進」→ 黄） |
| 已完成探访 | `VISITED_NO_FINDING`、`VISITED_WITH_FINDING` | 绿／有跟进则黄 |

**接触结果 5 → 3**

| 新选项 | 合并旧值 |
| --- | --- |
| 未尝试接触 | `NOT_ATTEMPTED` |
| 未能接触 | `NO_ANSWER`、`DECLINED` |
| 已接触 | `CONTACTED` |

**住房判断 5 → 3 + 空白**（用字于 2026-10-15 统一，见 §5.2.1）

| 新选项 | 对应的值 |
| --- | --- |
| 无更新（**留空**） | 不写入任何值；先前的判断照旧有效 |
| 未见相关迹象 | `NO_INDICATION` |
| 疑似劏房 | `SUSPECTED` |
| 已确认 | `STAFF_VERIFIED` |

> 留空即无更新，与 §5.2 的向前继承一致 —— 留空**退出候选集**，不覆盖先前的判断，所以色块上显示的仍是上一个真正做出来的判断（连同它的标记）。纸本回录的「住房判斷」栏写入 `NOT_UPDATED` 时语意相同，同样退出候选集。
>
> `UNKNOWN`（住房情况未能确定）不由表单提供，但仍是合法存量值：旧记录照样读、照样显示（历史 chip 与单位账目各有它的说法），只是新的记录不会产生它。`retiredLabels` 保留 2026-10-15 之前画面写过的四种说法，旧试算表照样读得回来。

**资料来源 3 → 3 + 空白**

| 新选项 | 合并旧值 |
| --- | --- |
| 工作人员观察 | `STAFF_OBSERVATION` |
| 居民口述 | `RESIDENT_REPORT` |
| 其他（自行填写） | `UNKNOWN` |
| （**留空**） | 未记录（不显示 chip，见 §5.3） |

### 10.2 合并后管线仍然成立（已逐条验证）

新「3×3」组合可完整复现旧「7×5」语义：

| 新组合 | 结果 | 对应旧行为 |
| --- | --- | --- |
| 未到访 + 任意接触 | 灰 | ✓ |
| 未能完成 + 未尝试／未能接触 | 红 | ✓ |
| 未能完成 + 已接触 | 有跟进黄／无跟进红 | ✓（即旧 `PARTIAL`、`ATTEMPTED+CONTACTED`） |
| 已完成 + 任意接触 | 有跟进黄／无跟进绿 | ✓ |

**35 种旧组合全部可对上**，包括 `demoFixture.ts:42` 的「已訪有發現 + 婉拒」。

### 10.3 有损之处（2026-10-15 已决）

`VISITED_NO_FINDING` 与 `VISITED_WITH_FINDING` 合并为「已完成探訪」后，**「有發現」不再由覆盖状态承担**。目前由住房判断（疑似／已确认）触发线索标记（§5.2）承担。

- 演示资料中两者总是同时出现，故实际无损。
- 「有發現但住房判斷留空」这一格原本悬而未决。**2026-10-15 决定：不画标记**（见 §5.2.1）。不必为此再分「已完成探訪」的子选项 —— 覆盖状态回答的是「這次探訪成不成」，让它也说「有發現」等于给它第二个住房判断；完整判断本来就在选中单位后的历史卡片里。`title`／`aria-label` 仍读得出「有記錄發現」。

### 10.4 DIY 常用选项

**核心约束：自订选项必须声明「對應哪個內置語義」，否则着色管线无法判定。**

```ts
type CustomOption = { id: string; label: string; mapsTo: 'UNVISITED' | 'INCOMPLETE' | 'COMPLETED' };
```

- **新增**：填显示文字 + 选择归入哪一类（三选一）。管线只看 `mapsTo`，自订文字仅供显示。
- **内置 3 项不可删**（管线依赖）；自订项可隐藏，**隐藏 ≠ 删除** —— 旧记录引用了已隐藏选项时仍正常显示，只是不再出现于选单。
- **记录存储**：`coverage: 'INCOMPLETE'` + 自订文字另存（如 `coverageNote?: string`），**不污染枚举**。
- **存储位置**：随现有按账号隔离的 localStorage 偏好。若要全机构共用常用选项，需落到 server（见 `docs/ACCOUNTS.md`）。
- 四个字段均适用同一机制；住房判断与资料来源的「留空」不占选项位。

### 10.5 三个必须处理的依赖

1. **W0 识别词表（最重要）**：`src/imports/profiles.ts:94-98` 直接从标签表生成候选集，`detector.ts:117` 用单元格文本做字符串匹配。**缩减选项会降低旧表格的识别率** —— 旧表里的「部分完成」等值将无法匹配，降级为 `CANDIDATE`（软降级，非拒绝，见 `detector.ts:158`）。
   **要求：识别词表独立保留全部旧标签**，与 UI 选项分开维护 —— 即「UI 精簡、兼容不減」。这不违反 §6.1：识别词表是**输入兼容层**，不是着色标准，不参与任何颜色判定。
2. **旧资料**：现有观察存的是 7 值。见 §10.7 的枚举宽度决策 —— 建议领域枚举保持宽（旧值并存），UI 只显示 3 项，旧值以只读方式显示；避免一次性资料迁移。
3. **Excel 导出**：`workflowWorkbook.ts` 用 `Object.values(coverageLabels)` 作为下拉选项，须同步调整。

### 10.6 与 §6「單一標準」的关系

本方案会使选项表分裂成「UI 選項 / 識別詞表 / 匯出選項」三份，与 §6.1 有张力。**解法**：在 `presentation.ts` 内定义为**同一份资料的三个视图**（如 `optionGroups` + `legacyLabels`），而非三份独立表 —— 这样 §6.2 的自动守卫测试仍能守住，回溯检查标准不变。

**不得**为了本方案而在组件内就地定义第二份选项表。

### 10.7 待决事项

| 项 | 问题 | 建议 |
| --- | --- | --- |
| **枚举宽度** | 领域枚举收成 3 值（干净，需资料迁移）vs 保持 7 值并存（稳，UI 只显示 3 项） | **保持宽**：不改 §3.2 判定函数、不需迁移、旧资料与旧导入照常 |
| §10.3 有损 | 「已完成探訪」是否需再分「有發現」子选项 | **已决（2026-10-15）**：不分，该情形不画标记 |
| DIY 存储范围 | 常用选项为个人偏好 vs 全机构共用 | 前者随 localStorage，后者需 server |

### 10.8 一次记录多个单位（2026-10-15 决定）

批量是**同一个表单、同一组四字段**，写进多个单位 —— 不是第二套记录方式。触发方式是按住 Ctrl／Command 点楼层立面的色块（直接点仍然是「只選一個」），选中两个以上时，底部按钮换成批量列。

| 项 | 决定 |
| --- | --- |
| 映射的字段 | 覆盖状态＋住房判断＋资料来源，**逐个单位各写一笔独立记录**（各自 `id`、各自 `floorId`、同一个 `visitId`，即同一次到访） |
| 确认无劏房 | 可选的第四项，勾选后在同一动作内对整批套用 `setNoSubdivision` |
| 跟进 | **不设**。一个跟进是「一個地方、一件要做的事」，三个单位就是三件事；在批量表单勾一次而开出三张任务卡，是表单替人做了决定 |
| 删除 | 同一组选取按批量列的按钮一次删除，走既有的 `structureImpact` 闸门：**只有带记录的才先问**，问句里的笔数就是即将消失的笔数（§7 的既有规则）。不再设 Delete 键删除快捷键（2026-10-16）：删除是带记录就不可逆的动作，留给显式按钮与确认流程，键盘 Delete 只会是误触 |
| 已分拆的单位 | 记录照写，**无劏房确认会略过并报数**，不得静默丢弃，也不得把它算进「已確認」 |
| 部分失败 | 批次以单一 snapshot 写入；有任何一笔无法存入就整批不写，不得留下「一半已記錄、一半沒有」的状态 |

- 原子性是**整批**的，而「略過」是**字段级**的：确认无劏房在已分拆的单位上做不到，这件事不该让其余单位的记录一并失败 —— 所以要**分开报**（写入 N 笔／确认 M 个／略过 K 个）。这与 §3.3「待核對行不阻塞整批，但也不許被靜默略過」是同一条原则。
- 选取状态只是**界面状态**：不进 snapshot、不写 localStorage，切换大厦即清空。
- 图例与标记规则不因批量而变 —— 批量的每个单位仍然是它自己的格子、自己的颜色、自己的标记。

### 10.9 劏房房间承自原单位（2026-10-15 决定）

分拆是「同一個空間改以房間計」，不是凭空多出几个没有历史的位置。所以**房间读的是它被分拆出来的那个单位的记录**：

| 项 | 决定 |
| --- | --- |
| 谁的记录说话 | `subjectUnitIds(unitId)`：房间＝自己＋原单位；未分拆的单位＝自己。**不向上、不横向** —— 房间的记录不会改变原单位或兄弟房间的颜色 |
| 读取入口 | 全部经 `latestForUnit` / `latestInScope(unit scope)` / `currentAssessment`：颜色、案卷「最近」、住房判断、待跟进徽章、导出状态都由同一处读，不得只改一处 |
| 同时刻 | 房间自己那笔胜出（`latestOfSubjects`）：同一时刻的两笔，发生在此处的那笔是更具体的陈述 |
| 原单位的记录 | **不复制、不改写**，仍留在原单位上（`setRoomCount` 的既有行为），房间只是读它 |
| 显示 | 房间色块直接显示承来的颜色；案卷「最近」加注「承自分拆前的原單位」，房间自己的历史仍只列自己的记录，并说明原因 |
| 计数 | 已分拆的原单位是**容器**：`getCoverageSummary`、大厦标题的单位数、未能完成数都只算画出来的格子（房间），不算容器 |
| 什么都不继承 | 原单位没有记录，房间就是 GRAY、表单不预选 —— 沿用不等于补造 |

- 这条与 §3.2／§10.8 的原则一致：承的是**已经有人写下的记录**，不是推断。
- 回归测试：`src/domain/types.test.ts`「a 劏房 room reads the unit it was split from」、`src/components/labels.test.tsx`「a split unit keeps its colour on the rooms that replaced it」、`src/components/observationDefaults.test.ts`「the two answers a form opens with, per place」。

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
- **红色豁免 tag**（§4）：回归样例须锁定「樓層打 tag + 其下一個紅單元」→ 该红单元**仍显示红**、且 tag 标记**仍可见可清除**；同时断言绿/灰/黄单元在此 tag 下**均显示黄**（豁免只针对红，不得扩大）。
- **节点自身为红 + 打 tag** → 节点仍显示红，且 tag 标记可见（锁定豁免适用于所有层级）。
- 徽章与底色解耦：**红+跟进、灰+跟进** 均须显示类别徽章且底色不变（回归样例必须覆盖这两种组合）；黄+跟进显示徽章；hover 显示 action/dueDate/assignee。
- 线索标记：`VISITED_WITH_FINDING` 或 `currentAssessment ∈ {SUSPECTED, STAFF_VERIFIED}` 时显示，底色仍为四态之一；`NO_INDICATION`/`UNKNOWN` 不触发；回归样例须含「绿+有线索」与「黄+有线索」两种组合。
- 线索标记**区分两级**：「疑似（SUSPECTED）」与「已确认（STAFF_VERIFIED）」在网格层视觉可区分；回归样例须各一。
- 历史 chip：`assessment` 五个值全部照旧可见（不得因子着色改造而删减）；新增 `sourceType` chip，且**空缺时不显示**（不得显示成「來源未明」）；回归样例须含「有 sourceType」与「无 sourceType」两种观察。
- 标签单一来源：`presentation.ts` 为界面标签唯一出处，`ObservationHistory`/`BuildingDetail` 不得就地定义；回归断言：同一个 `coverage` 值在单元格、楼层条、大厦列表、历史 chip 显示**同一句话**。Excel 导出标签与界面标签的分歧须有注释说明，不被「順手統一」。
- **线索向前继承**：必须有回归样例锁定「SUSPECTED → 之后一条 NOT_UPDATED」仍然显示线索；以及「SUSPECTED → 之后一条 NO_INDICATION」线索消失（明确结论可覆盖）。
- **徽章类别兜底**：无 `category` 的 OPEN 跟进显示通用「待跟進」徽章，不得默认成「一般跟進」；回归样例须含无类别跟进。
- 回归断言：`followUps > 0` **不得**单独改变任何层级的底色（锁定今日覆盖缺陷不再复发）。
- **选项精简（§10）**：四字段各 3 选项（住房／来源另可留空）；回归样例须证明 §10.2 表格中**全部 35 种旧组合**都能得到与旧行为相同的 `State`（逐条，不得只抽样）。
- **选项表单一来源（§10.6）**：`optionGroups` / 识别词表 / 导出选项同源于 `presentation.ts`；回归断言组件内**不存在第二份选项表**。
- **识别词表不因精简而缩水（§10.5）**：旧标签（如「部分完成」）仍可被 W0 识别为 `KNOWN` 或至少 `CANDIDATE`，**不得变成拒绝识别**；回归样例须含旧标签的识别测试。
- **DIY 选项**：自订项须声明 `mapsTo` 才可入选单；内置 3 项不可删；隐藏项在旧记录中仍正常显示；回归样例须含「隱藏後讀取舊記錄」。
- **黄色的两义（§3.5）**：正例锁定「綠單元 + 灰單元 → 樓層黃**且無任何跟進**」（#4 混杂义），回归断言该层为黄且 `followUps === 0`；并断言此时**不显示跟进徽章**（黄无徽章＝混杂），而 #1–#3 的单元黄**显示徽章**。
- 图例文案不得把黄色等同「待跟進」：断言 `MapScene` 图例中琥珀项的文字**不等于**「待跟進」（锁定 §3.5 的文案裁决，防止回退）。
- #4 构成明细（「2 綠 · 1 紅 · 3 未訪」）有回归样例。
- 回归断言：`VISITED_NO_FINDING` 与 `VISITED_WITH_FINDING` 底色**相同**（都是绿），差异只体现在线索标记 —— 锁定四态不因线索而分裂成五色。
- 图例与所有渲染处使用同一四态色。
- 已知缺陷（第 8 节）已复现并处置，或显式排期，未声称已修复。
- `npm run typecheck` / `npm run test` / `npm run lint` 全绿；不放松既有断言（演示语义断言不得为迁就新色而放宽）。
- 提交前 `git status` 核对，不夹带无关改动。
- 交付 NGO 前须经人工验证；AI 生成的交互逻辑须单独复核易用性与学习成本。
