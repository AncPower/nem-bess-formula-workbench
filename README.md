# nem-bess-formula-workbench

協助儲能（BESS）在澳洲 NEM NSW1 區域做充放電決策與收益評估的**公式工作台**。頁面列出幾條建議公式，公式本身、公式裡的輸入資料與權重都能由使用者自行設計與調整，畫面即時算出調整後的結果；每條公式旁邊說明原則、方法、建議怎麼選，以及來源。

結果是**建議，不是預測**。

**直接使用：[NEM BESS 公式工作台](https://ancpower.github.io/nem-bess-formula-workbench/)**。不需要安裝、帳號或在本機執行專案，用瀏覽器打開就能用；你調整的式子與數值只存在自己的畫面上，不會影響別人。

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
| 每日執行淨收益 | `executed_cycle_net_revenue`（已執行循環加總） | 預調度 |
| 因素調整倍數 | `(w_demand * idx_demand + w_supply * idx_supply + w_battery * idx_battery) / (w_demand + w_supply + w_battery)` | 情境評估 |
| 目標期間收益 | `days * availability * daily_revenue * factor_multiplier` | 情境評估 |

使用者可以：

- 改任何輸入值或權重，所有用到它的公式一起更新；逐循環產生的彙總輸入為唯讀。
- 改寫式子；式子裡出現新名稱時，左側自動多一個輸入欄。
- 一鍵還原單條式子或全部設定。

情境評估另有歷史價差標準檢討，可選期間與試算標準、保留率門檻、效率及損耗，查看收益保留率、錯失日期／收益、排除日期與成本參考。它採登記檔建議公式，不採其他卡片的臨時改寫；不寫回價差標準。效率及損耗試算沿用既有窗口，不重新最佳化。每日收益分位數仍手動輸入，不以當日計畫取代；歷史檢討不會建議上調，也未排除事件日。

## 設計原則

- **骨幹與肌肉**：骨幹是式子解析器、計算引擎、資料轉接與卡片介面，很少變動；肌肉是公式與變數，全部寫在 `formulas/` 的 JSON 裡。新增公式只要多加一筆，不用改程式。
- **MVP 優先**：需求依 MoSCoW 排序，Must 全部完成才算 MVP。需求與完成狀態只維護於 [`docs/requirements.md`](docs/requirements.md)。
- **單一來源**：設備參數與價差標準只放在 `config/`，兩個分頁都讀同一份。
- **不用 eval**：式子由白名單解析器求值，只支援數字、變數、運算子與列出的函式。

設計與資料契約見 [`docs/architecture.md`](docs/architecture.md)；驗收證據留在對應 PR 描述與 CI，不另建驗收文件。

## 資料

| 資料 | 來源 | 用在哪 |
|---|---|---|
| 30 分鐘預調度電價 | AEMO NEM 資料儀表板背後的 API（允許跨網域讀取，沒有公開文件） | 預調度分頁的充放電均價 |
| 歷史每日摘要 | 本 repo 直接下載 [AEMO MMSDM 公開月檔](https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM/)，產生 `data/daily_summary.json` | 情境頁的歷史價差標準檢討 |
| 設備參數 | `config/battery.json` | 容量、功率、來回效率、損耗成本、MLF |
| 價差標準 | `config/spread_standard.json` | 執行或等待 |

AEMO API 讀取失敗時，可以直接在左側手動輸入均價。

## 獨立下載與每月更新

需 Python 3.12+、Node 22+，沒有第三方 Python 或 npm 依賴。直接從公開 AEMO 來源下載，不需 GitLab、私有 Token 或其他 repo。

```bash
# 範例期間；每月更新時明確指定已發布資料的起訖交易日
python analysis/download.py --start 2026-03-01 --end 2026-08-30
node analysis/build.mjs
node analysis/verify.mjs
```

下載器可用 `--cache` 指定 ZIP 快取目錄（預設 `.cache/aemo`）、`--output` 指定正規化資料路徑（預設 `.cache/history.json`）。使用自訂輸出時，將同一路徑傳給產製器：

```bash
node analysis/build.mjs <正規化資料路徑>
```

每月重跑下載、產製及驗證，檢查摘要的來源、涵蓋期間、排除日期與原因，再將 `data/daily_summary.json` 經 PR 審查發布。原始 ZIP 與快取不進 git；不自動縮短未發布月份，不自動修改標準、不自動每月提交或合併。變更公式、設備或產製程式後須重產，不能只修改指紋。

## 本機執行

頁面用 ES module，要經過 HTTP 才能開：

```bash
python3 -m http.server 8000
```

然後開 [本機工作台](http://127.0.0.1:8000)。

## 測試

```bash
python -m unittest discover -s tests -p 'test_*.py'
node --test "tests/*.test.js"
node analysis/verify.mjs
```

測試涵蓋式子解析、計算引擎、公式登記檔格式與來源、預調度選窗、下載快取與錯誤、歷史產製及檢討互動。CI 在每個 PR 執行 Python／Node 測試與摘要指紋驗證；已有摘要時不重新下載。來源下載測試使用替身，不能等同每次 CI 都完成真實資料下載；真實資料證據留在對應 PR 與 CI。

## 發佈

GitHub Pages 從 `main` 分支根目錄發佈，合併即上線。repo 公開，所以公式、設備參數、價差標準與歷史摘要都是公開的。
