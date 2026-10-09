# 照片回錄

基於 CareFlow-hk/Atlas `7805e03`，參考初版 CareFlow 的 `VolunteerUpload.tsx`、`VolunteerReview.tsx` 和 `backend/app/llm/vision.py`，把上傳、原圖核對與確認保存接到 Atlas 現有到訪／跟進模型。

## 操作

1. 登入並載入街區；按頁首「照片回錄」。
2. 選擇或拖入 JPG、PNG、WebP，手機也可拍攝。每張最多 15 MB，每批 8 張。HEIC/PDF 需要先轉成支援的圖片格式。
3. 按「開始辨識」後逐張送往 Azure；每張最多 60 筆。可停止，失敗可只重試該張。已完成頁面可以先核對。
4. 原圖旁逐筆確認位置、日期、紙本工作員與探訪結果。大廈／單位只做唯一配對，明確的數字樓層寫法（例如 `1樓`／`1層`／`1/F`／`1F`）視為同一樓層；有歧義時保留空白。不確定的選項、缺少年份及未辨識位置由人補上。也能略過某筆、手動補錄。
5. 每筆都確認後，預覽新增到訪和待跟進，再一次儲存。結果會反映到地圖、位置歷史及 Excel 匯出。

「試用示範紙本」是固定合成內容，不呼叫 AI，歷史會標明示範。API 未配置時不會偷偷用示範內容替代辨識；可選擇手動對照照片回錄。

## Azure 配置

伺服器 `.env`：

```dotenv
AZURE_OPENAI_ENDPOINT=https://CareFlow-VPS.services.ai.azure.com/openai/v1
AZURE_OPENAI_DEPLOYMENT=gpt-6-luna
AZURE_OPENAI_FALLBACK_DEPLOYMENT=gpt-6.1-sol
AZURE_OPENAI_API_KEY=
```

填入自己的 API key，重啟 `npm run auth:dev`。不要使用 `VITE_` 前綴。前端、瀏覽器儲存及 Git 都不接收 API key。配置狀態只表示伺服器已讀到配置，不代表已驗證 Azure 配額或模型能力。

本機開發另需 `APP_ORIGIN=http://127.0.0.1:5173` 和 `ALLOW_INSECURE_LOCALHOST=true`；執行 `npm run auth:dev`、`npm run dev`。帳號初始化沿用 [ACCOUNTS.md](./ACCOUNTS.md)。

服務使用 Azure OpenAI v1 Responses REST endpoint、`input_image`（`detail: original`）、strict JSON schema 和 `store:false`。首輪部署為 `gpt-6-luna`，符合下述門檻才以同一 endpoint/key 呼叫 `gpt-6.1-sol`。`AZURE_OPENAI_FALLBACK_DEPLOYMENT` 留空可停用第二輪；與首輪同名時也不重複呼叫。既有 Node 服務使用內建 fetch，無須另起 Python 服務。認證採 API key；目前沒有新增 Entra ID token 流程。

