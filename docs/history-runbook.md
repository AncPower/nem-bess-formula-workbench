# 獨立下載、T6 產製與 P13 檢討

本 repo 直接使用 [AEMO 公開 MMSDM](https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM/)，不需 GitLab、Token 或其他 repo。需 Python 3.12+、Node 22+，無第三方套件。

```bash
python analysis/download.py --start 2026-03-01 --end 2026-08-30
node analysis/build.mjs
node analysis/verify.mjs
python -m unittest discover -s tests -p 'test_*.py'
node --test "tests/*.test.js"
```

每月以明確日期重跑同一流程，檢查排除日期與來源 manifest，再以 PR 發布 `data/daily_summary.json`。不自動改價差標準、不自動合併。`--cache`、`--output` 可指定下載器的本機輸出；產製器可接受第一個參數作為正規化 JSON 路徑。`.cache/` 與原始 ZIP 不進 git。

初次同一 PR CI 會下載 2026-03-01 至 2026-08-30 的公開月檔，執行全部測試及摘要驗證，僅把驗證完成的摘要提交至固定實作分支，不提交 main。GitHub Token 的提交不會再觸發新一輪 Actions；因此該工作流程在新摘要提交上記錄 `test` 狀態，連回同一次驗證紀錄，並以原 HEAD 防止覆蓋並行修改。後續一般 PR 只驗證已有摘要，不自動重產；指紋不符會失敗，必須明確重產後送審。

前端情境分頁顯示來源期間、產生時間、逐循環收益保留率、錯失日期與收益、資料排除原因、成本參考和樣本／季節限制。手動期間收益輸入保持獨立。試算效率／損耗沿用既有窗口，不重新選窗；未排除事件日，不會建議上調。

每日採固定 UTC+10 的午夜至午夜；5 分鐘結束時間 00:00 屬前一日，每六筆成 30 分鐘均價。完整一天須 288 筆；完全缺日及部分缺漏都排除，有完整資料但無可獲利循環才記零。只有一個循環，不是舊 repo 的雙循環摘要；來源與設定指紋保存在摘要內，公式或設備變更必須重產。404、衝突值、壞 ZIP 或格式錯誤會失敗，保留舊摘要；不會自動縮短期間。

下載器參考 [上游下載器](https://git.ancillarypower.com/data/nsw-dispatch-revenue/nem-forecast-reliability/-/blob/HEAD/ingest/download_aemo_tables.py)（觀察到的 blob：`7ceb34dafbf0ef09094042297804f46f43363b6c`）的封存格式規則；未引入上游的私有套件或另外兩張預測資料表。AEMO 網路／封存格式可能變動，CI 真實下載失敗時不得宣稱 T6 完成。
