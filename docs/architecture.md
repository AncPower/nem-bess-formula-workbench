# 架構

## 骨幹與肌肉

| 層 | 內容 | 變動頻率 |
|---|---|---|
| 骨幹 | `src/expression.js` 式子解析器、`src/engine.js` 計算引擎、`src/day.js` 逐循環與每日彙總編排、`src/registry_check.js` 格式檢查、`src/predispatch.js` 資料轉接、`src/app.js` 介面 | 低 |
| 肌肉 | `formulas/registry.json` 公式、`formulas/variables.json` 變數 | 高 |
| 設定 | `config/battery.json` 設備參數、`config/spread_standard.json` 價差標準 | 經 PR 檢討後才改 |

新增一條公式只要在 `formulas/registry.json` 多加一筆；需要新輸入時在 `formulas/variables.json` 多加一筆。骨幹不用改。

## 變數值的優先順序

使用者覆寫 > 資料轉接（`data`）> 設定檔（`config`）> 預設值（`default`）。畫面上每個輸入欄都標示目前的值來自哪裡。

## 公式格式

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | 是 | 小寫英數與底線；同時是輸出變數名，後面的公式可以引用 |
| `name` | 是 | 顯示名稱 |
| `page` | 是 | `predispatch`、`scenario` 或 `shared` |
| `scope` | 是 | `cycle` 每循環、`daily` 每日彙總、`scenario` 情境計算；與顯示分頁分開 |
| `unit` | 是 | 單位，可為空字串 |
| `format` | 是 | `number`、`currency` 或 `decision`（1＝執行，0＝等待） |
| `expression` | 是 | 式子 |
| `guidance.principle` | 是 | 原則 |
| `guidance.method` | 是 | 方法 |
| `guidance.how_to_choose` | 是 | 建議怎麼選 |
| `guidance.sources` | 是 | 至少一個 `{ title, url }`，網址必須是 https |

## 每循環與每日兩層（T11）

`compute()` 仍是唯一的式子計算引擎；`compute_day()` 只編排執行順序，沒有第二套收益公式。預調度頁先算每個循環，再算每日彙總；情境頁保留原本手動輸入的 `daily_revenue`，不以當日計畫取代歷史收益分位數。

```js
const plan = compute_day({
  registry, catalog, context: { config },
  cycles: [{ predispatch: selected_cycle }],
  value_overrides, expression_overrides,
});
// plan.cycles: one compute() result per supplied cycle
// plan.daily: compute() result for daily formulas
```

每個循環是資料物件，沿用 `predispatch.charge_average_price` 與 `predispatch.discharge_average_price`。呼叫端負責提供同一日、時序與設備條件合法的循環；此函式不選窗、不檢查重疊，也不代表已完成 P12。MVP 的頁面固定只傳一個循環，卡片標明是目前單循環計畫，不宣稱涵蓋完整市場日。

登記檔頂層的 `aggregates` 宣告每日可用的唯讀彙總輸入：

```json
{
  "executed_cycle_net_revenue": {
    "formula": "cycle_net_revenue",
    "when": "dispatch_decision"
  }
}
```

`formula` 與 `when` 必須引用 `cycle` 公式，且 `when` 必須是 `decision` 格式。逐循環計算後，僅加總判斷非零的來源值；每日公式 `daily_net_revenue = executed_cycle_net_revenue` 仍可由使用者改寫。彙總輸入本身不能用手動值覆蓋，要改結果應調整循環輸入、判斷或每日式子。

同層公式可互相引用，跨層公式不可直接引用；每日只能透過宣告的彙總輸入取用循環輸出。格式檢查及使用者改寫後的執行階段都會阻擋跨層引用。循環來源或判斷有錯時，每日相關公式顯示錯誤，不以零代替；加總溢位亦顯示錯誤。空循環陣列表示合法的零循環計畫，彙總為零，不可用來表示資料缺漏；歷史產製另行排除不完整日期。

## 獨立歷史資料流程（T6）

| 模組 | 職責 |
|---|---|
| `analysis/download.py` | Python 標準函式庫下載公開月檔、驗證快取雜湊、篩選並正規化 NSW1 結算價 |
| `analysis/build.mjs` | 讀正規化價格，檢查每日完整性，沿用 `best_single_cycle()` 與 `compute_day()` 產製每日摘要 |
| `analysis/verify.mjs` | 驗證已提交摘要的來源、程式／公式／設定指紋及可供檢討的有效日 |
| `src/history_review.js` | 純計算的歷史收益保留率與成本參考 |
| `src/history_panel.js` | 載入摘要、比對前端公式／設備雜湊、呈現歷史檢討與試算欄位 |

