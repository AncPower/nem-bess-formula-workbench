import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_CYCLES, best_cycles, valid_max_cycles } from "../src/cycles.js";
import { best_single_cycle } from "../src/predispatch.js";
import { apply_share, decode_share, encode_share, share_snapshot, share_url } from "../src/share_state.js";

const battery = { power_mw: 5, capacity_mwh: 5, round_trip_efficiency: 0.9 };
const points = (prices) => prices.map((price, index) => ({ settlement_date: new Date(Date.parse("2026-10-21T00:30:00Z") + index * 1800000).toISOString().slice(0, 19), price }));
/** 固定種子的偽隨機數，讓失敗可以重現。 */
const random = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const score = (cycle) => battery.round_trip_efficiency * cycle.discharge_average_price - cycle.charge_average_price;
const index_of = (series, time) => series.findIndex((point) => point.settlement_date === time);

/** 暴力枚舉兩個不重疊循環（O(n⁴)），只在小樣本用來對照。 */
function brute_pair(series, length) {
  const averages = [];
  for (let start = 0; start + length <= series.length; start += 1) averages.push(series.slice(start, start + length).reduce((sum, point) => sum + point.price, 0) / length);
  const value = (c, d) => battery.round_trip_efficiency * averages[d] - averages[c];
  let best = -Infinity;
  for (let c1 = 0; c1 < averages.length; c1 += 1) for (let d1 = c1 + length; d1 < averages.length; d1 += 1)
    for (let c2 = d1 + length; c2 < averages.length; c2 += 1) for (let d2 = c2 + length; d2 < averages.length; d2 += 1)
      best = Math.max(best, value(c1, d1) + value(c2, d2));
  return best;
}

test("上限 1 與 best_single_cycle() 完全相同（含同分取最早）", () => {
  const next = random(7);
  for (let trial = 0; trial < 50; trial += 1) {
    const series = points(Array.from({ length: 8 + Math.floor(next() * 40) }, () => Math.round(next() * 300 - 50)));
    assert.deepEqual(best_cycles(series, battery, 1), [best_single_cycle(series, battery)]);
  }
  const flat = points(Array(12).fill(100));
  assert.deepEqual(best_cycles(flat, battery, 1), [best_single_cycle(flat, battery)], "全部同價也一樣");
});

test("兩個低谷兩個高峰：選出兩個不重疊、依時間排序的循環", () => {
  const series = points([40, 40, 180, 180, 30, 30, 200, 200, 100, 100]);
  const cycles = best_cycles(series, battery, 2);
  assert.equal(cycles.length, 2);
  assert.deepEqual(cycles.map((cycle) => [cycle.charge_average_price, cycle.discharge_average_price]), [[40, 180], [30, 200]]);
  const [first, second] = cycles.map((cycle) => [index_of(series, cycle.charge_start), index_of(series, cycle.discharge_start)]);
  assert.ok(first[0] + 2 <= first[1] && first[1] + 2 <= second[0] && second[0] + 2 <= second[1], "充 → 放 → 充 → 放，彼此不重疊");
  assert.ok(cycles.every((cycle) => cycle.periods_per_leg === 2 && cycle.forecast_periods === 10));
  assert.ok(score(cycles[0]) + score(cycles[1]) > score(best_single_cycle(series, battery)), "兩個循環的加總高於最佳單循環");
});

test("與暴力枚舉對照：兩個循環的加總就是最佳值；沒有更好時維持單循環", () => {
  const next = random(42);
  for (let trial = 0; trial < 120; trial += 1) {
    const series = points(Array.from({ length: 8 + Math.floor(next() * 10) }, () => Math.round(next() * 300 - 50)));
    const single = best_single_cycle(series, battery);
    const cycles = best_cycles(series, battery, 2);
    const brute = brute_pair(series, 2);
    if (brute > score(single) + 1e-9) {
      assert.equal(cycles.length, 2, `第 ${trial} 組應排兩個循環`);
      assert.ok(Math.abs(score(cycles[0]) + score(cycles[1]) - brute) < 1e-9, `第 ${trial} 組的加總不是最佳值`);
      assert.ok(cycles.every((cycle) => score(cycle) > 0), "兩個循環時每個循環分數都為正");
    } else assert.deepEqual(cycles, [single], `第 ${trial} 組應維持單循環`);
  }
});

test("價格一路上漲時，第二個循環不會讓加總變大，只排一個", () => {
  const series = points(Array.from({ length: 16 }, (_, index) => 10 * index));
  assert.deepEqual(best_cycles(series, battery, 2), [best_single_cycle(series, battery)]);
});

test("預調度範圍不夠排兩個循環時只回一個；一個都排不下時回空陣列", () => {
  assert.equal(best_cycles(points([10, 10, 90, 90, 20, 20, 95]), battery, 2).length, 1, "7 個時段不夠兩個循環（需要 8 個）");
  assert.deepEqual(best_cycles(points([10, 10, 90]), battery, 2), []);
  assert.deepEqual(best_cycles([], battery, 1), []);
});

test("上限只接受 1 到 MAX_CYCLES 的整數", () => {
  assert.equal(MAX_CYCLES, 2);
  for (const value of [0, 3, 1.5, "2", null]) {
    assert.equal(valid_max_cycles(value), false);
    assert.throws(() => best_cycles(points([1, 2, 3, 4]), battery, value), /循環上限/);
  }
  assert.equal(valid_max_cycles(undefined), false);
  assert.ok(valid_max_cycles(1) && valid_max_cycles(2));
});

test("分享網址保存循環上限；不合格的上限整份拒絕；沒改上限時不寫進網址", () => {
  const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  const context = { registry: load("formulas/registry.json"), catalog: load("formulas/variables.json") };
  const base = { value_overrides: {}, expression_overrides: {}, custom_labels: {}, scenario_history: null };
  const where = { origin: "https://ancpower.github.io", pathname: "/nem-bess-formula-workbench/" };
  assert.equal(share_url(where, share_snapshot({ ...base, max_cycles: null }), "predispatch"), "https://ancpower.github.io/nem-bess-formula-workbench/#predispatch");
  const snapshot = share_snapshot({ ...base, max_cycles: 1 });
  assert.equal(snapshot.max_cycles, 1);
  const decoded = decode_share(encode_share(snapshot), context);
  assert.deepEqual(decoded, snapshot);
  const target = { ...base, max_cycles: null };
  apply_share(target, decoded);
  assert.equal(target.max_cycles, 1);
  apply_share(target, decode_share(encode_share(share_snapshot(base)), context));
  assert.equal(target.max_cycles, null, "沒有上限的分享網址回到預設");
  const raw = (value) => Buffer.from(JSON.stringify({ v: 1, values: {}, expressions: {}, labels: {}, history: null, max_cycles: value })).toString("base64url");
  for (const value of [0, 3, 1.5, "1"]) assert.throws(() => decode_share(raw(value), context), /最多循環數/);
});
