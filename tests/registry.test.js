import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check_registry } from "../src/registry_check.js";
import { compute } from "../src/engine.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const registry = load("formulas/registry.json");
const catalog = load("formulas/variables.json");
const config = { battery: load("config/battery.json"), spread_standard: load("config/spread_standard.json") };

test("登記檔通過格式檢查", () => {
  assert.deepEqual(check_registry(registry, catalog), []);
});

test("檢查會擋下缺來源與未定義變數", () => {
  const broken = structuredClone(registry);
  broken.formulas[0].guidance.sources = [];
  broken.formulas[0].expression = "unknown_name + 1";
  const problems = check_registry(broken, catalog);
  assert.ok(problems.some((problem) => problem.includes("至少要有一個來源")));
  assert.ok(problems.some((problem) => problem.includes("unknown_name")));
});

test("預設值下每條公式都算得出來", () => {
  const { results } = compute({ registry, catalog, context: { config } });
  for (const result of results) assert.equal(result.error, null, `${result.id}: ${result.error}`);
  const value = (id) => results.find((result) => result.id === id).value;
  assert.equal(value("spread"), 140);
  assert.equal(value("cycle_net_revenue"), 20 * (180 - 40));
  assert.equal(value("dispatch_decision"), 1);
  assert.equal(value("factor_multiplier"), 1);
  assert.equal(value("period_revenue"), 90 * 0.95 * 2651);
});

test("覆寫值與改寫式子會傳到引用它的公式", () => {
  const { results, variables } = compute({
    registry, catalog, context: { config },
    value_overrides: { spread_standard: 200 },
    expression_overrides: { spread: "discharge_price - charge_price - extra_cost" },
  });
  const spread = results.find((result) => result.id === "spread");
  assert.equal(spread.edited, true);
  assert.equal(spread.value, 140);
  assert.ok(variables.some((variable) => variable.key === "extra_cost" && variable.added_by_user));
  assert.equal(results.find((result) => result.id === "dispatch_decision").value, 0);
});

test("資料轉接的值優先於預設值，使用者覆寫優先於資料", () => {
  const context = { config, data: { predispatch: { charge_average_price: 10, discharge_average_price: 110 } } };
  let { results } = compute({ registry, catalog, context });
  assert.equal(results.find((result) => result.id === "spread").value, 100);
  ({ results } = compute({ registry, catalog, context, value_overrides: { charge_price: 60 } }));
  assert.equal(results.find((result) => result.id === "spread").value, 50);
});

test("式子錯誤只影響自己與引用它的公式", () => {
  const { results } = compute({ registry, catalog, context: { config }, expression_overrides: { spread: "(" } });
  assert.ok(results.find((result) => result.id === "spread").error);
  assert.match(results.find((result) => result.id === "dispatch_decision").error, /無法計算/);
  assert.equal(results.find((result) => result.id === "cycle_net_revenue").error, null);
});

test("循環引用會被擋下", () => {
  const { results } = compute({ registry, catalog, context: { config }, expression_overrides: { spread: "dispatch_decision + 1" } });
  assert.ok(results.find((result) => result.id === "spread").error);
});
