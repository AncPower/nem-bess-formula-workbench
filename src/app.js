/**
 * 頁面：一個網址、兩個分頁（#predispatch、#scenario）。兩個分頁共用同一份公式登記檔、變數目錄與計算引擎。
 *
 * 版面是「潮汐表」（docs/design.md）：先講結論（執行／等待），下方時段色帶與電價曲線，再往下是輸入與可收合的公式。
 * 輸入時即時預覽（input 事件，短暫延遲後重算並顯示「計算中」）；離開欄位或按 Enter（change 事件）才重建整頁，
 * 讓式子裡新出現的名稱長出輸入欄。
 */

import { compute } from "./engine.js";
import { compute_day } from "./day.js";
import { mount_history } from "./history_panel.js";
import { check_registry } from "./registry_check.js";
import { best_single_cycle, fetch_report, parse_report } from "./predispatch.js";
import { SUPPORTED_FUNCTIONS } from "./expression.js";
import { build_chart_model, leg_range, parse_price_series, time_label } from "./price_series.js";
import { render_price_chart } from "./price_chart.js";
import { render_tide_strip } from "./tide_strip.js";
import { GROUPS, SHORT_LABELS, TERMS, describe_expression, group_of, short_label } from "./formula_help.js";

const TABS = ["predispatch", "scenario"];
const ORIGIN_LABELS = { user: "你調整的值", data: "預調度資料", config: "設定檔", default: "預設值", aggregate: "自動加總（唯讀）" };
const GUIDANCE_LABELS = { principle: "原則", method: "方法", how_to_choose: "建議怎麼選" };
const PREVIEW_DELAY_MS = 200;

const state = { registry: null, catalog: null, config: {}, data: {}, series: null, value_overrides: {}, expression_overrides: {}, data_status: null };
const view = { results: new Map(), plain: new Map(), aggregates: new Map(), timer: null, decision: null };

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

function evaluate_view() {
  const tab = current_tab();
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
  return { tab, variables, results, visible, visible_results, used };
}

function label_of(name) {
  if (Object.hasOwn(SHORT_LABELS, name)) return SHORT_LABELS[name];
  const formula = state.registry.formulas.find((entry) => entry.id === name);
  if (formula) return formula.name;
  const variable = state.catalog.variables.find((entry) => entry.key === name);
  return variable ? short_label(variable.label) : name;
}

