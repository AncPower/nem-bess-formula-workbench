import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { revenue_quantiles, mount_quantiles } from "../src/history_quantiles.js";
import { review_history } from "../src/history_review.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const registry = load("formulas/registry.json"), catalog = load("formulas/variables.json"), battery = load("config/battery.json");
const summary = () => ({
  schema_version: 2, region_id: "NSW1", max_cycles: 1, battery_specification: battery,
  period: { start_date: "2026-07-01", end_date: "2026-07-05" },
  days: [
    { date: "2026-07-01", cycles: [{ charge_average_price_aud_per_mwh: 40, discharge_average_price_aud_per_mwh: 180 }] },
    { date: "2026-07-02", cycles: [] },
    { date: "2026-07-03", excluded: true, exclusion_reason: "缺資料", cycles: [] },
    { date: "2026-07-04", cycles: [{ charge_average_price_aud_per_mwh: 40, discharge_average_price_aud_per_mwh: 80 }] },
    { date: "2026-07-05", cycles: [{ charge_average_price_aud_per_mwh: 40, discharge_average_price_aud_per_mwh: 130 }] },
  ],
});
const review = (extra = {}) => review_history({ summary: summary(), registry, catalog, battery, standard: 0, ...extra });
test("P8 percentiles interpolate ascending daily values and do not mutate input", () => {
  const result = review(), before = structuredClone(result.daily_revenues);
  const values = revenue_quantiles(result);
  assert.ok(Math.abs(values.p10 - 240) < 1e-9);
  assert.equal(values.p50, 1300); assert.equal(values.p90, 2500);
  assert.deepEqual(result.daily_revenues, before);
  assert.equal(result.daily_revenues.reduce((total, day) => total + day.revenue, 0), result.selected.revenue);
  assert.equal(result.valid_days, 4);
  assert.equal(result.excluded.length, 1);
  assert.ok(result.warnings.some((text) => text.includes("樣本不足")));
});
test("P8 dates and threshold affect distribution; valid non-execution days stay zero", () => {
  const thresholded = revenue_quantiles(review({ standard: 100 }));
  assert.equal(thresholded.p10, 0); assert.equal(thresholded.p50, 0);
  assert.ok(Math.abs(thresholded.p90 - 1960) < 1e-9);
  assert.deepEqual(revenue_quantiles(review({ standard: 999 })), { p10: 0, p50: 0, p90: 0 });
  assert.deepEqual(revenue_quantiles(review({ start: "2026-07-04", end: "2026-07-04" })), { p10: 800, p50: 800, p90: 800 });
  assert.throws(() => revenue_quantiles(review({ start: "2026-07-03", end: "2026-07-03" })), /無有效/);
  assert.throws(() => review({ start: "2026-08-01" }), /日期/);
  assert.throws(() => review({ standard: NaN }), /不合法/);
  assert.throws(() => revenue_quantiles({ daily_revenues: [{ revenue: Infinity }] }), /無有效/);
});
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
  append(node) { this.children.push(node); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
test("P8 controls preserve manual input until explicit apply, persist selection and fail closed", () => {
  const saved = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag) };
  try {
    const state = { registry, catalog, config: { battery, spread_standard: { spread_standard_aud_per_mwh: 0 } }, value_overrides: { daily_revenue: 123 } };
    let calls = 0;
    const parent = new Node("div");
    mount_quantiles(parent, summary(), state, () => calls++);
    const nodes = descendants(parent);
    const input = (label) => nodes.find((node) => node.attributes["aria-label"] === label);
    const apply = nodes.find((node) => node.tag === "button");
    assert.equal(state.value_overrides.daily_revenue, 123);
    assert.equal(calls, 0);
    assert.ok(nodes.some((node) => /P50 A\$ 1,300\.00\/天/.test(node.textContent)), "分位數文字也用千分位");
    input("收益參考價差標準 AUD/MWh").value = "100";
    input("收益參考價差標準 AUD/MWh").listeners.change();
    assert.equal(state.value_overrides.daily_revenue, 123);
    apply.listeners.click();
    assert.equal(state.scenario_history.active, true);
    assert.equal(state.scenario_history.daily_revenue, 0);
    assert.equal(state.value_overrides.daily_revenue, undefined);
    input("帶入分位數").value = "p90"; input("帶入分位數").listeners.change();
    assert.ok(Math.abs(state.scenario_history.daily_revenue - 1960) < 1e-9);
    input("收益參考起日").value = "2026-07-03"; input("收益參考迄日").value = "2026-07-03";
    input("收益參考起日").listeners.change();
    assert.match(state.scenario_history.error, /無有效/);
    assert.equal(state.scenario_history.daily_revenue, undefined);
    assert.equal(apply.disabled, true);
    input("收益參考起日").value = ""; input("收益參考起日").listeners.change();
    assert.match(state.scenario_history.error, /不得留空/);
    input("收益參考起日").value = "2026-07-04"; input("收益參考迄日").value = "2026-07-05";
    input("收益參考價差標準 AUD/MWh").value = "0";
    input("帶入分位數").value = "invalid"; input("帶入分位數").listeners.change();
    assert.match(state.scenario_history.error, /分位數/);
    input("帶入分位數").value = "p10"; input("帶入分位數").listeners.change();
    assert.equal(state.scenario_history.error, null);
    assert.equal(state.scenario_history.daily_revenue, 900);
    const next = new Node("div"); mount_quantiles(next, summary(), state);
    assert.equal(descendants(next).find((node) => node.tag === "select").value, "p10");
    assert.ok(calls > 0);
  } finally { if (saved === undefined) delete globalThis.document; else globalThis.document = saved; }
});
