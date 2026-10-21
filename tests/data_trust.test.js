import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_MINUTES, data_time, data_trust, market_time_ms } from "../src/data_trust.js";

const series = { actual: [{ settlement_date: "2026-10-21T08:00:00" }, { settlement_date: "2026-10-21T08:30:00" }], forecast: [{ settlement_date: "2026-10-21T09:00:00" }] };
const status = { cycle: {} };
const at = (text) => Date.parse(`${text}+10:00`);

test("NEM 時間：不帶時區的字串視為 UTC+10，帶時區的照原樣", () => {
  assert.equal(market_time_ms("2026-10-21T08:30:00"), Date.parse("2026-10-20T22:30:00Z"));
  assert.equal(market_time_ms("2026-10-21T08:30:00Z"), Date.parse("2026-10-21T08:30:00Z"));
  assert.equal(market_time_ms("不是時間"), null);
  assert.equal(market_time_ms(undefined), null);
});

test("資料時間：最後實際時段結束；沒有實際時段時用第一個預測時段往前一段", () => {
  assert.equal(data_time(series), at("2026-10-21T08:30:00"));
  assert.equal(data_time({ actual: [], forecast: [{ settlement_date: "2026-10-21T09:00:00" }] }), at("2026-10-21T08:30:00"));
  assert.equal(data_time({ actual: [], forecast: [] }), null);
});

test("即時與過期以 35 分鐘為界，時鐘比資料早時不算負數", () => {
  assert.equal(STALE_MINUTES, 35);
  const check = (minutes) => data_trust({ status, series, now: at("2026-10-21T08:30:00") + minutes * 60000 });
  assert.deepEqual(check(35), { kind: "live", at: at("2026-10-21T08:30:00"), age_minutes: 35 });
  assert.equal(check(36).kind, "stale");
  assert.equal(check(36).age_minutes, 36);
  assert.equal(check(-5).age_minutes, 0);
  assert.equal(data_trust({ status, series: { actual: [{ settlement_date: "壞掉" }], forecast: [] }, now: 0 }).kind, "stale", "資料時間無法判斷時視為可能過期");
});

test("手動改均價優先標成手動試算；讀取中、讀取失敗、尚未讀取各自分開", () => {
  const now = at("2026-10-21T08:40:00");
  assert.deepEqual(data_trust({ status, series, value_overrides: { charge_price: 50 }, now }), { kind: "manual", manual: ["charge_price"] });
  assert.equal(data_trust({ status: { error: "x" }, series: null, value_overrides: { discharge_price: 1 }, now }).kind, "manual", "讀取失敗後手動輸入就是手動試算");
  assert.equal(data_trust({ status, series, value_overrides: { spread_standard: 141 }, now }).kind, "live", "改價差標準不算手動改電價");
  assert.deepEqual(data_trust({ status: { loading: true, cycle: {} }, series, now }), { kind: "loading" });
  assert.deepEqual(data_trust({ status: { error: "AEMO API 回應 503" }, series: null, now }), { kind: "error", error: "AEMO API 回應 503" });
  assert.deepEqual(data_trust({ status: null, series: null, now }), { kind: "none" });
});
