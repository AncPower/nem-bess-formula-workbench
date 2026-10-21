/**
 * T8：判斷預調度結論能不能當作「當下建議」。
 * 只有讀到電價、資料不超過 35 分鐘、而且沒有手動改均價時才是即時；其他情況一律標成讀取中、讀取失敗、可能過期或手動試算。
 * 資料時間以最後一個實際（ACTUAL）時段的結束時間為準；AEMO 時間是 NEM 時間（固定 UTC+10），字串本身不帶時區。
 */

export const STALE_MINUTES = 35;
export const PRICE_KEYS = ["charge_price", "discharge_price"];
const SLOT_MS = 30 * 60 * 1000;

/** 「2026-10-21T08:30:00」（NEM 時間）→ 毫秒；已帶時區的字串照原樣解析；無法解析回傳 null。 */
export function market_time_ms(text) {
  if (typeof text !== "string") return null;
  const ms = Date.parse(/(?:[zZ]|[+-]\d\d:\d\d)$/.test(text) ? text : `${text}+10:00`);
  return Number.isFinite(ms) ? ms : null;
}

/** 資料時間：最後一個實際時段結束；沒有實際時段時，用第一個預測時段結束往前推一個時段。 */
export function data_time(series) {
  const last = series?.actual?.at(-1)?.settlement_date;
  if (last) return market_time_ms(last);
  const first = series?.forecast?.[0]?.settlement_date;
  const ms = first ? market_time_ms(first) : null;
  return ms === null ? null : ms - SLOT_MS;
}

/**
 * @returns {{kind: "manual", manual: string[]} | {kind: "loading"} | {kind: "error", error: string} | {kind: "none"} |
 *   {kind: "live" | "stale", at: number | null, age_minutes: number | null}}
 */
export function data_trust({ status, series, value_overrides = {}, now = Date.now() }) {
  const manual = PRICE_KEYS.filter((key) => Object.hasOwn(value_overrides, key));
  if (manual.length) return { kind: "manual", manual };
  if (status?.loading) return { kind: "loading" };
  if (status?.error) return { kind: "error", error: status.error };
  if (!status?.cycle || !series) return { kind: "none" };
  const at = data_time(series);
  if (at === null) return { kind: "stale", at: null, age_minutes: null };
  const age_minutes = Math.max(0, Math.floor((now - at) / 60000));
  return { kind: age_minutes > STALE_MINUTES ? "stale" : "live", at, age_minutes };
}
