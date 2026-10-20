import { test } from "node:test";
import assert from "node:assert/strict";
import { price_levels, taipei_label, tide_cells } from "../src/tide_strip.js";

test("台北時間＝市場時間 − 2 小時，跨午夜要繞回", () => {
  assert.equal(taipei_label("14:30"), "12:30");
  assert.equal(taipei_label("00:00"), "22:00");
  assert.equal(taipei_label("01:30"), "23:30");
  assert.equal(taipei_label("不是時間"), "不是時間");
});

test("電價依排名分 1 到 5 級，沒有電價為 0", () => {
  assert.deepEqual(price_levels([10, 20, 30, 40, 50, null]), [1, 2, 3, 4, 5, 0]);
  assert.deepEqual(price_levels([-50, -50, 300]), [1, 1, 5]);
  assert.deepEqual(price_levels([42]), [3]);
});

test("每格標出屬於充電段、放電段或都不是；優先用預調度電價", () => {
  const rows = [
    { time: "2026-10-21T00:30:00", actual: 90, forecast: null },
    { time: "2026-10-21T01:00:00", actual: null, forecast: 40 },
    { time: "2026-10-21T01:30:00", actual: 70, forecast: 180 },
  ];
  const cells = tide_cells({ rows, charge: { from: 1, to: 1 }, discharge: { from: 2, to: 2 } });
  assert.deepEqual(cells.map((cell) => [cell.time, cell.price, cell.leg, cell.kind]), [
    ["00:30", 90, null, "actual"],
    ["01:00", 40, "charge", "forecast"],
    ["01:30", 180, "discharge", "forecast"],
  ]);
  assert.deepEqual(tide_cells({ rows, charge: null, discharge: null }).map((cell) => cell.leg), [null, null, null]);
});
