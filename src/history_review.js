import { compute_day } from "./day.js";

export function review_history({ summary, registry, catalog, battery, start, end, standard, retention = 0.99, rte = battery.round_trip_efficiency, degradation = battery.degradation_cost_aud_per_mwh }) {
  if (!Number.isFinite(standard) || standard < 0 || !(retention > 0 && retention <= 1) || !(rte > 0 && rte <= 1) || !Number.isFinite(degradation) || degradation < 0 || !(battery.marginal_loss_factor > 0)) throw Error("試算參數不合法");
  if (summary.schema_version !== 2 || summary.region_id !== "NSW1" || summary.max_cycles !== 1 || !Array.isArray(summary.days)) throw Error("歷史摘要格式不符");
  const signature = (value) => JSON.stringify(["power_mw", "capacity_mwh", "round_trip_efficiency", "marginal_loss_factor", "degradation_cost_aud_per_mwh"].map((key) => value[key]));
  if (signature(battery) !== signature(summary.battery_specification)) throw Error("設備設定與摘要不一致，請重新產製");
  start ??= summary.period.start_date; end ??= summary.period.end_date;
  if (!/^\d{4}-\d\d-\d\d$/.test(start) || !/^\d{4}-\d\d-\d\d$/.test(end) || start > end || start < summary.period.start_date || end > summary.period.end_date) throw Error("日期超出摘要範圍或順序不合法");
  const dates = new Set(), days = [], excluded = [], costs = [];
  for (const day of summary.days.filter((day) => day.date >= start && day.date <= end)) {
    if (dates.has(day.date)) throw Error("摘要日期重複"); dates.add(day.date);
    if (day.excluded) { excluded.push({ date: day.date, reason: day.exclusion_reason }); continue; }
    if (!Array.isArray(day.cycles) || day.cycles.length > 1) throw Error("摘要循環格式不符");
    const cycles = day.cycles.map((cycle) => {
      if (![cycle.charge_average_price_aud_per_mwh, cycle.discharge_average_price_aud_per_mwh].every(Number.isFinite)) throw Error("循環均價不合法");
      costs.push(cycle.charge_average_price_aud_per_mwh * (1 / rte - 1) + degradation / battery.marginal_loss_factor);
      return { predispatch: { charge_average_price: cycle.charge_average_price_aud_per_mwh, discharge_average_price: cycle.discharge_average_price_aud_per_mwh } };
    });
    const plan = compute_day({ registry, catalog, cycles, context: { config: { battery, spread_standard: { spread_standard_aud_per_mwh: 0 } } },
      value_overrides: { rte, degradation_cost: degradation } });
    const values = plan.cycles.map((cycle) => Object.fromEntries(cycle.results.map((result) => { if (result.error) throw Error(result.error); return [result.id, result.value]; })));
    days.push({ date: day.date, cycles: values });
  }
  const count = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  if (dates.size !== count) throw Error("摘要缺少日期，請重新產製");
  const evaluate = (threshold) => {
    let revenue = 0, executed_days = 0, missed_revenue = 0; const missed_dates = [];
    for (const day of days) {
      const potential = day.cycles.filter((cycle) => cycle.spread >= 0 && cycle.cycle_net_revenue > 0);
      const kept = potential.filter((cycle) => cycle.spread >= threshold);
      const net = kept.reduce((total, cycle) => total + cycle.cycle_net_revenue, 0);
      const lost = potential.filter((cycle) => cycle.spread < threshold).reduce((total, cycle) => total + cycle.cycle_net_revenue, 0);
      revenue += net; missed_revenue += lost; if (kept.length) executed_days++; if (lost > 0) missed_dates.push(day.date);
    }
    if (![revenue, missed_revenue].every(Number.isFinite)) throw Error("彙總不是有限數值");
    return { standard: threshold, revenue, executed_days, missed_days: missed_dates.length, missed_revenue, missed_dates };
  };
  const maximum = days.reduce((max, day) => day.cycles.reduce((value, cycle) => Math.max(value, cycle.spread), max), 0);
  if (maximum > 100000) throw Error("候選標準範圍過大");
  const baseline = evaluate(0).revenue;
  const candidates = Array.from({ length: Math.floor(maximum) + 1 }, (_, value) => value);
  candidates.push(standard);
  const scan = [...new Set(candidates)].sort((a, b) => a - b).map((threshold) => {
    const row = evaluate(threshold); return { ...row, retention: baseline > 0 ? row.revenue / baseline : null };
  });
  const selected = scan.find((row) => row.standard === standard);
  const retained = scan.filter((row) => row.retention !== null && row.retention >= retention);
  const seasons = new Set(days.map((day) => Math.floor((Number(day.date.slice(5, 7)) % 12) / 3)));
  costs.sort((a, b) => a - b);
  return { selected, scan, valid_days: days.length, excluded, range: retained.length ? [retained[0].standard, retained.at(-1).standard] : null,
    recommendation: baseline <= 0 || !days.length ? "無足夠正收益，不提供建議" : selected.retention >= retention ? "維持" : "建議下調",
    warnings: [...(days.length < 60 ? ["樣本不足（少於 60 個有效日）"] : []), ...(seasons.size === 1 ? ["季節限制（僅涵蓋一季）"] : [])],
    cost_reference: costs.length ? { min: costs[0], max: costs.at(-1), median: (costs[Math.floor((costs.length - 1) / 2)] + costs[Math.floor(costs.length / 2)]) / 2 } : null };
}
