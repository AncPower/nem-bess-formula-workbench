/**
 * 電價曲線資料：從同一份 AEMO 30 分鐘回應取出實際（ACTUAL）與預調度（FORECAST）電價，
 * 並把選出的充放電時段對到時間軸上，供曲線圖使用。
 *
 * 不修改 predispatch.js：選窗仍由 best_single_cycle 負責，這裡只負責呈現用的資料整理。
 */

const PERIOD_TYPES = { ACTUAL: "actual", FORECAST: "forecast" };

/**
 * @returns {{actual: {settlement_date: string, price: number}[], forecast: {settlement_date: string, price: number}[]}}
 */
export function parse_price_series(payload, region_id = "NSW1") {
  const rows = payload?.["5MIN"];
  if (!Array.isArray(rows)) throw new Error("AEMO 回應缺少「5MIN」陣列");
  const series = { actual: [], forecast: [] };
  rows.forEach((row, index) => {
    const kind = PERIOD_TYPES[row?.PERIODTYPE];
    if (row?.REGIONID !== region_id || !kind) return;
    if (typeof row.RRP !== "number" || !Number.isFinite(row.RRP)) throw new Error(`第 ${index + 1} 列的 RRP 不是數值`);
    if (typeof row.SETTLEMENTDATE !== "string") throw new Error(`第 ${index + 1} 列缺少 SETTLEMENTDATE`);
    series[kind].push({ settlement_date: row.SETTLEMENTDATE, price: row.RRP });
  });
  for (const points of Object.values(series)) points.sort((a, b) => a.settlement_date.localeCompare(b.settlement_date));
  if (series.actual.length === 0 && series.forecast.length === 0) throw new Error(`AEMO 回應沒有 ${region_id} 的電價資料`);
  return series;
}

/** 依選出的起點與段長，找出這一段在預測序列中的第一個與最後一個時段。 */
export function leg_range(forecast, start, length) {
  const first = forecast.findIndex((point) => point.settlement_date === start);
  if (first < 0 || !(length >= 1) || first + length > forecast.length) return null;
  return { first: forecast[first].settlement_date, last: forecast[first + length - 1].settlement_date, periods: length };
}

/**
 * 合併兩條序列成同一條時間軸，並標出充電段、放電段與「實際／預測」分界。
 * @param {{actual: object[], forecast: object[]}} series
 * @param {object|null} cycle best_single_cycle 的結果
 * @param {string[]|null} window_times 指定時間軸（例如三天固定時段）；不給時用資料本身的時段
 */
export function build_chart_model(series, cycle, window_times = null) {
  const times = window_times ?? [...new Set([...series.actual, ...series.forecast].map((point) => point.settlement_date))].sort();
  const lookup = (points) => new Map(points.map((point) => [point.settlement_date, point.price]));
  const actual = lookup(series.actual);
  const forecast = lookup(series.forecast);
  const rows = times.map((time) => ({ time, actual: actual.get(time) ?? null, forecast: forecast.get(time) ?? null }));
  const leg = (start, average) => {
    const range = cycle ? leg_range(series.forecast, start, cycle.periods_per_leg) : null;
    return range ? { ...range, from: times.indexOf(range.first), to: times.indexOf(range.last), average } : null;
  };
  const prices = rows.flatMap((row) => [row.actual, row.forecast]).filter((price) => price !== null);
  const first_forecast = series.forecast.length ? times.findIndex((time) => time >= series.forecast[0].settlement_date) : -1;
  return {
    rows,
    charge: cycle ? leg(cycle.charge_start, cycle.charge_average_price) : null,
    discharge: cycle ? leg(cycle.discharge_start, cycle.discharge_average_price) : null,
    boundary: series.actual.length && first_forecast > 0 ? first_forecast : null,
    min: Math.min(0, ...prices),
    max: Math.max(0, ...prices),
  };
}

/** 「2026-10-21T02:00:00」→「02:00」；格式不符時原樣回傳。 */
export function time_label(settlement_date) {
  const match = /^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)/.exec(settlement_date);
  return match ? match[3] : settlement_date;
}

/** 「2026-10-21T02:00:00」→「10/21 02:00」。 */
export function date_time_label(settlement_date) {
  const match = /^\d{4}-(\d\d)-(\d\d)T(\d\d:\d\d)/.exec(settlement_date);
  return match ? `${match[1]}/${match[2]} ${match[3]}` : settlement_date;
}

const SLOT_MS = 30 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
/** AEMO 時段標記是結束時間：「10/22 00:00」屬於 10/21 這個交易日。 */
export function market_day(settlement_date) {
  return iso(Date.parse(`${settlement_date}Z`) - SLOT_MS).slice(0, 10);
}

/**
 * 三天固定時間軸：昨天、今天、明天各 48 個 30 分鐘時段，等距排列。
 * 「今天」取第一個預調度時段所屬的交易日（沒有預調度時取最後一個實際時段）。
 * @returns {{times: string[], days: {date: string, name: string}[]} | null}
 */
export function three_day_window(series) {
  const anchor = series.forecast[0]?.settlement_date ?? series.actual.at(-1)?.settlement_date;
  if (!anchor) return null;
  const today = Date.parse(`${market_day(anchor)}T00:00:00Z`);
  const days = [["昨天", -1], ["今天", 0], ["明天", 1]].map(([name, offset]) => ({ name, date: iso(today + offset * 48 * SLOT_MS).slice(0, 10) }));
  const times = [];
  for (let slot = 1; slot <= 144; slot += 1) times.push(iso(today - 48 * SLOT_MS + slot * SLOT_MS));
  return { times, days };
}
