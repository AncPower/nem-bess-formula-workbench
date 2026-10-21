# 專案地圖

讀者：第一次改這個 repo 的人、新的開發 session｜放：每個部分的用途、怎麼改、多常改、改了要連動哪裡｜不放：功能規格（[architecture.md](architecture.md)）、需求狀態與驗收標準（[requirements.md](requirements.md)）、畫面規格（[design.md](design.md)）｜更新時機：新增、刪除、搬移檔案或改變分工的 PR，在同一個 PR 更新本文件

## 1. 全貌

```text
formulas/ + config/ ─────────────┐
                                 ├─> src/ 計算核心 ─> src/ 畫面 ─> index.html（GitHub Pages）
AEMO API ─> src/ 資料轉接 ───────┘

AEMO MMSDM ─> analysis/ ─> data/daily_summary.json ─> 情境評估分頁
```

頁面是沒有後端的靜態網站，`main` 合併即上線。兩個分頁共用同一份公式登記檔、變數目錄、計算引擎與設定。

## 2. 更新頻率標記

| 標記 | 意思 | 改之前要做什麼 |
|---|---|---|
| 很少 | 核心或契約，牽動多處 | 先讀 architecture.md 對應章節；查是否在指紋範圍（第 5 節） |
| 每版 | 隨版本範圍改變 | 先確認 requirements.md 的版本小節已列入 |
| 每功能 | 做到這個功能才改 | 對應需求編號寫進 commit |
| 熱點 | 幾乎每個功能都會碰 | 能另開檔案就不要繼續往裡面加 |
| 每 PR | 每個 PR 都可能同步 | 只改狀態與連結，不寫長篇說明 |
| 每月 | 手動例行工作 | 照「每月更新與重產歷史資料」執行 |
| 一次性 | 階段性產物 | 用完就歸檔或移除 |

「熱點」依 2026-10-20 至 2026-10-21 的 commit 紀錄判斷；其餘標記是依檔案職責判斷的預期頻率，不是統計值。

## 3. 每個部分

### 根目錄

| 檔案 | 用途 | 用法 | 頻率 |
|---|---|---|---|
| `README.md` | 給使用者：用途、怎麼判讀結果、適用範圍、本機執行與測試 | 使用者看得到的行為改變時才改 | 每功能 |
| `index.html` | 頁面骨架；各區塊容器 id（`verdict`、`data-bar`、`price-chart`、`formula-list`、`compare-body`、`history-panel` 等），只載入 `src/app.js` | 新增畫面區塊時加容器 id | 每功能 |
| `styles.css` | 樣式；開頭的 CSS 變數對應 `docs/design-tokens.json` | 只用 token 變數，不寫死顏色 | 每功能 |
| `package.json` | 宣告 ES module、Node 22 以上、測試命令 | 沒有 npm 依賴；不新增套件 | 很少 |
| `.nojekyll` | 讓 GitHub Pages 原樣發佈 | 不要刪 | 很少 |
| `.gitignore` | 排除 `.cache/` 等本機產物 | 新增本機產物目錄時補上 | 很少 |

### formulas/、config/：公式與設定

| 檔案 | 用途 | 用法 | 頻率 |
|---|---|---|---|
| `formulas/registry.json` | 所有公式、說明與來源；頂層 `aggregates` 宣告每日彙總輸入 | 新增公式只要加一筆，格式見 architecture.md「公式格式」；每條公式都要有原則、方法、怎麼選與 https 來源 | 每功能；**在指紋範圍** |
| `formulas/variables.json` | 變數目錄：預設值、單位、值的來源 | 需要新輸入時加一筆；`source.type` 為 `user`、`config` 或 `data` | 每功能；**在指紋範圍** |
| `config/battery.json` | 設備參數 | 經 PR 檢討後才改 | 很少；**在指紋範圍** |
| `config/spread_standard.json` | 價差標準 | 經 PR 檢討後才改；頁面不會自動改 | 很少 |
| `config/dispatch.json` | 預調度範圍內最多循環數的預設值 | 只接受 1 到 `MAX_CYCLES` 的整數，不合法時頁面無法載入 | 很少 |

### src/：計算核心（不碰 DOM）

| 檔案 | 用途 | 用法 | 頻率 |
|---|---|---|---|
| `expression.js` | 白名單式子解析器 | 新增函式或運算子時，同步 architecture.md「式子語法」與 `formula_text.js` | 很少；**在指紋範圍** |
| `engine.js` | `compute()`：唯一的計算引擎 | 不另寫第二套收益或判斷算式 | 很少；**在指紋範圍** |
| `day.js` | `compute_day()`：先算每循環、再算每日彙總 | 只負責執行順序，不選窗、不檢查重疊 | 很少；**在指紋範圍** |
| `registry_check.js` | `check_registry()`：檢查登記檔格式與來源 | 公式格式新增欄位時同步修改 | 每版 |

### src/：選窗與資料轉接

