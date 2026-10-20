# 架構

## 骨幹與肌肉

| 層 | 內容 | 變動頻率 |
|---|---|---|
| 骨幹 | `src/expression.js` 式子解析器、`src/engine.js` 計算引擎、`src/registry_check.js` 格式檢查、`src/predispatch.js` 資料轉接、`src/app.js` 介面 | 低 |
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
| `unit` | 是 | 單位，可為空字串 |
| `format` | 是 | `number`、`currency` 或 `decision`（1＝執行，0＝等待） |
| `expression` | 是 | 式子 |
| `guidance.principle` | 是 | 原則 |
| `guidance.method` | 是 | 方法 |
| `guidance.how_to_choose` | 是 | 建議怎麼選 |
| `guidance.sources` | 是 | 至少一個 `{ title, url }`，網址必須是 https |

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
