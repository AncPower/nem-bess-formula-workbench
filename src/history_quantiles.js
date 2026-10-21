import { review_history } from "./history_review.js";
import { money } from "./format.js";

/** Percentiles use ascending values and linear interpolation at (n - 1) * p. */
export function revenue_quantiles(review) {
  const values = review.daily_revenues.map((day) => day.revenue).sort((a, b) => a - b);
  if (!values.length || !values.every(Number.isFinite)) throw Error("無有效每日收益，無法帶入分位數");
  const at = (p) => {
    const index = (values.length - 1) * p, lower = Math.floor(index), upper = Math.ceil(index);
    return values[lower] + (values[upper] - values[lower]) * (index - lower);
  };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

export function mount_quantiles(parent, summary, state, on_change = () => {}) {
  const settings = state.scenario_history ??= {
    start: summary.period.start_date, end: summary.period.end_date,
    standard: state.config.spread_standard.spread_standard_aud_per_mwh,
    quantile: "p50", active: false,
  };
  const section = document.createElement("section");
  parent.append(section);
  const add = (tag, text, target = section) => {
    const node = document.createElement(tag); node.textContent = text; target.append(node); return node;
  };
  add("h3", "每日收益：依參考期間選擇分位數");
  add("p", "P10／P50／P90 是每日淨收益由低到高的第 10／50／90 百分位，採線性插值；包含有效零收益日，排除缺資料日。使用設定檔設備、建議公式與原單循環窗口，不採用卡片臨時改寫；事後價格不是預測。");
  const fields = {};
  for (const [key, label, type] of [["start", "收益參考起日", "date"], ["end", "收益參考迄日", "date"], ["standard", "收益參考價差標準 AUD/MWh", "number"]]) {
    const wrapper = add("label", `${label} `), input = add("input", "", wrapper);
    input.type = type; input.value = String(settings[key]); input.step = "any";
    input.setAttribute("aria-label", label);
    if (type === "date") { input.min = summary.period.start_date; input.max = summary.period.end_date; }
    fields[key] = input;
  }
  const wrapper = add("label", "帶入分位數 "), select = add("select", "", wrapper);
  select.setAttribute("aria-label", "帶入分位數");
  for (const key of ["p10", "p50", "p90"]) {
    const option = add("option", key.toUpperCase(), select); option.value = key;
  }
  select.value = settings.quantile;
  const status = add("p", ""), apply = add("button", "使用歷史分位數");
  apply.type = "button";
  const calculate = () => {
    let result;
    try {
      Object.assign(settings, { start: fields.start.value, end: fields.end.value, standard: fields.standard.value === "" ? "" : Number(fields.standard.value), quantile: select.value });
      if (!fields.start.value || !fields.end.value || !fields.standard.value) throw Error("收益參考欄位不得留空");
      result = review_history({ summary, registry: state.registry, catalog: state.catalog, battery: state.config.battery, ...settings });
      const values = revenue_quantiles(result);
      if (!Object.hasOwn(values, settings.quantile)) throw Error("分位數不合法");
      settings.daily_revenue = values[settings.quantile];
      settings.error = null;
      status.setAttribute("class", "note");
      status.textContent = `${settings.active ? "已使用歷史分位數" : "目前保留手動／預設值，按鈕才會帶入"} · ${settings.start} 至 ${settings.end} · 有效 ${result.valid_days} 天 · ${Object.entries(values).map(([key, value]) => `${key.toUpperCase()} ${money(value, { digits: 2 })}/天`).join(" · ")}。排除日期：${result.excluded.map((day) => `${day.date}（${day.reason}）`).join("、") || "無"}。${result.warnings.join("；")}`;
      apply.disabled = false;
    } catch (error) {
      settings.daily_revenue = undefined;
      settings.error = error.message;
      status.setAttribute("class", "error"); status.textContent = error.message;
      apply.disabled = true;
    }
    if (settings.active) on_change();
  };
  for (const input of [...Object.values(fields), select]) input.addEventListener("change", calculate);
  apply.addEventListener("click", () => {
    calculate();
    if (settings.error) return;
    settings.active = true;
    delete state.value_overrides.daily_revenue;
    calculate();
  });
  calculate();
}
