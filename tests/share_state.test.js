import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_SHARE_LENGTH, apply_share, compare_rows, custom_key, decode_share, encode_share, read_share, share_snapshot, share_url } from "../src/share_state.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const registry = load("formulas/registry.json");
const catalog = load("formulas/variables.json");
const context = { registry, catalog };
const encode_raw = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const fee = custom_key("每日固定費用");
const changed = () => ({
  value_overrides: { spread_standard: 141, [fee]: 100 },
  expression_overrides: { daily_net_revenue: `executed_cycle_net_revenue - ${fee}` },
  custom_labels: { [fee]: "每日固定費用", [custom_key("沒用到")]: "沒用到" },
  scenario_history: { start: "2026-07-01", end: "2026-07-31", standard: 20, quantile: "p90", active: true, daily_revenue: 123, error: null },
});

test("分享設定：編碼後解碼完整往返，只保存影響結果的設定", () => {
  const snapshot = share_snapshot(changed());
  assert.deepEqual(snapshot.labels, { [fee]: "每日固定費用" }, "沒被式子或數值用到的自訂名稱不保存");
  assert.deepEqual(snapshot.history, { start: "2026-07-01", end: "2026-07-31", standard: 20, quantile: "p90", active: true }, "不保存算出來的每日收益或錯誤");
  const decoded = decode_share(encode_share(snapshot), context);
  assert.deepEqual(decoded, snapshot);
  const target = { value_overrides: {}, expression_overrides: {}, custom_labels: {}, scenario_history: null };
  apply_share(target, decoded);
  assert.deepEqual(target.value_overrides, { spread_standard: 141, [fee]: 100 });
  assert.equal(target.scenario_history.quantile, "p90");
});

test("分享設定：歷史模式未啟用時不保存；沒有調整時網址不帶參數", () => {
  const state = { value_overrides: {}, expression_overrides: {}, custom_labels: {}, scenario_history: { start: "2026-07-01", end: "2026-07-31", standard: 0, quantile: "p50", active: false } };
  assert.equal(share_snapshot(state).history, null);
  const where = { origin: "https://ancpower.github.io", pathname: "/nem-bess-formula-workbench/" };
  assert.equal(share_url(where, share_snapshot(state), "scenario"), "https://ancpower.github.io/nem-bess-formula-workbench/#scenario");
  const url = share_url(where, share_snapshot(changed()), "predispatch");
  assert.match(url, /^https:\/\/ancpower\.github\.io\/nem-bess-formula-workbench\/\?s=[A-Za-z0-9_-]+#predispatch$/);
  assert.equal(read_share(new URL(url).search), url.split("?s=")[1].split("#")[0]);
  assert.equal(read_share(""), null);
});

test("分享設定：不合格內容整份拒絕", () => {
  const ok = share_snapshot(changed());
  const reject = (value, pattern, message) => assert.throws(() => decode_share(typeof value === "string" ? value : encode_raw(value), context), pattern, message);
  reject("@@@", /無法辨識/, "非 base64url 字元");
  reject(Buffer.from("not json").toString("base64url"), /設定格式/);
  reject([1, 2], /設定格式/);
  reject({ ...ok, v: 2 }, /版本/);
  reject({ ...ok, extra: 1 }, /不支援的欄位/);
  reject({ ...ok, values: { spread_standard: "141" } }, /不是數字/);
  reject({ ...ok, values: { no_such_variable: 1 } }, /找不到變數/);
  reject({ ...ok, values: { executed_cycle_net_revenue: 1 } }, /自動加總/);
  reject({ ...ok, expressions: { no_such_formula: "1" } }, /找不到公式/);
  reject({ ...ok, expressions: { spread: "1 + ".repeat(200) } }, /式子不合法/);
  reject({ ...ok, labels: { [fee]: "別的名稱" } }, /與代號不符/);
  reject({ ...ok, labels: { [custom_key("a−b")]: "a−b" } }, /不合法/);
  reject({ ...ok, history: { ...ok.history, quantile: "p75" } }, /P10、P50 或 P90/);
  reject({ ...ok, history: { ...ok.history, start: "7/1" } }, /日期格式/);
  reject({ ...ok, history: { ...ok.history, active: false } }, /歷史分位數設定/);
  reject("A".repeat(MAX_SHARE_LENGTH + 1), /太長/);
  assert.throws(() => encode_share({ ...ok, expressions: Object.fromEntries(registry.formulas.map((formula) => [formula.id, "1 + ".repeat(124) + "1"])), values: Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`v_${index}`, 123456789.123])) }), /網址超過/);
});

test("比較：同一份資料下逐條列出預設、目前與是否相同", () => {
  const formulas = [{ id: "spread", name: "價差", format: "number", unit: "AUD/MWh" }, { id: "dispatch_decision", name: "執行或等待", format: "decision", unit: "" }, { id: "broken", name: "壞掉", format: "currency", unit: "AUD" }];
  const rows = compare_rows(formulas, [{ id: "spread", value: 140 }, { id: "dispatch_decision", value: 1 }, { id: "broken", value: 5 }], [{ id: "spread", value: 140 }, { id: "dispatch_decision", value: 0 }, { id: "broken", error: "式子無法解析" }]);
  assert.deepEqual(rows.map((row) => [row.id, row.same, row.delta]), [["spread", true, 0], ["dispatch_decision", false, null], ["broken", false, null]]);
});