| 檔案 | 用途 | 用法 | 頻率 |
|---|---|---|---|
| `predispatch.js` | `parse_report()` 解析預調度；`best_single_cycle()` 單循環選窗 | 歷史產製也用它，改了要重產摘要 | 每版；**在指紋範圍** |
| `cycles.js` | `best_cycles()` 多循環選窗（P12）、`MAX_CYCLES`、`valid_max_cycles()` | 選窗規則改變時同步 architecture.md「預調度多循環」 | 每版 |
| `aemo_fetch.js` | `fetch_report()` 讀取 AEMO API | 只負責取資料，不解析 | 很少 |
| `price_series.js` | 5 分鐘實際價聚合成 30 分鐘、三天時間軸、圖表資料 | 聚合規則改變時同步 README「資料可信度」 | 每功能 |

### src/：純函式功能（不碰 DOM）

| 檔案 | 用途 | 用法 | 頻率 |
|---|---|---|---|
| `data_trust.js` | T8：`live`、`stale`、`manual`、`loading`、`error`、`none` | 新增狀態時同步 README 判讀表與 architecture.md T8 | 每功能 |
| `share_state.js` | P7：分享網址編解碼、白名單驗證、與預設值比較 | 新增欄位時更新白名單並調高格式版本 | 每功能 |
| `history_review.js` | P13：價差標準檢討 | 只讀摘要，不重新選窗 | 每功能 |
| `history_quantiles.js` | P8：每日收益分位數 | 分位數定義改變時同步 README P8 | 每功能 |

### src/：畫面與文字

| 檔案 | 用途 | 用法 | 頻率 |
|---|---|---|---|
| `app.js` | 入口；狀態、`evaluate_view`、結論列、資料列、公式卡、改寫器、比較區、AEMO 讀取流程 | **熱點**；新的畫面區塊另開 `src/` 檔案再由這裡引用，不再往這個檔案加 | 熱點 |
| `price_chart.js` | 電價與充放電排程圖（SVG、游標、拖曳、鍵盤） | 互動規格以 design.md 第 8 節為準 | 每功能 |
| `history_panel.js` | 情境評估的歷史區；載入摘要時比對 `registry.json`、`variables.json`、`battery.json` 的 SHA-256 | 摘要格式改變時同步修改 | 每功能 |
| `formula_help.js` | 變數類別、中文短名稱、名詞說明 | 新增變數時補中文名稱與說明 | 每功能 |
| `formula_text.js` | 中文式子與引擎式子互轉 | 名稱必須完全相同才會對到既有變數 | 很少 |
| `format.js` | 金額、價格輸入框的顯示格式 | 顯示精度只在這裡定義 | 很少 |

### analysis/、data/：離線歷史資料

| 檔案 | 用途 | 用法 | 頻率 |
|---|---|---|---|
| `analysis/download.py` | 下載 AEMO `TRADINGPRICE` 月檔、驗證快取雜湊、正規化成 `.cache/history.json` | 見「每月更新與重產歷史資料」 | 每月執行 |
| `analysis/build.mjs` | 產製每日單循環摘要；`FINGERPRINT_PATHS` 定義指紋範圍 | 改了要重產摘要 | 很少；**在指紋範圍** |
| `analysis/verify.mjs` | 驗證摘要的指紋、來源與有效日 | CI 每次都會跑 | 很少 |
| `analysis/publish_snapshot.py` | 首次發布摘要用，只在 `feat/t6-p13-standalone-data` 分支的 PR 執行 | 一般開發不要用 | 一次性 |
| `data/daily_summary.json` | 已發布的每日單循環摘要 | 不要手改；只能由 `build.mjs` 產生 | 每月 |
| `.cache/` | 原始 ZIP、manifest 與正規化資料 | 已列入 gitignore，不提交 | 每月 |

### tests/

| 慣例 | 內容 |
|---|---|
| 模組測試 | `tests/<模組>.test.js`，對應 `src/` 同名檔案 |
| 介面互動 | `tests/<功能>_app.test.js`，例如 `cycles_app`、`share_app`、`trust_app` |
| Python | `tests/test_*.py` |
| 既有例外 | 少數檔案以主題命名（例如 `price_fixes.test.js`、`history.test.js`）；新測試照上面兩條慣例 |
| 執行 | `node --test "tests/*.test.js"`；`python -m unittest discover -s tests -p 'test_*.py'` |

### docs/

| 檔案 | 放什麼 | 不放什麼 | 頻率 |
|---|---|---|---|
| `architecture.md` | 設計、資料流、不變條件、錯誤處理 | 需求狀態、驗收紀錄 | 每功能 |
| `requirements.md` | MoSCoW 需求表、各版本驗收標準 | 驗收證據本身（放 issue、PR、CI） | 每 PR |
| `design.md`、`design-tokens.json` | 版面、色票、字型、互動 | 計算規則 | 每功能 |
| `design-questions.md` | 尚未決定的設計問題（只記問題） | 解法；不開 issue | 不定期 |
| `v2-prototype-plan.md` | v2 原型的做法 | 驗收條件 | 一次性 |
| `repo-map.md`（本文件） | 每個部分的用途、用法、頻率與改動位置 | 功能細節 | 檔案變動時 |

