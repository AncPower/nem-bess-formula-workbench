/**
 * 頁面：一個網址、兩個分頁（#predispatch、#scenario）。兩個分頁共用同一份公式登記檔、變數目錄與計算引擎。
 */

import { compute } from "./engine.js";
import { compute_day } from "./day.js";
import { mount_history } from "./history_panel.js";
import { check_registry } from "./registry_check.js";
import { best_single_cycle, fetch_report, parse_report } from "./predispatch.js";
import { SUPPORTED_FUNCTIONS } from "./expression.js";

const TABS = ["predispatch", "scenario"];
const ORIGIN_LABELS = { user: "你調整的值", data: "預調度資料", config: "設定檔", default: "預設值", aggregate: "逐循環計算後自動加總（唯讀）" };
const GUIDANCE_LABELS = { principle: "原則", method: "方法", how_to_choose: "建議怎麼選" };

const state = { registry: null, catalog: null, config: {}, data: {}, value_overrides: {}, expression_overrides: {}, data_status: null };

const element = (tag, attributes = {}, text) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};

function current_tab() {
  const tab = location.hash.replace("#", "");
  return TABS.includes(tab) ? tab : "predispatch";
}

function format_value(value, format, unit) {
  if (format === "decision") return value !== 0 ? "執行" : "等待";
  const digits = format === "currency" ? 0 : 2;
  const text = value.toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return format === "currency" ? `A$ ${text}` : `${text}${unit ? ` ${unit}` : ""}`;
}

function render() {
  const tab = current_tab();
  document.querySelectorAll(".tabs a").forEach((link) => {
    if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const args = {
    registry: state.registry,
    catalog: state.catalog,
    context: { config: state.config, data: state.data },
    value_overrides: state.value_overrides,
    expression_overrides: state.expression_overrides,
  };
  const base = compute(args);
  const plan = compute_day({ ...args, cycles: [state.data] });
  const variables = [...new Map([...base.variables, ...plan.cycles[0].variables, ...plan.daily.variables].map((variable) => [variable.key, variable])).values()];
  const results = [...new Map([...base.results, ...plan.cycles[0].results, ...plan.daily.results].map((result) => [result.id, result])).values()];
  const visible = state.registry.formulas.filter((formula) => formula.page === tab || formula.page === "shared");
  const visible_results = visible.map((formula) => results.find((result) => result.id === formula.id));
  const used = new Set(visible_results.flatMap((result) => result.uses));
  render_data_bar(tab);
  render_variables(variables.filter((variable) => used.has(variable.key)));
  render_formulas(visible, visible_results);
}

function render_data_bar(tab) {
  const bar = document.getElementById("data-bar");
  bar.replaceChildren();
  if (tab !== "predispatch") {
    bar.append(element("span", { class: "note" }, "情境評估：每日淨收益先手動輸入；歷史每日收益資料接入後會自動帶入參考期間的分位數。"));
    mount_history(bar, state);
    return;
  }
  const button = element("button", { type: "button" }, "讀取 AEMO 預調度電價");
  button.addEventListener("click", load_predispatch);
  bar.append(button);
  const status = state.data_status;
  if (status?.error) bar.append(element("span", { class: "error" }, `讀取失敗：${status.error}。可以直接在左側手動輸入均價。`));
  else if (status?.cycle) {
    const { cycle, fetched_at } = status;
    bar.append(element("span", {}, `${fetched_at.toLocaleTimeString("zh-TW")} 取得 ${cycle.forecast_periods} 個時段；充電 ${cycle.charge_start} 起、放電 ${cycle.discharge_start} 起（市場時間），每段 ${cycle.periods_per_leg} 個 30 分鐘`));
  } else bar.append(element("span", { class: "note" }, "尚未讀取，目前用預設均價。"));
}

function render_variables(variables) {
  const list = document.getElementById("variable-list");
  list.replaceChildren();
  for (const variable of variables) {
    const wrapper = element("div", { class: `variable${variable.origin === "user" ? " overridden" : ""}` });
    const id = `var-${variable.key}`;
    wrapper.append(element("label", { for: id }, `${variable.label}${variable.unit && variable.unit !== "—" ? `（${variable.unit}）` : ""}`));
    const input = element("input", { id, type: "number", step: "any", value: String(variable.value) });
    if (variable.origin === "aggregate") input.setAttribute("disabled", "");
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (input.value === "" || !Number.isFinite(value)) delete state.value_overrides[variable.key];
      else state.value_overrides[variable.key] = value;
      render();
    });
    wrapper.append(input);
    const origin = variable.added_by_user ? "你在式子裡新增的變數" : ORIGIN_LABELS[variable.origin];
    wrapper.append(element("div", { class: "origin" }, variable.hint ? `${origin} · ${variable.hint}` : origin));
    list.append(wrapper);
  }
}

