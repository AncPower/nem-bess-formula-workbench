# nem-bess-formula-workbench

協助儲能（BESS）在澳洲 NEM NSW1 區域做充放電決策與收益評估的**公式工作台**。頁面列出幾條建議公式，公式本身、公式裡的輸入資料與權重都能由使用者自行設計與調整，畫面即時算出調整後的結果；每條公式旁邊說明原則、方法、建議怎麼選，以及來源。

結果是**建議，不是預測**。

**直接使用：<https://ancpower.github.io/nem-bess-formula-workbench/>**。不需要安裝、帳號或在本機執行專案，用瀏覽器打開就能用；你調整的式子與數值只存在自己的畫面上，不會影響別人。

## 一個網址、兩個分頁

| 分頁 | 網址 | 給誰 | 回答什麼 |
|---|---|---|---|
| 預調度 | [`#predispatch`](https://ancpower.github.io/nem-bess-formula-workbench/#predispatch)（預設） | 交易或調度人員，每天多次 | 依最新預調度電價，今天要執行還是等待、這個循環能賺多少 |
| 情境評估 | [`#scenario`](https://ancpower.github.io/nem-bess-formula-workbench/#scenario) | 營運主管、決策者，每週或每月 | 價差標準要不要調、目標期間大概能賺多少 |

兩個分頁共用同一份公式登記檔、變數目錄、計算引擎與設備參數。

## 預設公式

| 公式 | 式子 | 分頁 |
|---|---|---|
| 價差 | `discharge_price - charge_price` | 兩頁共用 |
| 每循環淨收益 | `capacity_mwh * mlf * (rte * discharge_price - charge_price) - capacity_mwh * rte * degradation_cost` | 兩頁共用 |
| 執行或等待 | `and(spread >= spread_standard, cycle_net_revenue > 0)` | 預調度 |
| 因素調整倍數 | `(w_demand * idx_demand + w_supply * idx_supply + w_battery * idx_battery) / (w_demand + w_supply + w_battery)` | 情境評估 |
| 目標期間收益 | `days * availability * daily_revenue * factor_multiplier` | 情境評估 |

使用者可以：

- 改任何輸入值或權重，所有用到它的公式一起更新。
- 改寫式子；式子裡出現新名稱時，左側自動多一個輸入欄。
- 一鍵還原單條式子或全部設定。

## 設計原則

- **骨幹與肌肉**：骨幹是式子解析器、計算引擎、資料轉接與卡片介面，很少變動；肌肉是公式與變數，全部寫在 `formulas/` 的 JSON 裡。新增公式只要多加一筆，不用改程式。
- **MVP 優先**：需求依 MoSCoW 排序，Must 全部完成才算 MVP。三個面向的需求表見 [`docs/requirements.md`](docs/requirements.md)。
- **單一來源**：設備參數與價差標準只放在 `config/`，兩個分頁都讀同一份。
- **不用 eval**：式子由白名單解析器求值，只支援數字、變數、運算子與列出的函式。

架構與公式格式見 [`docs/architecture.md`](docs/architecture.md)。

## 資料

| 資料 | 來源 | 用在哪 |
|---|---|---|
| 30 分鐘預調度電價 | AEMO NEM 資料儀表板背後的 API（允許跨網域讀取，沒有公開文件） | 預調度分頁的充放電均價 |
| 設備參數 | `config/battery.json` | 容量、功率、來回效率、損耗成本、MLF |
| 價差標準 | `config/spread_standard.json` | 執行或等待 |

AEMO API 讀取失敗時，可以直接在左側手動輸入均價。

## 本機執行

頁面用 ES module，要經過 HTTP 才能開：

```bash
python3 -m http.server 8000
```

然後開 <http://127.0.0.1:8000>。

## 測試

需要 Node 22 以上，沒有 npm 依賴：

```bash
node --test "tests/*.test.js"
```

測試涵蓋式子解析、計算引擎、公式登記檔格式檢查（每條公式都必須有原則、方法、建議與至少一個 https 來源）與預調度選窗。CI 在每個 PR 執行。

## 發佈

GitHub Pages 從 `main` 分支根目錄發佈，合併即上線。repo 公開，所以公式、設備參數與價差標準都是公開的。
