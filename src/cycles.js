/**
 * P12：在預調度範圍內選最多 N 個不重疊的循環（目前上限 2）。
 *
 * 每個循環先充後放、連續滿功率，每段長度＝容量 ÷ 功率；循環依序排列（充 → 放 → 充 → 放），從空電池開始，電量不會超出容量。
 * 目標與 best_single_cycle() 相同：最大化各循環「來回效率 × 放電均價 − 充電均價」的加總。
 * 第二個循環要讓加總嚴格變大才排入；上限 1 時直接回傳 best_single_cycle() 的結果，兩者完全相同。
 * 上限以整段預調度範圍計，不是市場日；循環可以跨午夜，與單循環行為一致。
 *
 * 不修改 predispatch.js：它在歷史摘要的指紋範圍內（analysis/build.mjs 的 FINGERPRINT_PATHS），歷史摘要仍是單循環。
 */

import { best_single_cycle } from "./predispatch.js";

export const MAX_CYCLES = 2;
/** 浮點誤差容忍：第二個循環增加的分數要超過這個值才排入，避免價差趨近 0 的雜訊循環。 */
const MIN_GAIN = 1e-9;

export const valid_max_cycles = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_CYCLES;

/**
 * @param {{settlement_date: string, price: number}[]} points 依時間排序的 30 分鐘電價
 * @param {{power_mw: number, capacity_mwh: number, round_trip_efficiency: number}} battery 設備參數
 * @param {number} max_cycles 預調度範圍內最多幾個循環（1 到 MAX_CYCLES）
 * @returns {object[]} 依時間排序的循環，格式同 best_single_cycle()；連一個循環都排不下時回傳空陣列
 */
export function best_cycles(points, battery, max_cycles = 1) {
  if (!valid_max_cycles(max_cycles)) throw new RangeError(`循環上限必須是 1 到 ${MAX_CYCLES} 的整數`);
  const single = best_single_cycle(points, battery);
  if (!single) return [];
  if (max_cycles === 1) return [single];
  const length = single.periods_per_leg;
  if (points.length < 4 * length) return [single];

  const averages = [];
  for (let start = 0; start + length <= points.length; start += 1) {
    let sum = 0;
    for (let offset = 0; offset < length; offset += 1) sum += points[start + offset].price;
    averages.push(sum / length);
  }
  const rte = battery.round_trip_efficiency;
  const count = averages.length;
  const score = (charge, discharge) => rte * averages[discharge] - averages[charge];

  // cheapest[k]：0..k 之間均價最低的充電起點（同分取最早）。
  const cheapest = [];
  for (let k = 0; k < count; k += 1) cheapest.push(k === 0 || averages[k] < averages[cheapest[k - 1]] ? k : cheapest[k - 1]);
  // dearest[k]：k..結尾之間均價最高的放電起點（同分取最早）。
  const dearest = new Array(count);
  for (let k = count - 1; k >= 0; k -= 1) dearest[k] = k === count - 1 || averages[k] >= averages[dearest[k + 1]] ? k : dearest[k + 1];

  // before[b]：放電段在時段 b 之前結束的最佳循環；after[b]：充電段從時段 b 或之後開始的最佳循環。
  const before = new Array(points.length + 1).fill(null);
  for (let end = 1; end <= points.length; end += 1) {
    before[end] = before[end - 1];
    const discharge = end - length;
    if (discharge < length) continue;
    const charge = cheapest[discharge - length];
    const value = score(charge, discharge);
    if (before[end] === null || value > before[end].score) before[end] = { score: value, charge, discharge };
  }
  const after = new Array(points.length + 1).fill(null);
  for (let start = points.length - 1; start >= 0; start -= 1) {
    after[start] = after[start + 1];
    if (start + length >= count) continue;
    const discharge = dearest[start + length];
    const value = score(start, discharge);
    if (after[start] === null || value >= after[start].score) after[start] = { score: value, charge: start, discharge };
  }

  let pair = null;
  for (let split = 0; split <= points.length; split += 1) {
    const first = before[split];
    const second = after[split];
    if (!first || !second) continue;
    const total = first.score + second.score;
    if (pair === null || total > pair.total) pair = { total, first, second };
  }
  const best_single_score = rte * single.discharge_average_price - single.charge_average_price;
  if (!pair || !(pair.total > best_single_score + MIN_GAIN)) return [single];
  const describe = ({ charge, discharge }) => ({
    charge_average_price: averages[charge],
    discharge_average_price: averages[discharge],
    charge_start: points[charge].settlement_date,
    discharge_start: points[discharge].settlement_date,
    periods_per_leg: length,
    forecast_periods: points.length,
  });
  return [describe(pair.first), describe(pair.second)];
}
