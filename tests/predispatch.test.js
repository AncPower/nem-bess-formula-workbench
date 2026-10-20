import { test } from "node:test";
import assert from "node:assert/strict";
import { best_single_cycle, parse_report } from "../src/predispatch.js";

const row = (time, price, region = "NSW1", type = "FORECAST") => ({ REGIONID: region, PERIODTYPE: type, SETTLEMENTDATE: time, RRP: price });

test("只取 NSW1 的預測列並排序", () => {
  const points = parse_report({ "5MIN": [row("2026-10-21T02:00:00", 5), row("2026-10-21T01:30:00", 3), row("2026-10-21T01:00:00", 9, "QLD1"), row("2026-10-21T00:30:00", 1, "NSW1", "ACTUAL")] });
  assert.deepEqual(points.map((point) => point.price), [3, 5]);
});

test("格式不符時指出哪一列", () => {
  assert.throws(() => parse_report({}), /5MIN/);
  assert.throws(() => parse_report({ "5MIN": [row("t", "x")] }), /第 1 列/);
});

test("找出先充後放的最佳單一循環", () => {
  const prices = [50, 10, 10, 60, 200, 200, 30, 100];
  const points = prices.map((price, index) => ({ settlement_date: `t${index}`, price }));
  const cycle = best_single_cycle(points, { power_mw: 5, capacity_mwh: 5, round_trip_efficiency: 1 });
  assert.equal(cycle.periods_per_leg, 2);
  assert.equal(cycle.charge_average_price, 10);
  assert.equal(cycle.discharge_average_price, 200);
  assert.equal(cycle.charge_start, "t1");
  assert.equal(cycle.discharge_start, "t4");
});

test("時段不足時回傳 null", () => {
  const points = [1, 2, 3].map((price, index) => ({ settlement_date: `t${index}`, price }));
  assert.equal(best_single_cycle(points, { power_mw: 5, capacity_mwh: 5, round_trip_efficiency: 1 }), null);
});
