import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GROUPS, SHORT_LABELS, TERMS, describe_expression, group_of, short_label } from "../src/formula_help.js";

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const registry = load("formulas/registry.json");
const catalog = load("formulas/variables.json");
const labels = Object.fromEntries([...catalog.variables.map((entry) => [entry.key, short_label(entry.label)]), ...registry.formulas.map((formula) => [formula.id, formula.name])]);
const label_of = (name) => SHORT_LABELS[name] ?? labels[name] ?? name;

test("每個變數、公式與彙總輸入都有白話意義，變數都有分組", () => {
  const groups = new Set(GROUPS.map((group) => group.id));
  for (const entry of catalog.variables) {
    assert.ok(TERMS[entry.key]?.meaning, `${entry.key} 缺少意義`);
    assert.ok(groups.has(TERMS[entry.key].group), `${entry.key} 分組不對`);
  }
  for (const formula of registry.formulas) assert.ok(TERMS[formula.id]?.meaning, `${formula.id} 缺少意義`);
  for (const key of Object.keys(registry.aggregates)) assert.equal(group_of({ key, origin: "aggregate" }), "rule");
  assert.equal(group_of({ key: "daily_fee", added_by_user: true }), "custom");
});

test("預設公式都能轉成中文算式，不殘留英文代號", () => {
  for (const formula of registry.formulas) {
    const text = describe_expression(formula.expression, label_of);
    assert.ok(text, formula.id);
    assert.doesNotMatch(text.replace(/MLF/g, ""), /[a-z_]{2,}/, `${formula.id}：${text}`);
  }
  assert.equal(describe_expression("discharge_price - charge_price", label_of), "放電段均價 − 充電段均價");
  assert.equal(describe_expression("and(spread >= spread_standard, cycle_net_revenue > 0)", label_of), "同時成立(價差 ≥ 價差標準，每循環淨收益 > 0)");
});

test("負號、函式與自訂名稱", () => {
  assert.equal(describe_expression("-a * (b - -2)", (name) => name.toUpperCase()), "−A × (B − −2)");
  assert.equal(describe_expression("if(x >= 1, max(y, 2), 0)", (name) => name), "如果(x ≥ 1，取最大(y，2)，0)");
  assert.equal(describe_expression("min_price + 1", (name) => name), "min_price + 1");
  assert.equal(describe_expression("a ; b", (name) => name), null);
  assert.equal(short_label("邊際損失係數（Marginal Loss Factor, MLF）"), "邊際損失係數");
});
