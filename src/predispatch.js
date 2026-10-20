/**
 * 資料轉接：AEMO 30 分鐘預調度電價 → 最佳充放電時段的兩段均價。
 *
 * 端點是 AEMO 官網 NEM 資料儀表板背後的 API，回應允許跨網域讀取，靜態網頁可以直接呼叫；
 * 它沒有公開文件，格式改變時 parse_report 會指出哪一列哪個欄位不符。
 */

export const REPORT_URL = "https://visualisations.aemo.com.au/aemo/apps/api/report/5MIN";
const PERIOD_HOURS = 0.5;

/** 呼叫 API，回傳原始 JSON。 */
export async function fetch_report(fetch_impl = fetch) {
  const response = await fetch_impl(REPORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeScale: ["30MIN"] }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`AEMO API 回應 ${response.status}`);
  return response.json();
}

/**
 * 取出指定區域的預測電價，依時間排序。
 * @returns {{settlement_date: string, price: number}[]}
 */
export function parse_report(payload, region_id = "NSW1") {
  const rows = payload?.["5MIN"];
  if (!Array.isArray(rows)) throw new Error("AEMO 回應缺少「5MIN」陣列");
  const points = [];
  rows.forEach((row, index) => {
    if (row?.REGIONID !== region_id || row?.PERIODTYPE !== "FORECAST") return;
    if (typeof row.RRP !== "number" || !Number.isFinite(row.RRP)) throw new Error(`第 ${index + 1} 列的 RRP 不是數值`);
    if (typeof row.SETTLEMENTDATE !== "string") throw new Error(`第 ${index + 1} 列缺少 SETTLEMENTDATE`);
    points.push({ settlement_date: row.SETTLEMENTDATE, price: row.RRP });
  });
  if (points.length === 0) throw new Error(`AEMO 回應沒有 ${region_id} 的預測資料`);
  return points.sort((a, b) => a.settlement_date.localeCompare(b.settlement_date));
}

/**
 * 找出先充後放、連續滿功率的最佳單一循環：最大化 來回效率 × 放電均價 − 充電均價。
 * 同分取最早；預測期間不足兩段時回傳 null。
 *
 * @param {{settlement_date: string, price: number}[]} points 依時間排序的 30 分鐘電價
 * @param {{power_mw: number, capacity_mwh: number, round_trip_efficiency: number}} battery 設備參數
 */
export function best_single_cycle(points, battery) {
  const length = Math.round(battery.capacity_mwh / battery.power_mw / PERIOD_HOURS);
  if (!(length >= 1) || points.length < 2 * length) return null;
  const averages = [];
  for (let start = 0; start + length <= points.length; start += 1) {
    let sum = 0;
    for (let offset = 0; offset < length; offset += 1) sum += points[start + offset].price;
    averages.push(sum / length);
  }
  let best = null;
  for (let charge = 0; charge < averages.length; charge += 1) {
    for (let discharge = charge + length; discharge < averages.length; discharge += 1) {
      const score = battery.round_trip_efficiency * averages[discharge] - averages[charge];
      if (best === null || score > best.score) best = { score, charge, discharge };
    }
  }
  return {
    charge_average_price: averages[best.charge],
    discharge_average_price: averages[best.discharge],
    charge_start: points[best.charge].settlement_date,
    discharge_start: points[best.discharge].settlement_date,
    periods_per_leg: length,
    forecast_periods: points.length,
  };
}