function render_formulas(formulas, results) {
  const list = document.getElementById("formula-list");
  list.replaceChildren();
  formulas.forEach((formula, index) => {
    const result = results[index];
    const card = element("article", { class: "card" });
    const header = element("header");
    header.append(element("h3", {}, formula.name));
    if (formula.scope === "cycle" || formula.scope === "daily") header.append(element("span", { class: "note" }, formula.scope === "cycle" ? "每循環" : "每日彙總（目前單循環計畫）"));
    if (result.error) header.append(element("div", { class: "result error" }, result.error));
    else {
      const decision = formula.format === "decision" ? (result.value !== 0 ? " decision-go" : " decision-wait") : "";
      header.append(element("div", { class: `result${decision}` }, format_value(result.value, formula.format, formula.unit)));
    }
    card.append(header);

    const textarea = element("textarea", { rows: "2", "aria-label": `${formula.name}的式子`, spellcheck: "false" });
    textarea.value = result.expression;
    textarea.addEventListener("change", () => {
      if (textarea.value.trim() === formula.expression) delete state.expression_overrides[formula.id];
      else state.expression_overrides[formula.id] = textarea.value;
      render();
    });
    card.append(textarea);
    if (result.edited) {
      const reset = element("button", { type: "button" }, "還原建議式子");
      reset.addEventListener("click", () => { delete state.expression_overrides[formula.id]; render(); });
      card.append(element("span", { class: "edited" }, "已改寫 "), reset);
    }

    const guidance = element("dl", { class: "guidance" });
    for (const [field, label] of Object.entries(GUIDANCE_LABELS)) {
      guidance.append(element("dt", {}, label), element("dd", {}, formula.guidance[field]));
    }
    guidance.append(element("dt", {}, "來源"));
    const sources = element("ul");
    for (const source of formula.guidance.sources) {
      const item = element("li");
      item.append(element("a", { href: source.url, target: "_blank", rel: "noopener" }, source.title));
      sources.append(item);
    }
    const sources_cell = element("dd");
    sources_cell.append(sources);
    guidance.append(sources_cell);
    card.append(guidance);
    list.append(card);
  });
  list.append(element("p", { class: "note" }, `式子可用：+ − × ÷（* /）、^、比較（> >= < <= == !=）、${SUPPORTED_FUNCTIONS.join("、")}。輸入未定義的名稱會在左側新增一個輸入欄。`));
}

async function load_predispatch() {
  try {
    const points = parse_report(await fetch_report());
    const cycle = best_single_cycle(points, state.config.battery);
    if (!cycle) throw new Error("預測時段不足以排出一個完整循環");
    state.data = { predispatch: cycle };
    state.data_status = { cycle, fetched_at: new Date() };
  } catch (error) {
    state.data_status = { error: error.message };
  }
  render();
}

async function load_json(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`讀不到 ${path}（${response.status}）`);
  return response.json();
}

async function start() {
  const [registry, catalog, battery, spread_standard] = await Promise.all([
    load_json("formulas/registry.json"),
    load_json("formulas/variables.json"),
    load_json("config/battery.json"),
    load_json("config/spread_standard.json"),
  ]);
  const problems = check_registry(registry, catalog);
  if (problems.length > 0) throw new Error(`公式登記檔有問題：${problems.join("；")}`);
  Object.assign(state, { registry, catalog, config: { battery, spread_standard } });
  document.getElementById("reset-all").addEventListener("click", () => {
    state.value_overrides = {};
    state.expression_overrides = {};
    render();
  });
  window.addEventListener("hashchange", render);
  render();
  if (current_tab() === "predispatch") load_predispatch();
}

start().catch((error) => {
  document.getElementById("formula-list").replaceChildren(element("p", { class: "result error" }, error.message));
});
