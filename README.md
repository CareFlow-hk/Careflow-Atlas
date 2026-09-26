# CareFlow Atlas

> 西營盤社區客廳「洗樓」外展工作台 —— 用合成資料砌出嚟嘅前端原型。

呢個 repo 係一個**示範原型**同前端基礎，**唔係**已經上線嘅 NGO 系統。冇正式後端、冇登入、冇多租戶、冇離線同步、冇審批流程；亦都**唔可以**入任何真實居民資料。

## 而家做得到啲乜

**紙本／Excel**

- 格式識別與欄位對應只供預覽。改動對應後會撤銷舊的待匯入資料，請整理原檔再重新載入；三種推測格式尚不支援寫入。

- 喺瀏覽器直接解析合成 `.xlsx`，逐行列出驗證問題，唔會靜靜哋丟咗有問題嘅行。
- 匯出／合併中文六表工作簿，有歷史保護同行級覆核。
- **追加式更正**：錯嘅記錄唔改唔刪。另開一行，喺「更正原記錄編號」填返要更正嗰條，更正鏈鏈尾生效；被更正嘅原行退出覆蓋計算，但保留喺歷史度兼標明「已被更正」。同一條原記錄有兩條並行更正就報衝突，要人手揀；修改跟進或結案關係必須寫明更正原因。

**地圖同外展**

- 喺真實 OpenStreetMap 西營盤底圖上面睇合成樓宇，揀樓 → 俯衝視角 → 展開樓層堆疊。
- 睇樓層／單位狀態：明確否定結果、不確定判斷、接觸結果、待跟進。
- 追加新觀察，唔會覆蓋舊歷史。
- 載入 20 幢樓嘅街區 mock（123 層、362 個單位、56 個合成人物、多次探訪紀錄），合併時保留現有記錄。
- 底板或者 WebGL 唔得嘅時候，樓宇清單同表單一樣行得到。

**其他**

- 整份合成 snapshot 經 repository + `localStorage` 存喺呢個瀏覽器，亦可以匯出做 JSON。

## 唔好當真嘅嘢

- 所有業務記錄、人物、地址、層數、單位間隔**全部係合成**。地圖圖磚同周邊樓宇係真實地理資料，高亮嘅 CareFlow 目標係示意。
- **未做**：後端、認證、租戶隔離、離線同步、審批、OCR／圖片識別、手機現場記錄、任何自動醫療或法律判斷。
- **唔會**上傳機構文件去外部 AI 度、亦唔會訓練模型。

## 本機運行

實測環境：**Node.js v24.15.0 / npm 11.12.1**。

```bash
npm ci
npm run demo:generate   # 由 src/data/demoFixture.ts 確定性重建示範工作簿
npm run typecheck
npm run lint
npm test                # 執行全部回歸測試；最新驗證見 docs/VALIDATION.md
npm run build
npm run dev             # vite --host 127.0.0.1
```

開 Vite 印出嚟嘅網址，揀 **紙本與 Excel** → **檢視 mock 範例**，可以先睇中文工作簿再決定合併。想睇 production bundle 就跑 `npm run preview`。

| 檔案 | 用途 |
| --- | --- |
| [docs/EXCEL_WORKFLOW.md](docs/EXCEL_WORKFLOW.md) | 中文六表流程同更正規則 |
| [public/demo/careflow-paper-excel-mock.xlsx](public/demo/careflow-paper-excel-mock.xlsx) | 手造範本。入面有 14 個下拉選單同凍結窗格，SheetJS 讀唔到呢啲格式資訊 —— **唔好**用 SheetJS 重寫佢，會靜靜哋拆走 |
| [public/demo/careflow-field-outreach-demo.xlsx](public/demo/careflow-field-outreach-demo.xlsx) | 舊英文工作簿，一樣支援 |

## 設定

預設底圖係 OpenFreeMap Positron，要連網先攞到圖磚、glyph 同 style 資源。

```bash
VITE_MAP_STYLE_URL=https://example.org/style.json npm run dev
```

`VITE_` 開頭嘅嘢會入到瀏覽器 bundle，**唔好**放密碼，見 [.env.example](.env.example)。應用程式碼唔會將業務記錄送去地圖供應商；供應商收到嘅係正常請求地圖資源時附帶嘅網絡資訊。

## 靜態部署

```bash
npm ci && npm run demo:generate && npm run build
```

將 `dist/` 由靜態網站根目錄提供就得，唔需要 runtime server 或者密碼。應用用根相對路徑 `/demo/careflow-field-outreach-demo.xlsx`，擺喺子目錄就要改 base path。

要交去 VPS（對方部機唔使裝 Node）就用容器：`docker compose up -d --build`，預設只開宿主機 `127.0.0.1:8080`（公開演示須設定 `WEB_BIND=0.0.0.0`）。完整步驟、驗證清單同排錯見 [docs/DOCKER.md](docs/DOCKER.md)。容器一樣冇後端、冇登入，資料照樣留喺訪問者自己個瀏覽器。

`.openai/hosting.json` 係 owner-only hosting 用；private 示範**唔等於**有 NGO 認證或者正式資料管控。

## 專案結構

- [`src/domain/`](src/domain/) — 領域記錄同覆蓋摘要（瀏覽器無關）
- [`src/data/`](src/data/) — 工作簿適配、repository 邊界、本機持久化、合成 fixtures
- [`src/app/`](src/app/) — Zustand 工作區狀態同應用組裝
- [`src/map/`](src/map/) — MapLibre 場景同與 renderer 無關嘅空間 view model
- [`src/components/`](src/components/) — 匯入、樓宇、觀察、歷史流程
- [`scripts/generate-demo.ts`](scripts/generate-demo.ts) — 確定性合成工作簿生成器
- [`docs/`](docs/) — 來源評審、架構、決策、示範劇本
- [`public/demo/`](public/demo/) — 應用會 fetch 嘅工作簿；[`samples/`](samples/) — 歸檔用嘅重複副本，build 唔會用到

邊啲係原始碼、邊啲係生成、點重建，睇 [INDEX.md](INDEX.md)；證據邊界睇 [docs/SOURCE_REVIEW.md](docs/SOURCE_REVIEW.md)；已實作設計睇 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 真正試點之前

要攞到同核實：真實紙本表格、人物層／樓宇層工作簿、覆蓋同重訪定義、成員同住戶規則、裝置同網絡條件，仲有機構嘅存取、保留、刪除、備份同外部供應商政策。合成適配器要逐步換走，**唔好**將真實記錄上傳入呢個原型。

自動檢查、瀏覽器驗證同未測試嘅運行條件見 [docs/VALIDATION.md](docs/VALIDATION.md)。