### .github/

| 檔案 | 用途 | 頻率 |
|---|---|---|
| `workflows/ci.yml` | 每個 PR 與 `main`：Python 測試、Node 測試、驗證摘要；沒有摘要時才下載並產製 | 很少 |

## 4. 我要改 X，寫在哪裡

| 我要… | 主要改 | 一起改 | 要不要重產摘要 |
|---|---|---|---|
| 新增或改寫公式 | `formulas/registry.json`（需要新輸入時加 `variables.json`） | 有新需求就在 requirements.md 加一列 | 要 |
| 只改公式說明或名稱 | `registry.json` | 無 | 目前要（整份檔案算進指紋） |
| 改設備預設值 | `config/battery.json` | 在 PR 說明檢討理由 | 要 |
| 改價差標準、循環上限 | `config/spread_standard.json`、`config/dispatch.json` | 在 PR 說明檢討理由 | 不用 |
| 改選窗規則 | `cycles.js` 或 `predispatch.js` | architecture.md「預調度多循環」 | 動到 `predispatch.js` 才要 |
| 新增資料狀態或時效規則 | `data_trust.js` | README 判讀表、architecture.md T8 | 不用 |
| 新增分享欄位 | `share_state.js` | architecture.md P7 | 不用 |
| 新增畫面區塊 | 新的 `src/` 檔案、`index.html` 容器 | design.md | 不用 |
| 新增需求 | requirements.md 需求表加一列，再加進版本小節，再開 issue | 無 | 不用 |
| 有設計還沒決定 | design-questions.md 新增一條 Dn | 無 | 不用 |
| 每月更新歷史資料 | 照下一節的命令 | README「資料」表 | 這件事本身就是重產 |
| 放驗收證據 | issue 留言、PR 描述 | requirements.md 只放連結 | 不用 |

## 每月更新與重產歷史資料

需要網際網路，在本機執行；CI 只在沒有摘要時才下載，不會自動重產。期間改成要涵蓋的交易日。

```bash
python3 analysis/download.py --start YYYY-MM-DD --end YYYY-MM-DD
node analysis/build.mjs
node analysis/verify.mjs
```

`download.py` 預設把月檔快取在 `.cache/aemo`、輸出 `.cache/history.json`（可用 `--cache`、`--output` 改）；`build.mjs` 預設讀 `.cache/history.json`，寫入 `data/daily_summary.json`。完成後提交 `data/daily_summary.json`，並更新 README「資料」表的涵蓋期間與最後產製日。

只是因為改了指紋範圍內的檔案而重產時，沿用 README「資料」表目前的期間。

## 5. 不能破壞的規則

- **指紋範圍**：`analysis/build.mjs` 的 `FINGERPRINT_PATHS` 列出的檔案只要內容有任何變動，就必須重產摘要。目前是 `analysis/download.py`、`analysis/build.mjs`、`src/predispatch.js`、`src/day.js`、`src/engine.js`、`src/expression.js`、`formulas/registry.json`、`formulas/variables.json`、`config/battery.json`。沒有重產時，CI 的 `verify.mjs` 會失敗；而 `history_panel.js` 會在正式站比對其中三個檔案的雜湊，比對不上時情境評估分頁的歷史區顯示「公式或設備已變更，歷史摘要需重新產製」。
- 只有一套計算引擎；收益與判斷都走 `compute()`，不另寫算式。
- 不用 eval；式子只經過 `expression.js` 的白名單解析器。
- 讀取失敗時清掉舊電價，不拿舊值判斷；只有 `live` 狀態才顯示執行或等待。
- 缺資料的日子要排除，不能當成零收益。
- 分享網址整份驗證，有任何一欄不合法就整份不套用。
- 樣式只用 design tokens。
- repo 公開，公式、設備參數與價差標準都是公開資訊；不提交任何秘密。

## 6. 寫法慣例

- 檔名與函式名用 snake_case；ES module；不加 npm 依賴。
- 新的 `src/` 檔案開頭寫註解：用途、不做什麼、對應的文件章節（參考 `app.js` 檔頭）。
- Commit 用 Conventional Commits、英文、scope 寫模組名，結尾附 issue 編號，例如 `fix(prices): aggregate complete 5-minute actuals (#15)`。
- 分支命名：`feat/`、`fix/`、`docs/` 加主題與 issue 編號；PR 標題與內容用繁體中文。
- 合併一律用一般 merge commit，不用 squash。

## 7. 已知待整理

- `app.js` 過大而且最常改：新功能先另開檔案。
- 公式說明與名稱被指紋綁住：是否縮小指紋範圍屬設計決定，先寫成 design-questions.md 的一條再討論。
- CI 的首次發布步驟已不再需要，但 job 仍對每個 PR 取得 `contents: write` 權限。