function render() {
  clearTimeout(view.timer);
  const result = evaluate_view();
  document.querySelectorAll(".tabs a").forEach((link) => {
    if (link.dataset.tab === result.tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  render_verdict(result);
  render_data_bar(result.tab);
  render_chart(result);
  render_variables(result.variables.filter((variable) => result.used.has(variable.key)));
  render_formulas(result.visible, result.visible_results, result.variables);
  set_status("done");
}

/** 即時預覽：只更新結果、中文算式與曲線，不重建輸入欄，避免打字時游標跳走。 */
function refresh() {
  const result = evaluate_view();
  result.visible.forEach((formula, index) => {
    const node = view.results.get(formula.id);
    if (node) paint_result(node, formula, result.visible_results[index]);
    const plain = view.plain.get(formula.id);
    if (plain) plain.textContent = plain_text(result.visible_results[index].expression);
  });
  for (const [key, input] of view.aggregates) {
    const variable = result.variables.find((entry) => entry.key === key);
    if (variable) input.value = String(variable.value);
  }
  render_verdict(result);
  render_chart(result);
  set_status("done");
}

function schedule_preview() {
  set_status("busy");
  clearTimeout(view.timer);
  view.timer = setTimeout(refresh, PREVIEW_DELAY_MS);
}

function set_status(kind) {
  const node = document.getElementById("calc-status");
  if (!node) return;
  node.setAttribute("class", `calc-status ${kind}`);
  node.textContent = kind === "busy" ? "計算中…" : `已更新 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`;
}

const find_result = (results, id) => results.find((entry) => entry.id === id);
const plain_number = (value) => value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });

/** 結論列：首屏第一行先講答案（預調度：執行或等待；情境評估：目標期間收益），理由放在同一行的小字。 */
function render_verdict({ tab, results, variables }) {
  const node = document.getElementById("verdict");
  if (!node) return;
  const word = element("p", { class: "verdict-word" });
  const why = element("p", { class: "verdict-why" });
  if (tab === "predispatch") {
    const decision = find_result(results, "dispatch_decision");
    const spread = find_result(results, "spread");
    const cycle = find_result(results, "cycle_net_revenue");
    const daily = find_result(results, "daily_net_revenue");
    const standard = variables.find((entry) => entry.key === "spread_standard");
    if (!decision || decision.error) {
      word.textContent = "無法判斷";
      word.setAttribute("class", "verdict-word error");
      why.textContent = decision?.error ?? "找不到「執行或等待」公式";
    } else {
      const go = decision.value !== 0;
      word.textContent = go ? "執行" : "等待";
      word.setAttribute("class", `verdict-word ${go ? "decision-go" : "decision-wait"}`);
      const parts = [];
      if (spread && !spread.error && standard) parts.push(`價差 ${plain_number(spread.value)} ${spread.value >= standard.value ? "≥" : "<"} 標準 ${plain_number(standard.value)} AUD/MWh`);
      if (cycle && !cycle.error) parts.push(`每循環淨收益 ${format_value(cycle.value, "currency")}`);
      if (daily && !daily.error) parts.push(`當日執行淨收益 ${format_value(daily.value, "currency")}`);
      why.textContent = `${parts.join(" · ")}。結果是建議，不是預測。`;
    }
  } else {
    const period = find_result(results, "period_revenue");
    word.textContent = period && !period.error ? format_value(period.value, "currency") : "無法估算";
    word.setAttribute("class", `verdict-word${period && !period.error ? "" : " error"}`);
    why.textContent = period?.error ?? "目標期間收益：情境估算，不是預測。";
  }
  node.replaceChildren(word, why);
}

function render_data_bar(tab) {
  const bar = document.getElementById("data-bar");
  const history = document.getElementById("history-panel");
  bar.replaceChildren();
  history.replaceChildren();
  if (tab !== "predispatch") {
    bar.append(element("span", { class: "note" }, "情境評估：每日淨收益先手動輸入；公式下方可用歷史資料檢討價差標準。"));
    history.removeAttribute("hidden");
    mount_history(history, state);
    return;
  }
  history.setAttribute("hidden", "");
  const status = state.data_status;
  const button = element("button", { type: "button", class: "primary" }, status?.loading ? "讀取中…" : "重新讀取 AEMO 電價");
  if (status?.loading) button.setAttribute("disabled", "");
  button.addEventListener("click", load_predispatch);
  bar.append(button);
  if (status?.loading) bar.append(element("span", { class: "loading" }, "正在讀取 AEMO 實際與預調度電價…"));
  else if (status?.error) bar.append(element("span", { class: "error" }, `讀取失敗：${status.error}。可以直接在下方「電價」欄手動輸入均價。`));
  else if (status?.cycle) {
    const { cycle, fetched_at, charge, discharge, actual_periods } = status;
    const leg = (name, range) => range ? `${name} ${time_label(range.first)} 到 ${time_label(range.last)}` : `${name}（時段未知）`;
    bar.append(element("span", {}, `${fetched_at.toLocaleTimeString("zh-TW", { hour12: false })} 取得實際 ${actual_periods} 個、預調度 ${cycle.forecast_periods} 個 30 分鐘時段；${leg("充電", charge)}、${leg("放電", discharge)}（市場時間，AEMO 時段標記），每段 ${cycle.periods_per_leg} 個時段`));
  } else bar.append(element("span", { class: "note" }, "尚未讀取，目前用預設均價。"));
}

function render_chart({ tab, results }) {
  const container = document.getElementById("price-chart");
  if (!container) return;
  if (tab !== "predispatch") {
    container.setAttribute("hidden", "");
    container.replaceChildren();
    document.getElementById("tide-strip")?.replaceChildren();
    return;
  }
  container.removeAttribute("hidden");
  if (!state.series) {
    container.replaceChildren(element("p", { class: "note" }, state.data_status?.loading ? "電價曲線讀取中…" : "讀到 AEMO 電價後，這裡會畫出實際電價、預調度電價與建議充放電時段。"));
    return;
  }
  const decision = results.find((result) => result.id === "dispatch_decision");
  const label = decision && !decision.error ? format_value(decision.value, "decision") : null;
  const model = build_chart_model(state.series, state.data.predispatch ?? null);
  const strip = document.getElementById("tide-strip");
  if (strip) {
    const animate = view.decision !== null && label !== null && label !== view.decision;
    render_tide_strip(strip, model, { decision: label, animate });
  }
  view.decision = label;
  render_price_chart(container, model, { decision: label });
  if (state.series.actual.length === 0) container.append(element("p", { class: "note" }, "這次回應沒有實際電價時段，只畫出預調度電價。"));
}

function render_variables(variables) {
  const list = document.getElementById("variable-list");
  list.replaceChildren();
  view.aggregates.clear();
  for (const group of GROUPS) {
    const members = variables.filter((variable) => group_of(variable) === group.id);
    if (members.length === 0) continue;
    const fieldset = element("fieldset", { class: "var-group", style: `flex: ${members.length} 1 ${Math.min(members.length, 4) * 9.25 + 1.5}rem` });
    fieldset.append(element("legend", {}, group.label));
    const fields = element("div", { class: "fields" });
    for (const variable of members) fields.append(variable_field(variable));
    fieldset.append(fields);
    list.append(fieldset);
  }
}

function variable_field(variable) {
  const wrapper = element("div", { class: `variable${variable.origin === "user" ? " overridden" : ""}` });
  const id = `var-${variable.key}`;
  const label_text = `${short_label(variable.label)}${variable.unit && variable.unit !== "—" ? `（${variable.unit}）` : ""}`;
  const help = [TERMS[variable.key]?.meaning, variable.hint].filter(Boolean).join("。");
  const label = element("label", { for: id }, label_text);
  if (variable.origin === "user") label.append(element("span", { class: "changed" }, " • 已改"));
  wrapper.append(label);
  const input = element("input", { id, type: "number", step: "any", value: String(variable.value) });
  if (variable.origin === "aggregate") { input.setAttribute("disabled", ""); view.aggregates.set(variable.key, input); }
  const apply = () => {
    const value = Number(input.value);
    if (input.value === "" || !Number.isFinite(value)) delete state.value_overrides[variable.key];
    else state.value_overrides[variable.key] = value;
  };
  input.addEventListener("input", () => { apply(); schedule_preview(); });
  input.addEventListener("change", () => { apply(); render(); });
  wrapper.append(input);
  const origin = variable.added_by_user ? "你在式子裡新增的變數" : ORIGIN_LABELS[variable.origin];
  const origin_line = element("div", { class: "origin" }, `${origin} · `);
  origin_line.append(element("code", {}, variable.key));
  wrapper.append(origin_line);
  if (help) wrapper.append(element("p", { class: "hint" }, help));
  return wrapper;
}

function paint_result(node, formula, result) {
  if (result.error) {
    node.setAttribute("class", "result error");
    node.textContent = result.error;
    return;
  }
  const decision = formula.format === "decision" ? (result.value !== 0 ? " decision-go" : " decision-wait") : "";
  node.setAttribute("class", `result${decision}`);
  node.textContent = format_value(result.value, formula.format, formula.unit);
}

function plain_text(expression) {
  return describe_expression(expression, label_of) ?? "式子有無法辨識的字元，請看上方錯誤訊息";
}

function render_formulas(formulas, results, variables) {
  const list = document.getElementById("formula-list");
  list.replaceChildren();
  view.results.clear();
  view.plain.clear();
  const value_of = (name) => variables.find((entry) => entry.key === name)?.value ?? results.find((entry) => entry.id === name)?.value;
  formulas.forEach((formula, index) => {
    const result = results[index];
    const card = element("article", { class: "card" });
    const header = element("header");
    const title = element("div", { class: "card-title" });
    title.append(element("h3", {}, formula.name));
    if (formula.scope === "cycle" || formula.scope === "daily") title.append(element("span", { class: "tag" }, formula.scope === "cycle" ? "每循環" : "每日彙總（目前單循環計畫）"));
    header.append(title);
    const value = element("div", { class: "result" });
    paint_result(value, formula, result);
    view.results.set(formula.id, value);
    header.append(value);
    card.append(header);

    const plain = element("p", { class: "plain-formula" }, plain_text(result.expression));
    view.plain.set(formula.id, plain);
    card.append(plain);

    const textarea = element("textarea", { rows: String(Math.max(2, Math.ceil(result.expression.length / 44))), "aria-label": `${formula.name}的式子`, spellcheck: "false" });
    textarea.value = result.expression;
    const apply = () => {
      if (textarea.value.trim() === formula.expression) delete state.expression_overrides[formula.id];
      else state.expression_overrides[formula.id] = textarea.value;
    };
    textarea.addEventListener("input", () => { apply(); schedule_preview(); });
    textarea.addEventListener("change", () => { apply(); render(); });
    card.append(textarea);

    const chips = element("div", { class: "chips", "aria-label": "代號對照，點一下插入式子" });
    for (const name of result.uses) {
      const current = value_of(name);
      const chip = element("button", { type: "button", class: "chip", title: TERMS[name]?.meaning ?? "你在式子裡新增的名稱" });
      chip.append(element("span", {}, label_of(name)), element("code", {}, name));
      if (typeof current === "number") chip.append(element("span", { class: "chip-value" }, `＝${current.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`));
      chip.addEventListener("click", () => { insert_at_cursor(textarea, name); apply(); render(); });
      chips.append(chip);
    }
    card.append(chips);
    if (result.edited) {
      const reset = element("button", { type: "button" }, "還原建議式子");
      reset.addEventListener("click", () => { delete state.expression_overrides[formula.id]; render(); });
      card.append(element("span", { class: "edited" }, "已改寫 "), reset);
    }

    const details = element("details", { class: "guidance" });
    details.append(element("summary", {}, "原則、方法、怎麼選與來源"));
    const guidance = element("dl");
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
    details.append(guidance);
    card.append(details);
    list.append(card);
  });
  list.append(element("p", { class: "note" }, `式子可用：+ − × ÷（* /）、^、比較（> >= < <= == !=）、${SUPPORTED_FUNCTIONS.join("、")}。輸入未定義的名稱，按 Enter 或離開欄位後會在輸入區新增一欄。`));
}

function insert_at_cursor(textarea, text) {
  const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
  const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const pad_left = before && !/[\s(,]$/.test(before) ? " " : "";
  const pad_right = after && !/^[\s),]/.test(after) ? " " : "";
  textarea.value = `${before}${pad_left}${text}${pad_right}${after}`;
}

async function load_predispatch() {
  state.data_status = { ...state.data_status, loading: true };
  render_data_bar(current_tab());
  render_chart({ tab: current_tab(), results: [] });
  try {
    const payload = await fetch_report();
    const series = parse_price_series(payload);
    const forecast = parse_report(payload);
    const cycle = best_single_cycle(forecast, state.config.battery);
    if (!cycle) throw new Error("預測時段不足以排出一個完整循環");
    state.data = { predispatch: cycle };
    state.series = series;
    state.data_status = {
      cycle, fetched_at: new Date(), actual_periods: series.actual.length,
      charge: leg_range(forecast, cycle.charge_start, cycle.periods_per_leg),
      discharge: leg_range(forecast, cycle.discharge_start, cycle.periods_per_leg),
    };
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
  document.getElementById("verdict")?.replaceChildren(element("p", { class: "verdict-word error" }, "無法載入"), element("p", { class: "verdict-why" }, error.message));
  document.getElementById("formula-list").replaceChildren(element("p", { class: "result error" }, error.message));
});
