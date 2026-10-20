import { test } from "node:test";
import assert from "node:assert/strict";
import { from_chinese, to_chinese, to_parts } from "../src/formula_text.js";

const LABELS = { discharge_price: "放電段均價", charge_price: "充電段均價", spread: "價差", spread_standard: "價差標準", cycle_net_revenue: "每循環淨收益", capacity_mwh: "容量", mlf: "邊際損失係數", rte: "來回效率", degradation_cost: "每 MWh 損耗成本" };
const KEYS = Object.fromEntries(Object.entries(LABELS).map(([key, label]) => [label, key]));
const label_of = (name) => LABELS[name] ?? name;
const strip = (text) => text.replace(/\s/g, "");

test("建議公式轉成中文再轉回來，式子不變", () => {
  for (const expression of [
    "discharge_price - charge_price",
    "and(spread >= spread_standard, cycle_net_revenue > 0)",
    "capacity_mwh * mlf * (rte * discharge_price - charge_price) - capacity_mwh * rte * degradation_cost",
    "-spread + 2.5e3",
    "max(spread, 0) / 2",
  ]) {
    const chinese = to_chinese(expression, label_of);
    assert.doesNotMatch(chinese, /[a-z_]{3,}/, `中文式子不應出現英文代號：${chinese}`);
    assert.equal(strip(from_chinese(chinese, (word) => KEYS[word] ?? `?${word}`)), strip(expression));
  }
});

test("名稱完全相同才對到既有變數；包含既有名稱的新名稱交給呼叫端", () => {
  const unknown = [];
  const expression = from_chinese("價差上限 × 2 − 價差", (word) => KEYS[word] ?? (unknown.push(word), "new_name"));
  assert.deepEqual(unknown, ["價差上限"]);
  assert.equal(expression, "new_name * 2 - spread");
});

test("全形符號與中文函式名稱都能用", () => {
  assert.equal(from_chinese("取最大（價差，0）＋ 1", (word) => KEYS[word]), "max(spread, 0) + 1");
  assert.equal(from_chinese("同時成立(價差 ≥ 價差標準，每循環淨收益 > 0)", (word) => KEYS[word]), "and(spread >= spread_standard, cycle_net_revenue > 0)");
});

test("拆成名稱框框、運算子與數字", () => {
  assert.deepEqual(to_parts("max(spread, 2) * rte").map((part) => part.type), ["call", "op", "name", "op", "number", "op", "op", "name"]);
  assert.equal(to_parts("spread $"), null);
});