資料流為 AEMO ZIP → `.cache/history.json` → `data/daily_summary.json` → 情境分頁。原始 ZIP 與正規化資料留在被忽略的 `.cache/`；只發布精簡摘要。下載與每月更新命令見 [README](../README.md#獨立下載與每月更新)，不需私有 Token 或其他 repo。

### 來源、時間與失敗邊界

來源固定為 [AEMO MMSDM 公開封存區](https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM/)，只下載 `TRADINGPRICE`，不下載預調度、P5MIN 或因素擬合資料。下載格式參考 [上游下載器](https://git.ancillarypower.com/data/nsw-dispatch-revenue/nem-forecast-reliability/-/blob/HEAD/ingest/download_aemo_tables.py)，觀察到的 blob 為 `7ceb34dafbf0ef09094042297804f46f43363b6c`；不依賴其私有套件。

2024-07 及以前使用 `PUBLIC_DVD_TRADINGPRICE_YYYYMM010000.zip`，2024-08 起使用 `PUBLIC_ARCHIVE%23TRADINGPRICE%23FILE01%23YYYYMM010000.zip`，目錄為 `MMSDM_Historical_Data_SQLLoader/DATA/`。月份涵蓋明確起訖交易日及末日 24:00 的次日 00:00；結算價不套用預測資料的前兩日回看。

保留 NSW1、`INVALIDFLAG=0`、`PRICE_STATUS=FIRM`。NEM 採固定 UTC+10，不採 NSW 日光節約時間；區間時間為結束時刻，00:00 屬前一日。產製器以 UTC 字串運算固定市場時鐘座標，不表示來源時間已轉成 UTC。

每個交易日必須有 288 個對齊且去重的 5 分鐘時段；每六筆平均成一個 30 分鐘時段。缺整日或部分時段均排除並記原因，不補值；只有完整資料但沒有合適循環才是有效零收益日。衝突重複價格、非有限值、缺欄或不合格式時失敗。404 不會靜默縮短期間。正規化資料與摘要以暫存檔後替換，不讓失敗產製覆蓋舊摘要；快取不是整批交易，部分成功月檔仍可保留供重跑。

下載器限制每個 ZIP 128 MiB、唯一 CSV 1 GiB，下載逾時 60 秒。來源 URL、ZIP SHA-256 與下載時間存於快取 manifest；雜湊用於一致性追蹤，不是 AEMO 獨立簽章。

### 單循環摘要契約

每日從空電池開始、窗口不跨午夜，MVP 僅選一個先充後放循環。產製器要求容量／功率對應整數個 30 分鐘時段，完整充放兩段須容納於 48 段內。沿用本 repo 既有選窗與公式引擎，不移植另一套 Python 收益公式；舊最多雙循環摘要不能冒充本次結果。

`data/daily_summary.json` 的 `schema_version=2`，包含區域、固定市場時區、`max_cycles=1`、產生時間、設備規格、來源 manifest、正規化資料 SHA-256、指定期間內每一天，以及產製程式／公式／設定的 `input_fingerprint`。每循環記充放電開始、均價、價差與淨收益；每日記日期、排除狀態、原因、循環陣列及淨收益。

改設備、公式或指紋涵蓋的程式後必須重產，不可只改 metadata。前端檢查登記檔、變數目錄及設備雜湊；完整程式指紋由 CI 驗證。每日摘要不會取代手動 `daily_revenue`。

## 歷史價差標準檢討（P13）

`review_history()` 讀取有效摘要，逐循環以共用引擎重算收益，依價差達標與正淨收益選取，再彙總每日／期間結果。試算僅在畫面上，不寫回設定檔；使用登記檔建議公式，不採其他卡片臨時改寫。

可調起訖日、試算標準、保留率門檻（預設 99%）、效率及損耗成本。效率／損耗試算沿用原窗口，可能漏掉新參數下更好的機會，不代表重新最佳化。候選標準從 0 至最高價差的整數部分，每 1 AUD/MWh 掃描，另直接評估試算標準（含非整數或超出範圍）；最高價差超過 100000 時拒絕掃描。

結果含執行天數、淨收益、錯失日期／收益、保留率、保留範圍與損益兩平價差的中位數及範圍。保留率達門檻為維持，否則建議下調；沒有有效日或正基準收益時不提供建議。少於 60 個有效日提示樣本不足，只含一季提示季節限制。成本參考不限制保留範圍。事後價格未含預測誤差，因此不建議上調；P14 前不排除事件日。

## 每日收益分位數（P8）

`review_history()` 額外輸出選定標準下的 `daily_revenues`，與既有期間收益共用每日篩選及共用引擎。`src/history_quantiles.js` 對有效每日值排序、線性插值，並管理參考日期、標準及 P10／P50／P90 選擇；不另建收益公式，不重產或修改摘要。

`state.scenario_history` 保存本次頁面的歷史模式。只有明確啟用才以執行階段變數目錄將 `daily_revenue` 接到資料來源；使用者覆寫仍優先。手動修改／全部還原會離開歷史模式；啟用中的日期或樣本錯誤以 `variable_errors` 傳給情境公式，不能回退成預設收益。此目錄轉接不修改公式檔或指紋。

歷史模式沿用設定檔設備與建議公式，不採卡片臨時改寫。缺資料日排除，有效零收益日納入；P10 是數值第 10 百分位而非超越機率。分位數參考欄位獨立於 P13 的臨時試算，兩者不會互相修改。

## 分享與比較（P7）

`src/share_state.js` 是純函式模組：`share_snapshot()` 取出會影響結果的設定，`encode_share()`／`decode_share()` 以 base64url JSON 放進網址 `?s=`，`compare_rows()` 逐條比較兩組結果。分頁仍用 `#predispatch`／`#scenario`，兩者互不干擾。

| 保存 | 不保存 |
|---|---|
| `value_overrides`、`expression_overrides`、被引用的 `custom_labels`、啟用中的 `scenario_history` 條件（起訖日、標準、分位數） | AEMO 電價、歷史摘要、算出的每日收益、未啟用的歷史欄位、P13 臨時試算 |

解碼採白名單並整份拒絕：版本必須是 1、不允許未知欄位；公式 id 必須在登記檔，式子不超過 500 字；變數必須在變數目錄、自訂名稱或改寫式子中出現，且不能是 `aggregates` 宣告的彙總輸入；自訂名稱的代號必須等於由名稱產生的代號（與 `key_of` 共用 `custom_key()`）；日期為 `YYYY-MM-DD`、分位數只接受 P10／P50／P90。編碼後超過 6000 字元時拒絕產生。產生網址前先自我解碼一次，不給出打不開的網址。式子本身仍由既有解析器在計算時檢查，錯誤顯示在卡片上。

比較區以 `evaluate_view(default_settings())` 計算預設版：同一份 `state.data` 與設定檔，沒有覆寫、改寫或歷史模式；目前版本即畫面上的結果。兩者只差在使用者設定，不代表不同時點的電價差異。

## CI 與發布邊界

一般 PR 驗證已提交摘要及全部 Python／Node 測試，不自動重產已有摘要。若沒有摘要，現有工作流程使用固定範例期間下載並產製；僅在 `feat/t6-p13-standalone-data` 的同 repo PR 可由 `analysis/publish_snapshot.py` 發布首次摘要，透過原 HEAD 檢查與非強制更新保護並行修改，不推 `main`。

該首次發布腳本使用 GitHub Token，並回填新摘要提交的 `test` 狀態；這是指向來源流程的證據，不等於新提交已重新執行完整 CI。合併必須以最新內容的實際完整 check 為準。這不是每月自動更新機制，也不會自動修改標準或合併。

文件分工固定：設計在本文件，操作在 README，需求狀態只在 [requirements.md](requirements.md)，驗收證據在對應 PR 描述與 CI。本文不保存單次驗收日誌或重複需求狀態。

## 變數格式

| 欄位 | 必填 | 說明 |
|---|---|---|
| `key` | 是 | 小寫英數與底線 |
| `label` | 是 | 顯示名稱 |
| `unit` | 是 | 單位；沒有單位填 `—` |
| `default` | 是 | 預設值，數字 |
| `source.type` | 是 | `user`、`config` 或 `data` |
| `source.ref` | `config`、`data` 時必填 | 路徑，例如 `battery.power_mw`、`predispatch.charge_average_price` |
| `hint` | 否 | 輸入欄下方的提示 |

## 式子語法

| 類別 | 支援 |
|---|---|
| 運算 | `+ - * / ^`、括號、負號 |
| 比較 | `> >= < <= == !=`，成立為 1、不成立為 0 |
| 函式 | `min`、`max`、`abs`、`round(x, 小數位)`、`if(條件, 成立值, 不成立值)`、`and(...)`、`or(...)` |

## 錯誤處理

| 情況 | 行為 |
|---|---|
| 式子無法解析 | 該卡片顯示錯誤；引用它的公式顯示「引用的公式無法計算」；其他公式照常 |
| 公式互相引用 | 顯示循環引用錯誤 |
| 結果不是有限數值 | 顯示「可能除以 0」 |
| AEMO API 失敗 | 保留預設或上次的值，提示可以手動輸入 |
| 登記檔格式錯誤 | CI 失敗；頁面列出問題，不顯示任何結果 |
