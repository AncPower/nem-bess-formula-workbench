import { test } from "node:test";
import assert from "node:assert/strict";
import { build_chart_model, date_time_label, leg_range, parse_price_series, time_label } from "../src/price_series.js";
import { nice_ticks } from "../src/price_chart.js";
import { best_single_cycle, parse_report } from "../src/predispatch.js";

const row = (time, price, type = "FORECAST", region = "NSW1") => ({ REGIONID: region, PERIODTYPE: type, SETTLEMENTDATE: time, RRP: price });
const at = (hour, minute = 0) => `2026-10-21T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;

test("同一份回應分出實際與預調度電價，只取 NSW1 並排序", () => {
  const series = parse_price_series({ "5MIN": [row(at(2), 5), row(at(1, 30), 3), row(at(1), 9, "FORECAST", "QLD1"), row(at(0, 30), 1, "ACTUAL"), row(at(0), 2, "ACTUAL"), row(at(3), 7, "OTHER")] });
  assert.deepEqual(series.actual.map((point) => point.price), [2, 1]);
  assert.deepEqual(series.forecast.map((point) => point.price), [3, 5]);
});

test("格式不符時指出哪一列；沒有任何電價時報錯", () => {
  assert.throws(() => parse_price_series({}), /5MIN/);
  assert.throws(() => parse_price_series({ "5MIN": [row(at(0), "x", "ACTUAL")] }), /第 1 列的 RRP/);
  assert.throws(() => parse_price_series({ "5MIN": [row(at(0), 1, "ACTUAL", "VIC1")] }), /沒有 NSW1/);
});

test("曲線模型：充放電段與選窗結果、均價一致，並標出實際與預測分界", () => {
  const prices = [50, 10, 10, 60, 200, 200, 30, 100];
  const payload = { "5MIN": [row(at(0), 70, "ACTUAL"), row(at(0, 30), 65, "ACTUAL"), ...prices.map((price, index) => row(at(1 + Math.floor(index / 2), index % 2 ? 30 : 0), price))] };
  const series = parse_price_series(payload);
  const cycle = best_single_cycle(parse_report(payload), { power_mw: 5, capacity_mwh: 5, round_trip_efficiency: 1 });
  const model = build_chart_model(series, cycle);
  assert.equal(model.rows.length, 10);
  assert.equal(model.boundary, 2);
  assert.deepEqual([model.charge.from, model.charge.to, model.charge.average], [3, 4, 10]);
  assert.deepEqual([model.discharge.from, model.discharge.to, model.discharge.average], [6, 7, 200]);
  const charged = model.rows.slice(model.charge.from, model.charge.to + 1).map((entry) => entry.forecast);
  assert.equal(charged.reduce((a, b) => a + b, 0) / charged.length, cycle.charge_average_price);
  assert.equal(model.rows[0].forecast, null);
  assert.equal(model.min, 0);
  assert.equal(model.max, 200);
});

test("沒有實際電價或沒有選窗時，模型仍可畫出", () => {
  const series = { actual: [], forecast: [{ settlement_date: at(0), price: -20 }, { settlement_date: at(0, 30), price: 40 }] };
  const model = build_chart_model(series, null);
  assert.equal(model.boundary, null);
  assert.equal(model.charge, null);
  assert.equal(model.min, -20);
  assert.equal(leg_range(series.forecast, at(0), 3), null);
  assert.equal(leg_range(series.forecast, "missing", 1), null);
});

test("時間標籤與刻度", () => {
  assert.equal(time_label(at(4, 30)), "04:30");
  assert.equal(date_time_label(at(4, 30)), "10/21 04:30");
  assert.equal(time_label("t1"), "t1");
  assert.deepEqual(nice_ticks(0, 200), [0, 50, 100, 150, 200]);
  assert.deepEqual(nice_ticks(-20, 40), [-20, 0, 20, 40]);
  assert.deepEqual(nice_ticks(5, 5), [5]);
});
