import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "../analysis/build.mjs";
import { review_history } from "../src/history_review.js";
const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const registry = load("formulas/registry.json"), catalog = load("formulas/variables.json"), battery = load("config/battery.json");
const raw = () => ({ region_id: "NSW1", start_date: "2026-07-01", end_date: "2026-07-03", sources: [{ url: "https://nemweb.com.au/test", sha256: "fixture" }],
  prices: Array.from({ length: 288 }, (_, index) => [new Date(Date.parse("2026-07-01") + (index + 1) * 300000).toISOString().slice(0, 16), index < 144 ? 40 : 180]) });
const summary = () => build(raw(), registry, catalog, battery);
const review = (extra = {}) => review_history({ summary: summary(), registry, catalog, battery, standard: 0, ...extra });
test("T6 counts exact intervals, excludes absent days, keeps next midnight in preceding day", () => {
  const result = summary();
  assert.equal(result.days[0].cycles[0].net_value_aud, 2800);
  assert.equal(result.days[1].excluded, true); assert.equal(result.days[2].excluded, true);
  const missing = raw(); missing.prices.pop();
  assert.throws(() => build(missing, registry, catalog, battery), /No complete/);
  const flat = raw(); flat.prices = flat.prices.map(([time]) => [time, 40]);
  assert.deepEqual(build(flat, registry, catalog, battery).days[0].cycles, []);
});
test("T6 rejects conflicts, nonfinite prices and unsupported batteries", () => {
  const conflict = raw(); conflict.prices.push([conflict.prices[0][0], 999]);
  assert.throws(() => build(conflict, registry, catalog, battery), /Conflicting/);
  const bad = raw(); bad.prices[0][1] = NaN;
  assert.throws(() => build(bad, registry, catalog, battery), /Invalid/);
  assert.throws(() => build(raw(), registry, catalog, { ...battery, power_mw: 3 }), /Unsupported/);
});
test("P13 threshold equality, fractions, missed dates and exclusion reasons", () => {
  assert.equal(review({ standard: 140 }).selected.revenue, 2800);
  const result = review({ standard: 140.5 });
  assert.equal(result.selected.revenue, 0); assert.deepEqual(result.selected.missed_dates, ["2026-07-01"]);
  assert.equal(result.recommendation, "建議下調"); assert.equal(result.excluded.length, 2);
  assert.deepEqual(result.range, [0, 140]); assert.equal(result.warnings.length, 2);
  assert.ok(result.scan.some((row) => row.standard === 140.5));
});
test("P13 no positive revenue, parameter recalculation, dates and metadata fail closed", () => {
  assert.equal(review({ rte: 0.1 }).selected.revenue, 0);
  assert.match(review({ rte: 0.1 }).recommendation, /不提供/);
  assert.equal(review({ degradation: 10 }).selected.revenue, 2600);
  assert.throws(() => review({ retention: 0 }), /不合法/);
  assert.throws(() => review({ start: "2026-06-30" }), /日期/);
  assert.throws(() => review({ battery: { ...battery, capacity_mwh: 10 } }), /不一致/);
  const broken = summary(); broken.days.pop();
  assert.throws(() => review({ summary: broken }), /缺少日期/);
});
