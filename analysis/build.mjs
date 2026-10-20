import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { best_single_cycle } from "../src/predispatch.js";
import { compute_day } from "../src/day.js";

export const FINGERPRINT_PATHS = ["analysis/download.py", "analysis/build.mjs", "src/predispatch.js", "src/day.js", "src/engine.js", "src/expression.js", "formulas/registry.json", "formulas/variables.json", "config/battery.json"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
export async function fingerprint(root = new URL("../", import.meta.url)) {
  return Object.fromEntries(await Promise.all(FINGERPRINT_PATHS.map(async (path) => [path, hash(await readFile(new URL(path, root)))])));
}
export function build(raw, registry, catalog, battery) {
  const length = battery.capacity_mwh / battery.power_mw / 0.5;
  if (!Number.isInteger(length) || length < 1 || 2 * length > 48 || !(battery.round_trip_efficiency > 0 && battery.round_trip_efficiency <= 1) || !(battery.marginal_loss_factor > 0) || !(battery.degradation_cost_aud_per_mwh >= 0)) throw Error("Unsupported battery configuration");
  if (raw.region_id !== "NSW1" || !Array.isArray(raw.sources) || !raw.sources.length) throw Error("Missing source provenance");
  const points = new Map();
  for (const [time, price] of raw.prices) {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(time) || !Number.isFinite(price) || new Date(`${time}:00Z`).toISOString().slice(0, 16) !== time || Number(time.slice(-2)) % 5) throw Error("Invalid price interval");
    if (points.has(time) && points.get(time) !== price) throw Error("Conflicting duplicate");
    points.set(time, price);
  }
  const start = new Date(`${raw.start_date}T00:00Z`), end = new Date(`${raw.end_date}T00:00Z`);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end) throw Error("Invalid period");
  const context = { config: { battery, spread_standard: { spread_standard_aud_per_mwh: 0 } } };
  const days = [];
  for (let day = +start; day <= +end; day += 86400000) {
    const date = new Date(day).toISOString().slice(0, 10), prices = [];
    for (let interval = 1; interval <= 288; interval++) prices.push(points.get(new Date(day + interval * 300000).toISOString().slice(0, 16)));
    const count = prices.filter((price) => price !== undefined).length;
    if (count !== 288) { days.push({ date, excluded: true, exclusion_reason: `5 分鐘電價 ${count}/288`, cycles: [], net_value_aud: null }); continue; }
    const half_hours = Array.from({ length: 48 }, (_, index) => ({
      settlement_date: new Date(day + index * 1800000).toISOString().slice(0, 16),
      price: prices.slice(index * 6, index * 6 + 6).reduce((a, b) => a + b, 0) / 6,
    }));
    const selected = best_single_cycle(half_hours, battery);
    const plan = compute_day({ registry, catalog, context, cycles: [{ predispatch: selected }] });
    const get = (id) => { const result = plan.cycles[0].results.find((item) => item.id === id); if (result.error) throw Error(result.error); return result.value; };
    const net = get("cycle_net_revenue"), spread = get("spread");
    const cycles = net > 0 && spread >= 0 ? [{ charge_start: selected.charge_start, discharge_start: selected.discharge_start,
      charge_average_price_aud_per_mwh: selected.charge_average_price, discharge_average_price_aud_per_mwh: selected.discharge_average_price,
      spread_aud_per_mwh: spread, net_value_aud: net }] : [];
    days.push({ date, excluded: false, exclusion_reason: null, cycles, net_value_aud: cycles.length ? net : 0 });
  }
  if (!days.some((day) => !day.excluded)) throw Error("No complete trading days");
  return { schema_version: 2, region_id: "NSW1", market_timezone: "UTC+10", max_cycles: 1,
    generated_at: new Date().toISOString(), battery_specification: battery, sources: raw.sources,
    normalized_sha256: hash(JSON.stringify(raw.prices)), period: { start_date: raw.start_date, end_date: raw.end_date }, days };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = await read(process.argv[2] ?? ".cache/history.json");
  const registry = await read("formulas/registry.json"), catalog = await read("formulas/variables.json"), battery = await read("config/battery.json");
  const summary = { ...build(raw, registry, catalog, battery), input_fingerprint: await fingerprint() };
  await mkdir("data", { recursive: true });
  await writeFile("data/daily_summary.json.partial", JSON.stringify(summary) + "\n");
  await rename("data/daily_summary.json.partial", "data/daily_summary.json");
  console.log(JSON.stringify({ days: summary.days.length, included: summary.days.filter((day) => !day.excluded).length, period: summary.period }));
}