依據：[OpenAI 圖片輸入文件](https://developers.openai.com/api/docs/guides/images-vision)、[Azure Responses 文件](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses?view=foundry-classic)。

## 保守 fallback

門檻固定於 `server/photos.mjs` 的 `FALLBACK_POLICY`，不是前端可覆寫的參數。Luna 必須在 strict JSON 中指出實際看不清的欄位；原本空白或缺少年份不算辨識疑點。

- 至少 60% 的記錄同時滿足：`confidence < 0.70`，且有至少 2 個不同的關鍵欄位看不清。關鍵欄位包含大廈、地址、樓層、單位、範圍、探訪／接觸結果、原話、跟進及時間原話；日期、工作員不參與門檻。
- 可辨為模糊而整張讀不出記錄（`UNREADABLE`），或 Luna 回覆不是有效 JSON／不符合 schema／因 output token 上限截斷，也可升級。
- 空白表格、非外展照片、超過 60 行、一般 warnings，以及 UI 的 `confidence < 0.8` 人工核對提示，都不會自行升級。登入／權限／配額／HTTP／網路錯誤、首輪逾時、內容拒絕和使用者停止不觸發第二輪。
- 每張最多兩次 provider 呼叫，沒有自動重試循環。Sol 獨立讀同一張處理後圖片，不接收 Luna 的猜讀答案。帳號／全域並發名額涵蓋兩輪；停止或斷線會中止進行中的呼叫。
- Sol 完成後，UI 顯示「已完成進階辨識」、原因和實際模型，仍須人工逐筆核對。Sol 失敗或記錄數減少時保留可用 Luna 結果並明示；兩輪皆失敗則報錯。內容拒絕不以首輪資料繞過。
- 草稿、入庫 metadata 及 Excel 關聯封存保留 primary/fallback model、觸發原因、採用或保留狀態；`photoSource.model` 永遠是目前結果的實際模型。

這是成本較保守的啟發式門檻，不是準確率保證。模型的把握分數與疑點都是模型自評，高把握誤讀可能不升級。不能把未觸發 fallback 解讀成辨識正確。

## 部署

Compose 的 auth 服務會接收這四個 server-only 環境變數。每輪最多 90 秒，整張最多 180 秒；瀏覽器等待 200 秒。Nginx 為 `/api/photos/recognize` 單獨設定 5 MB 請求限制及 195 秒回覆等待；帳號接口仍為 8 KB。需要重新建置 **web 與 auth 兩個服務**，不能只發布靜態 `dist`。

沿用原 Compose project 與 `accounts` volume，按現有帳號備份流程處理。部署前確認 APP_ORIGIN、HTTPS、volume 與 key；此改動沒有執行遠端部署。

## 資料與核對邊界

- 照片先在瀏覽器校正 EXIF 方向，縮至最長邊 2400px、轉 JPEG 並去除原檔 metadata。只有按辨識才傳送處理後圖片。此處「原圖」是用於核對的處理後圖片。
- 伺服器需要有效帳號、同源請求、CSRF，並限制每帳號 40 次／15 分鐘、單帳號同時 1 張、服務最多同時 4 張。只在記憶體處理，不把照片寫入伺服器檔案；不記錄圖片、API key 或原始 provider error。
- 使用 Azure 外部模型，不是離線 OCR。`store:false` 不構成對 Azure 所有服務日誌或保留政策的保證。
- 草稿（包括處理後圖片）按帳號隔離保存在本瀏覽器 IndexedDB；刷新可恢復。儲存到訪成功後移除該批草稿。草稿儲存失敗會顯示提示；原有不合法草稿不會自動覆蓋。
- 到訪仍沿用 Atlas 的帳號分隔 localStorage 工作區，**沒有新增跨裝置業務資料同步**。現有 domain 仍是合成資料模式，不能把本功能當成真實 NGO 個資上線驗收。
- 只轉錄明確記載的跟進；相對時間保持原話，未明的日期、工作員、接觸與住房判斷不自行補全。核對人與紙本工作員分開保存。
- 每批全部校驗後做一次資料寫入；任何格式、關聯或儲存失敗都不發布部分成功狀態。舊記錄不覆寫。
- 原始檔案 SHA-256 與行序產生穩定記錄 ID，相同檔案改名再匯入會略過已保存行。不同照片、裁切或重新編碼的同一張紙本不保證自動判重，需要人工核對。
- 保存檔名、紙本行、模型、來源指紋、核對帳號／時間；圖片不包含在入庫記錄或 Excel 裡。既有 Excel 關聯封存保留照片來源 metadata。

## 驗證

`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:auth`、`npm run build`。

新增測試包含未知／歧義位置、缺欄、非法日期、跨大廈單位、整廈結果不代填子單位、逐筆核對、原子追加、重複入庫、相對時間、Excel 往返、API key 隱藏、圖片格式／容量、Responses payload、provider 錯誤／拒絕／不完整回覆、逾時與並發限制、登入／CSRF／同源檢查。

瀏覽器驗證：桌面 1440×960、手機 390×844；未配置狀態、示範原圖與欄位、刷新恢復已核對草稿、逐筆確認、入庫摘要、保存後地圖／歷史／待跟進連動。

2026-10-03 已使用配置的 Azure `gpt-6-luna` 做 4 次真實呼叫，輸入為自製、含 2 筆虛構記錄的繁體中文印刷表格，不含真實個人資料。前兩次 `high` 模式對「社區客廳活動」出現漏字／誤字；改用 `original` 後，兩次重測均保留完整活動名稱。這只證明該樣本的改善，不代表一般 OCR 準確率或手寫驗收。

最終設定已從瀏覽器上傳、經真實 API 返回並核對：2 筆結果、唯一樓層／單位配對、無跟進行動時類別留空、未記載的住房判斷留空、「下星期再聯絡」保留原話、沒有推算確定日期或填入負責人。首輪結果已人工修正並入庫為 2 筆到訪與 1 項跟進；重複上傳同檔後略過 2 筆，沒有新增或覆寫歷史。實際手寫紙本、反光／傾斜照片和多人操作仍需要另外驗證。


2026-10-04 fallback 真實 API 測試使用三張先前生成的合成手寫圖片：

| 圖片 | 路由 | 耗時 | 結果與限制 |
| --- | --- | --- | --- |
| 01 清晰手寫 | Luna，一次 | 18.1 秒 | 沒有觸發；仍誤讀地址、工作員和「社區客廳」等字詞。 |
| 02 潦草塗改 | Luna，一次 | 17.3 秒 | 沒有觸發；仍誤讀地址及若干探訪／跟進原話。 |
| 04 模糊缺欄 | Luna → Sol，兩次 | 35.3 秒 | Luna 自評 0.38、4 個關鍵欄位不清，達到門檻；Sol 讀回德昌樓、西營盤示範街16號、全幢大廈、門禁未能進入／未接觸及改日再訪。年份、工作員、確定跟進日期、負責人留空；「時間未定」保留疑點。 |

修改前的 Luna 基線也曾把模糊圖的大廈讀成「沙田大樓」、跟進讀成「致電查詢」（自評 0.67）。這是同一合成圖片上的前後比較，模型輸出有隨機性；三張圖片不能估計整體正確率或一般 fallback 比率。

自動測試涵蓋門檻邊界、缺欄／單一疑點不升級、同圖獨立呼叫、最多兩輪、錯誤／拒絕／取消不誤升級、失敗保留首輪與模型來源、帳號並發鎖，以及草稿／入庫／Excel 的 fallback metadata 往返。

瀏覽器另以相同像素、加入測試 metadata 的 PNG 副本走過 JPEG 前處理、登入／CSRF、真實 Luna→Sol 呼叫及核對畫面：顯示進階辨識，正確配對德昌樓與全廈範圍；未能進入、未接觸住戶及改日再訪有保留，未補日期／工作員。原有草稿保留，測試副本未入庫。瀏覽器這次 Sol 把「時間未定」也放進跟進行動，仍需人工核對欄位拆分。

本次檢查：380 項前端／資料測試與 30 項伺服器測試通過，build、lint 通過。
