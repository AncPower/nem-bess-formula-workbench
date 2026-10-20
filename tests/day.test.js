import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compute } from "../src/engine.js";
import { compute_day } from "../src/day.js";
import { check_registry } from "../src/registry_check.js";
import { best_single_cycle, parse_report } from "../src/predispatch.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const registry = load("formulas/registry.json");
const catalog = load("formulas/variables.json");
const context = { config: { battery: load("config/battery.json"), spread_standard: load("config/spread_standard.json") } };
const cycle = (charge, discharge) => ({ predispatch: { charge_average_price: charge, discharge_average_price: discharge } });
const run = (cycles, extra = {}) => compute_day({ registry, catalog, context, cycles, ...extra });
const value = (result, id) => result.results.find((entry) => entry.id === id)?.value;
const daily = (plan) => value(plan.daily, "daily_net_revenue");

 test("單循環達標執行；等於門檻也執行", () => {
  const plan = run([cycle(40, 180)], { value_overrides: { spread_standard: 140 } });
  assert.equal(value(plan.cycles[0], "dispatch_decision"), 1);
  assert.equal(daily(plan), 2800);
  assert.equal(plan.daily.variables.find((entry) => entry.key === "executed_cycle_net_revenue").origin, "aggregate");
});

 test("不達標、負收益與零收益不計入每日收益", () => {
  assert.equal(daily(run([cycle(40, 180)], { value_overrides: { spread_standard: 141 } })), 0);
  const plan = run([cycle(100, 110)], { value_overrides: { rte: 0.8, spread_standard: 0 } });
  assert.equal(value(plan.cycles[0], "cycle_net_revenue"), -240);
  assert.equal(value(plan.cycles[0], "dispatch_decision"), 0);
  assert.equal(daily(plan), 0);
  assert.equal(daily(run([cycle(40, 40)])), 0);
});

 test("逐循環判斷後才加總，空循環為零；不改寫輸入", () => {
  const cycles = [cycle(40, 180), cycle(50, 80), cycle(0, 200)];
  const snapshot = structuredClone(cycles);
  const plan = run(cycles, { value_overrides: { spread_standard: 100 } });
  assert.deepEqual(plan.cycles.map((entry) => value(entry, "dispatch_decision")), [1, 0, 1]);
  assert.equal(daily(plan), 6800);
  assert.equal(daily(run([])), 0);
  assert.deepEqual(cycles, snapshot);
  assert.throws(() => run(null), /陣列/);
  assert.throws(() => run([null]), /資料物件/);
});

 test("手動均價、設備與改寫式子會傳入每日彙總", () => {
  const plan = run([cycle(40, 180)], {
    value_overrides: { charge_price: 60, capacity_mwh: 10, rte: 0.9, mlf: 0.95, degradation_cost: 2 },
    expression_overrides: { cycle_net_revenue: "capacity_mwh * mlf * (rte * discharge_price - charge_price) - capacity_mwh * rte * degradation_cost - extra_cost" },
  });
  assert.equal(daily(plan), 10 * 0.95 * (0.9 * 180 - 60) - 10 * 0.9 * 2);
  assert.ok(plan.cycles[0].variables.some((entry) => entry.key === "extra_cost" && entry.added_by_user));
});

 test("每日式子可編輯、可引用同層公式；加總輸入不可手動冒用", () => {
  const custom = structuredClone(registry);
  custom.formulas.push({ ...custom.formulas.at(-1), id: "daily_copy", expression: "daily_net_revenue + 1" });
  const plan = run([cycle(40, 180)], {
    registry: custom, value_overrides: { executed_cycle_net_revenue: 99999 },
    expression_overrides: { daily_net_revenue: "executed_cycle_net_revenue * 0.5" },
  });
  assert.equal(daily(plan), 1400);
  assert.equal(value(plan.daily, "daily_copy"), 1401);
});

 test("逐循環錯誤與加總溢位不會被當成零收益", () => {
  for (const overrides of [{ spread: "(" }, { cycle_net_revenue: "1 / 0" }, { dispatch_decision: "(" }]) {
    const plan = run([cycle(40, 180)], { expression_overrides: overrides });
    assert.equal(daily(plan), null);
    assert.match(plan.daily.results[0].error, /無法彙總/);
  }
  const plan = run([cycle(40, 180), cycle(40, 180)], { expression_overrides: { cycle_net_revenue: "1e308" } });
  assert.equal(daily(plan), null);
  assert.match(plan.daily.results[0].error, /有限數值/);
});

 test("跨層引用在登記與使用者改寫時都被阻擋", () => {
  for (const [id, expression] of [["spread", "daily_net_revenue"], ["daily_net_revenue", "cycle_net_revenue"], ["spread", "period_revenue"]]) {
    const plan = run([cycle(40, 180)], { expression_overrides: { [id]: expression } });
    const result = [...plan.cycles[0].results, ...plan.daily.results].find((entry) => entry.id === id);
    assert.match(result.error, /跨計算層級/);
    const broken = structuredClone(registry);
    broken.formulas.find((entry) => entry.id === id).expression = expression;
    assert.ok(check_registry(broken, catalog).some((problem) => problem.includes("跨計算層級")));
  }
  const scenario = compute({ registry, catalog, context, expression_overrides: { period_revenue: "executed_cycle_net_revenue" } });
  assert.match(scenario.results.find((entry) => entry.id === "period_revenue").error, /跨計算層級/);
});

 test("不合法層級、彙總名稱與來源會被格式檢查擋下", () => {
  for (const change of [
    (r) => { delete r.formulas[0].scope; },
    (r) => { r.aggregates.executed_cycle_net_revenue.formula = "missing"; },
    (r) => { r.aggregates.executed_cycle_net_revenue.when = "spread"; },
    (r) => { r.aggregates.charge_price = r.aggregates.executed_cycle_net_revenue; },
    (r) => { r.formulas[0].expression = "executed_cycle_net_revenue"; },
  ]) {
    const broken = structuredClone(registry);
    change(broken);
    assert.ok(check_registry(broken, catalog).length > 0);
  }
});

 test("預調度解析到單循環計畫再到每日收益的端到端流程", () => {
  const payload = { "5MIN": [50, 10, 10, 60, 200, 200, 30, 100].map((price, index) => ({
    REGIONID: "NSW1", PERIODTYPE: "FORECAST", SETTLEMENTDATE: `t${index}`, RRP: price,
  })) };
  const battery = { ...context.config.battery, capacity_mwh: 5 };
  const selected = best_single_cycle(parse_report(payload), battery);
  const plan = run([{ predispatch: selected }], { context: { config: { ...context.config, battery } } });
  assert.equal(plan.cycles.length, 1);
  assert.equal(daily(plan), 950);
  assert.equal(value(compute({ registry, catalog, context }), "period_revenue"), 90 * 0.95 * 2651);
});
