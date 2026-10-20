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

同層公式可互相引用，跨層公式不可直接引用；每日只能透過宣告的彙總輸入取用循環輸出。格式檢查及使用者改寫後的執行階段都會阻擋跨層引用。循環來源或判斷有錯時，每日相關公式顯示錯誤，不以零代替；加總溢位亦顯示錯誤。空循環陣列表示合法的零循環計畫，彙總為零，不可用來表示資料缺漏；未來 T6 必須另行排除不完整日期。

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
