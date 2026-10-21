/**
 * 頁面：一個網址、兩個分頁（#predispatch、#scenario）。兩個分頁共用同一份公式登記檔、變數目錄與計算引擎。
 *
 * 版面（docs/design.md）：分頁標題說明用途 → 結論列 → 電價與充放電排程圖（昨天、今天、明天三天等距時間軸，左右兩個 y 軸）→ 公式區。
 * 公式區同時是輸入區：式子裡每個變數都是一個中文名稱框框（依類別上色），框裡直接改數值；說明、單位與來源在滑鼠移上或聚焦時才顯示。
 * 改寫公式也用中文名稱，不出現英文代號；打一個新的中文名稱就會多一個輸入框。
 * 輸入時即時預覽（input 事件，短暫延遲後重算）；離開欄位或按 Enter（change 事件）才重建整頁。
 * 分享與比較（P7）：設定可編進網址；比較區用同一份當次資料，並排預設版與目前版本。
 * 資料可信度（T8）：只有即時資料才在結論列給「執行／等待」；手動試算、讀取中、讀取失敗、可能過期都另外標示。
 */

import { compute } from "./engine.js";
import { compute_day } from "./day.js";
import { mount_history } from "./history_panel.js";
import { check_registry } from "./registry_check.js";
import { best_single_cycle, parse_report } from "./predispatch.js";
import { fetch_report } from "./aemo_fetch.js";
import { build_chart_model, leg_range, parse_price_series, three_day_window } from "./price_series.js";
import { render_dispatch_chart } from "./price_chart.js";
import { GROUPS, SHORT_LABELS, TERMS, group_of, short_label } from "./formula_help.js";
import { FUNCTION_TEXT, from_chinese, to_chinese, to_parts } from "./formula_text.js";
import { STALE_MINUTES, data_trust } from "./data_trust.js";
import { money, price_input } from "./format.js";
import { apply_share, compare_rows, custom_key, decode_share, encode_share, read_share, share_snapshot, share_url } from "./share_state.js";

const TABS = ["predispatch", "scenario"];
const PAGE_COPY = {
  predispatch: {
    title: "預調度：下一個循環要執行還是等待",
    lede: "讀取 AEMO NSW1 的 30 分鐘預調度電價，選出均價最低的一段充電與其後均價最高的一段放電（每段長度＝容量 ÷ 功率），扣掉來回效率、損耗成本與邊際損失係數；價差達到標準且淨收益為正才執行。",
  },
  scenario: {
    title: "情境評估：目標期間能賺多少、價差標準要不要調",
    lede: "目標期間收益＝天數 × 可用率 × 每日淨收益（選定分位數）× 因素調整倍數；下方用已下載的 AEMO 歷史電價，試算不同價差標準下的收益保留率。",
  },
};
const ORIGIN_LABELS = { user: "你調整的值", data: "來自資料", config: "來自設定檔", default: "預設值", aggregate: "自動加總，不能直接改" };
const GUIDANCE_LABELS = { principle: "原則", method: "方法", how_to_choose: "建議怎麼選" };
const CATEGORY_LABELS = Object.fromEntries([...GROUPS.map((group) => [group.id, group.label]), ["result", "計算結果"]]);
const PREVIEW_DELAY_MS = 200;
const TRUST_CHECK_MS = 60 * 1000;

const state = { registry: null, catalog: null, config: {}, data: {}, series: null, value_overrides: {}, expression_overrides: {}, custom_labels: {}, data_status: null, scenario_history: null, share_notice: null };
const view = { results: new Map(), result_chips: new Map(), inputs: new Map(), aggregates: new Map(), editing: new Set(), timer: null, decision: null, width: null };

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
  if (format === "currency") return money(value);
  const text = value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
  return `${text}${unit ? ` ${unit}` : ""}`;
}
const plain_number = (value) => value.toLocaleString("zh-TW", { maximumFractionDigits: 2 });

/** 預設版：沒有任何覆寫、改寫或歷史模式，但沿用同一份當次資料。 */
const default_settings = () => ({ value_overrides: {}, expression_overrides: {}, scenario_history: null });

function evaluate_view(settings = state) {
  const tab = current_tab();
  const historical = settings.scenario_history;
  const use_history = historical?.active && !Object.hasOwn(settings.value_overrides, "daily_revenue");
  const args = {
    registry: state.registry,
    catalog: use_history ? { ...state.catalog, variables: state.catalog.variables.map((entry) => entry.key === "daily_revenue"
      ? { ...entry, source: { type: "data", ref: "scenario.daily_revenue" }, hint: `歷史 ${historical.quantile.toUpperCase()}：${historical.start} 至 ${historical.end}；事後價格，不是預測` } : entry) } : state.catalog,
    context: { config: state.config, data: { ...state.data, scenario: historical } },
    variable_errors: use_history && historical.error ? { daily_revenue: historical.error } : {},
    value_overrides: settings.value_overrides,
    expression_overrides: settings.expression_overrides,
  };
  const base = compute(args);
  const plan = compute_day({ ...args, cycles: [state.data] });
  const variables = [...new Map([...base.variables, ...plan.cycles[0].variables, ...plan.daily.variables].map((variable) => [variable.key, variable])).values()];
  const results = [...new Map([...base.results, ...plan.cycles[0].results, ...plan.daily.results].map((result) => [result.id, result])).values()];
  const visible = state.registry.formulas.filter((formula) => formula.page === tab || formula.page === "shared");
  const visible_results = visible.map((formula) => results.find((result) => result.id === formula.id));
  return { tab, variables, results, visible, visible_results };
}

/** 代號 → 中文名稱（畫面上唯一出現的名稱）。 */
function label_of(name) {
  if (Object.hasOwn(state.custom_labels, name)) return state.custom_labels[name];
  if (Object.hasOwn(SHORT_LABELS, name)) return SHORT_LABELS[name];
  const formula = state.registry.formulas.find((entry) => entry.id === name);
  if (formula) return formula.name;
  const variable = state.catalog.variables.find((entry) => entry.key === name);
  return variable ? short_label(variable.label) : name;
}

/** 中文名稱 → 代號；不認得的中文名稱變成新的自訂變數（代號由名稱決定，同名永遠對到同一個代號）。 */
function key_of(word) {
  const known = [
    ...Object.entries(state.custom_labels).map(([key, label]) => [label, key]),
    ...Object.entries(SHORT_LABELS).map(([key, label]) => [label, key]),
    ...state.registry.formulas.map((formula) => [formula.name, formula.id]),
    ...state.catalog.variables.map((variable) => [short_label(variable.label), variable.key]),
  ];
  const hit = known.find(([label]) => label === word);
  if (hit) return hit[1];
  if (/^[a-z_][a-z0-9_]*$/.test(word)) return word;
  const key = custom_key(word);
  state.custom_labels[key] = word;
  return key;
}

function category_of(name, variables) {
  if (state.registry.formulas.some((formula) => formula.id === name)) return "result";
  const variable = variables.find((entry) => entry.key === name);
  return variable ? group_of(variable) : "custom";
}

function render() {
  clearTimeout(view.timer);
  const result = evaluate_view();
  document.querySelectorAll(".tabs a").forEach((link) => {
    if (link.dataset.tab === result.tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  render_page_head(result.tab);
  render_verdict(result);
  render_data_bar(result.tab);
  render_chart(result);
  render_formulas(result);
  render_compare(result);
  set_status("done");
}

/** 即時預覽：只更新結果、計算結果框框與圖，不重建輸入框，避免打字時游標跳走。 */
function refresh() {
  const result = evaluate_view();
  result.visible.forEach((formula, index) => {
    const node = view.results.get(formula.id);
    if (node) paint_result(node, formula, result.visible_results[index]);
  });
  for (const [id, nodes] of view.result_chips) {
    const entry = result.results.find((item) => item.id === id);
    for (const node of nodes) node.textContent = result_chip_text(id, entry);
  }
  for (const [key, inputs] of view.aggregates) {
    const variable = result.variables.find((entry) => entry.key === key);
    if (variable) for (const input of inputs) input.value = String(variable.value);
  }
  render_verdict(result);
  render_chart(result);
  render_compare(result);
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

function render_page_head(tab) {
  const title = document.getElementById("page-title");
  const lede = document.getElementById("page-lede");
  if (title) title.textContent = PAGE_COPY[tab].title;
  if (lede) lede.textContent = PAGE_COPY[tab].lede;
}

const find_result = (results, id) => results.find((entry) => entry.id === id);
const find_variable = (variables, key) => variables.find((entry) => entry.key === key);

/** 結論列：預調度顯示執行或等待；情境評估顯示目標期間收益。理由寫具體數字。 */
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
    const standard = find_variable(variables, "spread_standard");
    const trust = current_trust();
    if (trust.kind === "loading" || trust.kind === "error" || trust.kind === "none") {
      word.textContent = { loading: "讀取中", error: "讀取失敗", none: "尚未取得電價" }[trust.kind];
      word.setAttribute("class", `verdict-word ${trust.kind === "error" ? "error" : "pending"}`);
      why.textContent = trust.kind === "loading" ? "正在讀取 AEMO 電價，讀到後才給執行或等待。"
        : trust.kind === "error" ? `${trust.error}。沒有拿舊電價判斷；可以在下方公式的「充電段均價」「放電段均價」框裡輸入，做手動試算。`
        : "按「重新讀取 AEMO 電價」，或在下方公式的均價框裡輸入，做手動試算。";
    } else if (!decision || decision.error) {
      word.textContent = "無法判斷";
      word.setAttribute("class", "verdict-word error");
      why.textContent = decision?.error ?? "找不到「執行或等待」公式";
    } else {
      const go = decision.value !== 0;
      const parts = [];
      if (spread && !spread.error && standard) parts.push(`價差 ${plain_number(spread.value)} ${spread.value >= standard.value ? "≥" : "<"} 標準 ${plain_number(standard.value)} AUD/MWh`);
      if (cycle && !cycle.error) parts.push(`每循環淨收益 ${format_value(cycle.value, "currency")}`);
      if (daily && !daily.error) parts.push(`當日執行淨收益 ${format_value(daily.value, "currency")}`);
      if (trust.kind === "live") {
        word.textContent = go ? "執行" : "等待";
        word.setAttribute("class", `verdict-word ${go ? "decision-go" : "decision-wait"}`);
        why.textContent = parts.join(" · ");
      } else {
        word.textContent = trust.kind === "manual" ? "手動試算" : "資料可能過期";
        word.setAttribute("class", "verdict-word trial");
        const reason = trust.kind === "manual"
          ? `你改了${trust.manual.map((key) => `「${label_of(key)}」`).join("、")}，不是當下建議`
          : trust.age_minutes === null ? "無法判斷資料時間，請重新讀取" : `最後實際時段是 ${trust.age_minutes} 分鐘前（超過 ${STALE_MINUTES} 分鐘），請重新讀取`;
        why.textContent = [reason, `試算結果：${go ? "執行" : "等待"}`, ...parts].join(" · ");
      }
    }
  } else {
    const period = find_result(results, "period_revenue");
    const ok = period && !period.error;
    word.textContent = ok ? format_value(period.value, "currency") : "無法估算";
    word.setAttribute("class", `verdict-word${ok ? "" : " error"}`);
    if (!ok) why.textContent = period?.error ?? "找不到「目標期間收益」公式";
    else {
      const factor = find_result(results, "factor_multiplier");
      const values = [["days", (v) => `${plain_number(v)} 天`], ["availability", (v) => `可用率 ${plain_number(v)}`], ["daily_revenue", (v) => `每日 ${format_value(v, "currency")}`]]
        .map(([key, text]) => find_variable(variables, key) && text(find_variable(variables, key).value)).filter(Boolean);
      if (factor && !factor.error) values.push(`調整倍數 ${plain_number(factor.value)}`);
      why.textContent = `目標期間收益 · ${values.join(" × ")}`;
    }
  }
  node.replaceChildren(word, why);
}

/** 目前預調度資料能不能當作當下建議（T8）。 */
function current_trust() {
  return data_trust({ status: state.data_status, series: state.series, value_overrides: state.value_overrides, now: Date.now() });
}

function render_data_bar(tab) {
  const bar = document.getElementById("data-bar");
  const history = document.getElementById("history-panel");
  const section = document.getElementById("chart-section");
  bar.replaceChildren();
  history.replaceChildren();
  if (tab !== "predispatch") {
    section?.setAttribute("hidden", "");
    history.removeAttribute("hidden");
    mount_history(history, state, () => { if (current_tab() === "scenario") { refresh(); render_formulas(evaluate_view()); } });
    return;
  }
  section?.removeAttribute("hidden");
  history.setAttribute("hidden", "");
  const status = state.data_status;
  if (status?.loading) bar.append(element("span", { class: "loading" }, "正在讀取 AEMO 實際與預調度電價…"));
  else if (status?.error) bar.append(element("span", { class: "error" }, `讀取失敗：${status.error}。可以直接在下方公式的「充電段均價」「放電段均價」框裡輸入。`));
  else if (status?.cycle) {
    const { cycle, fetched_at, actual_periods } = status;
    bar.append(element("span", {}, `NSW1 · ${fetched_at.toLocaleTimeString("zh-TW", { hour12: false })} 取得 · 實際 ${state.series.actual_source.count} 筆 5 分鐘資料 → ${actual_periods} 個完整 30 分鐘時段＋預調度 ${cycle.forecast_periods} 個 30 分鐘時段 · 每段 ${cycle.periods_per_leg} 個時段 · 時間為 AEMO 時段結束時間`));
    const trust = data_trust({ status, series: state.series, now: Date.now() });
    if (trust.at !== null && trust.at !== undefined) {
      const ended = new Date(trust.at + 10 * 60 * 60000).toISOString().slice(0, 16).replace("T", " ");
      const name = state.series.actual_source.count ? "最後實際時段" : "資料參考時段";
      bar.append(element("span", trust.kind === "stale" ? { class: "error" } : {}, `${name}結束於 NEM ${ended}（UTC+10）${trust.kind === "stale" ? "，可能過期" : ""}`));
    }
    else if (trust.kind === "stale") bar.append(element("span", { class: "error" }, "無法判斷資料時間，可能過期"));
  } else bar.append(element("span", {}, "尚未讀取，目前用預設均價。"));
  const button = element("button", { type: "button", class: "primary" }, status?.loading ? "讀取中…" : "重新讀取 AEMO 電價");
  if (status?.loading) button.setAttribute("disabled", "");
  button.addEventListener("click", load_predispatch);
  bar.append(button);
}

function render_chart({ tab, results }) {
  const container = document.getElementById("price-chart");
  if (!container || tab !== "predispatch") { container?.replaceChildren(); return; }
  if (!state.series) {
    container.replaceChildren(element("p", { class: "note" }, state.data_status?.loading ? "電價讀取中…" : "讀到 AEMO 電價後，這裡會畫出昨天到明天的實際與預調度電價，以及建議的充放電時段與功率。"));
    return;
  }
  const decision = find_result(results, "dispatch_decision");
  const trust = current_trust();
  const base_label = decision && !decision.error ? format_value(decision.value, "decision") : null;
  const label = base_label && trust.kind !== "live" ? `試算：${base_label}` : base_label;
  const animate = view.decision !== null && label !== null && label !== view.decision;
  view.decision = label;
  view.width = container.clientWidth || null;
  const timeline = three_day_window(state.series);
  const model = build_chart_model(state.series, state.data.predispatch ?? null, timeline?.times ?? null);
  render_dispatch_chart(container, model, { decision: label, power_mw: state.config.battery?.power_mw ?? 0, animate, days: timeline?.days ?? null });
  const source = state.series.actual_source;
  if (source?.count) container.append(element("p", { class: "note" }, `實際電價來源範圍（5 分鐘時段結束，NEM UTC+10）：${source.first.replace("T", " ")} 至 ${source.last.replace("T", " ")}；僅畫出每段六筆齊全的 30 分鐘均價，範圍外或缺筆處留空。`));
  if (state.series.actual.length === 0) container.append(element("p", { class: "note" }, "這次回應沒有完整的實際電價 30 分鐘時段，只畫出預調度電價。"));
}

/** 改了哪些設定：數值列出預設 → 你的；改寫的公式列出中文式子；啟用中的歷史分位數列出條件。 */
function setting_changes(base_variables) {
  const items = [];
  for (const [key, value] of Object.entries(state.value_overrides)) {
    const base = find_variable(base_variables, key);
    if (!base) items.push(`${label_of(key)}（你新增的）＝ ${plain_number(value)}`);
    else if (base.value !== value) items.push(`${label_of(key)}：${plain_number(base.value)} → ${plain_number(value)}`);
  }
  for (const [id, expression] of Object.entries(state.expression_overrides)) {
    items.push(`改寫「${label_of(id)}」＝ ${to_chinese(expression, label_of)}`);
  }
  const history = state.scenario_history;
  if (history?.active && !Object.hasOwn(state.value_overrides, "daily_revenue")) {
    items.push(`每日淨收益改用歷史 ${history.quantile.toUpperCase()}（${history.start} 至 ${history.end}，價差標準 ${plain_number(Number(history.standard))} AUD/MWh）`);
  }
  return items;
}

function compare_cell(formula, result) {
  if (!result || result.error) return "無法計算";
  return format_value(result.value, formula.format, formula.unit);
}

function delta_text(row) {
  if (row.same) return "相同";
  if (row.format === "decision" || row.delta === null) return "不同";
  const sign = row.delta > 0 ? "+" : "−";
  const size = Math.abs(row.delta);
  return row.format === "currency" ? `${sign}A$ ${size.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}` : `${sign}${plain_number(size)}${row.unit && row.unit !== "—" ? ` ${row.unit}` : ""}`;
}

/** 與預設值比較：同一份當次資料下，預設版與目前版本逐條並排。 */
function render_compare(current) {
  const body = document.getElementById("compare-body");
  if (!body) return;
  const nodes = [];
  if (state.share_notice) nodes.push(element("p", { class: state.share_notice.error ? "error" : "note" }, state.share_notice.text));
  const base = evaluate_view(default_settings());
  const changes = setting_changes(base.variables);
  if (changes.length === 0) {
    nodes.push(element("p", { class: "compare-same" }, "目前與預設相同。"));
    body.replaceChildren(...nodes);
    return;
  }
  const list = element("ul", { class: "compare-changes", "aria-label": "你改了哪些設定" });
  for (const text of changes) list.append(element("li", {}, text));
  nodes.push(list);
  const table = element("table", { class: "compare-table" });
  const head = element("tr");
  for (const text of ["公式", "預設", "你的版本", "差異"]) head.append(element("th", { scope: "col" }, text));
  table.append(head);
  for (const row of compare_rows(current.visible, base.results, current.results)) {
    const formula = current.visible.find((item) => item.id === row.id);
    const tr = element("tr", row.same ? {} : { class: "changed-row" });
    tr.append(element("th", { scope: "row" }, row.name), element("td", {}, compare_cell(formula, row.base)), element("td", {}, compare_cell(formula, row.current)), element("td", {}, delta_text(row)));
    table.append(tr);
  }
  nodes.push(table);
  body.replaceChildren(...nodes);
}

async function share_settings() {
  const output = document.getElementById("share-output");
  if (!output) return;
  let url;
  try {
    const snapshot = share_snapshot(state);
    decode_share(encode_share(snapshot), { registry: state.registry, catalog: state.catalog });
    url = share_url(location, snapshot, current_tab());
  } catch (error) {
    output.replaceChildren(element("p", { class: "error" }, `無法產生分享網址：${error.message}`));
    return;
  }
  const field = element("input", { type: "text", readonly: "", value: url, "aria-label": "分享網址", class: "share-url" });
  const status = element("p", { class: "note", role: "status" }, "複製中…");
  output.replaceChildren(field, status);
  try {
    await globalThis.navigator.clipboard.writeText(url);
    status.textContent = "已複製分享網址。只保存設定，不保存電價；對方開啟時會依當下取得的電價重算。";
  } catch {
    status.textContent = "無法自動複製，請手動複製上方網址。只保存設定，不保存電價。";
  }
}

function paint_result(node, formula, result) {
  if (formula.id === "dispatch_decision" && current_tab() === "predispatch" && current_trust().kind === "loading") {
    node.setAttribute("class", "result");
    node.textContent = "讀取中";
    return;
  }
  if (result.error) {
    node.setAttribute("class", "result error");
    node.textContent = result.error;
    return;
  }
  const decision = formula.format === "decision" ? (result.value !== 0 ? " decision-go" : " decision-wait") : "";
  node.setAttribute("class", `result${decision}`);
  node.textContent = format_value(result.value, formula.format, formula.unit);
}

function result_chip_text(id, entry) {
  const formula = state.registry.formulas.find((item) => item.id === id);
  if (!entry || entry.error) return "—";
  return format_value(entry.value, formula?.format, formula?.unit);
}

let tip_count = 0;
/** 中文名稱框框：變數框裡直接改值；計算結果框只顯示值。說明、單位與來源在滑鼠移上或聚焦時顯示。 */
function name_chip(name, formula_id, { variables, results }) {
  const category = category_of(name, variables);
  const tip_id = `tip-${++tip_count}`;
  const tip = element("span", { class: "chip-tip", role: "tooltip", id: tip_id });
  const label = label_of(name);
  if (category === "result") {
    const formula = state.registry.formulas.find((item) => item.id === name);
    const chip = element("span", { class: "chip cat-result", tabindex: "0", "aria-describedby": tip_id });
    const value = element("span", { class: "chip-value" }, result_chip_text(name, find_result(results, name)));
    if (!view.result_chips.has(name)) view.result_chips.set(name, []);
    view.result_chips.get(name).push(value);
    chip.append(element("span", { class: "chip-name" }, label), value);
    tip.textContent = [TERMS[name]?.meaning, formula?.unit && formula.unit !== "—" ? `單位：${formula.unit}` : null, "由上方的公式算出"].filter(Boolean).join("。");
    chip.append(tip);
    return chip;
  }
  const variable = find_variable(variables, name);
  const history_error = name === "daily_revenue" && state.scenario_history?.active ? state.scenario_history.error : null;
  const id = `var-${formula_id}-${name}`;
  const chip = element("span", { class: `chip cat-${category}${variable?.origin === "user" ? " overridden" : ""}` });
  chip.append(element("label", { for: id, class: "chip-name" }, label));
  const round_input = name === "charge_price" || name === "discharge_price" || name === "daily_revenue";
  const display = round_input ? price_input(variable?.value ?? 0) : String(variable?.value ?? 0);
  const input = element("input", { id, type: "number", step: "any", inputmode: "decimal", value: history_error ? "" : display, "data-key": name, "aria-describedby": tip_id });
  let dirty = false;
  const size = () => input.setAttribute("style", `--chars: ${Math.min(10, Math.max(3, String(input.value).length))}`);
  size();
  if (variable?.origin === "aggregate") {
    input.setAttribute("disabled", "");
    if (!view.aggregates.has(name)) view.aggregates.set(name, []);
    view.aggregates.get(name).push(input);
  }
  if (!view.inputs.has(name)) view.inputs.set(name, []);
  view.inputs.get(name).push(input);
  const apply = (editing = false) => {
    dirty ||= editing;
    // 未輸入就離開欄位，不把顯示用的兩位小數寫回原始精度。
    if (round_input && !dirty && input.value === display) return;
    if (name === "daily_revenue" && state.scenario_history) state.scenario_history.active = false;
    const value = Number(input.value);
    if (input.value === "" || !Number.isFinite(value)) delete state.value_overrides[name];
    else state.value_overrides[name] = value;
    for (const twin of view.inputs.get(name)) if (twin !== input) twin.value = input.value;
    size();
  };
  input.addEventListener("input", () => { apply(true); schedule_preview(); });
  input.addEventListener("change", () => { apply(); render(); });
  chip.append(input);
  if (variable?.origin === "user") chip.append(element("span", { class: "changed", "aria-label": "已改" }, "•"));
  const unit = variable?.unit && variable.unit !== "—" ? `單位：${variable.unit}` : null;
  const origin = variable?.added_by_user ? "你在公式裡新增的變數" : ORIGIN_LABELS[variable?.origin];
  tip.textContent = [TERMS[name]?.meaning, history_error, variable?.hint, unit, origin].filter(Boolean).join("。");
  chip.append(tip);
  return chip;
}

function expression_row(expression, formula_id, context) {
  const row = element("p", { class: "expr" });
  const parts = to_parts(expression);
  if (!parts) { row.append(element("span", { class: "error" }, "式子有無法辨識的字元")); return row; }
  for (const part of parts) {
    if (part.type === "name") row.append(name_chip(part.name, formula_id, context));
    else if (part.type === "call") row.append(element("span", { class: "fn" }, part.text));
    else if (part.type === "op") row.append(element("span", { class: `op${part.text === "(" || part.text === ")" || part.text === "，" ? " paren" : ""}` }, part.text));
    else row.append(element("span", { class: "num" }, part.text));
  }
  return row;
}

function render_formulas(context) {
  const { visible, visible_results } = context;
  const list = document.getElementById("formula-list");
  list.replaceChildren();
  view.results.clear();
  view.result_chips.clear();
  view.inputs.clear();
  view.aggregates.clear();
  visible.forEach((formula, index) => {
    const result = visible_results[index];
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

    const equals = element("div", { class: "formula-line" });
    equals.append(element("span", { class: "op eq" }, "＝"), expression_row(result.expression, formula.id, context));
    card.append(equals);

    const actions = element("div", { class: "card-actions" });
    const editing = view.editing.has(formula.id);
    const toggle = element("button", { type: "button", "aria-expanded": String(editing) }, editing ? "完成改寫" : "改寫公式");
    toggle.addEventListener("click", () => { if (editing) view.editing.delete(formula.id); else view.editing.add(formula.id); render(); });
    actions.append(toggle);
    if (result.edited) {
      const reset = element("button", { type: "button" }, "還原建議公式");
      reset.addEventListener("click", () => { delete state.expression_overrides[formula.id]; render(); });
      actions.append(element("span", { class: "edited" }, "已改寫"), reset);
    }
    card.append(actions);
    if (editing) card.append(editor(formula, result, context));

    const details = element("details", { class: "guidance" });
    details.append(element("summary", {}, "原則、方法、怎麼選與來源"));
    const guidance = element("dl");
    for (const [field, label] of Object.entries(GUIDANCE_LABELS)) guidance.append(element("dt", {}, label), element("dd", {}, formula.guidance[field]));
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
}

/** 改寫公式：用中文名稱寫式子，點下方框框插入名稱；打新的中文名稱就多一個輸入框。 */
function editor(formula, result, { variables, visible }) {
  const box = element("div", { class: "editor" });
  const textarea = element("textarea", { rows: "2", "aria-label": `改寫「${formula.name}」`, spellcheck: "false" });
  textarea.value = to_chinese(result.expression, label_of);
  const apply = () => {
    const expression = from_chinese(textarea.value, key_of);
    if (expression.replace(/\s/g, "") === formula.expression.replace(/\s/g, "")) delete state.expression_overrides[formula.id];
    else state.expression_overrides[formula.id] = expression;
  };
  textarea.addEventListener("input", () => { apply(); schedule_preview(); });
  textarea.addEventListener("change", () => { apply(); render(); });
  box.append(textarea);
  const palette = element("div", { class: "palette", "aria-label": "點一下插入名稱" });
  const names = [...visible.filter((item) => item.id !== formula.id).map((item) => item.id), ...variables.filter((variable) => variable.origin !== "aggregate" || formula.scope === "daily").map((variable) => variable.key)];
  for (const name of new Set(names)) {
    const chip = element("button", { type: "button", class: `chip chip-insert cat-${category_of(name, variables)}` }, label_of(name));
    chip.addEventListener("click", () => { insert_at_cursor(textarea, label_of(name)); apply(); render(); });
    palette.append(chip);
  }
  box.append(palette);
  box.append(element("p", { class: "note" }, `運算：+ − × ÷ ^ ≥ ≤ ＝ ≠ ( )；函式：${Object.values(FUNCTION_TEXT).map((text) => `${text}(…)`).join("、")}，參數用「，」分隔。打一個新的中文名稱，按 Enter 或點別處後會多一個輸入框。`));
  return box;
}

function insert_at_cursor(textarea, text) {
  const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
  const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  const pad_left = before && !/[\s(（，,]$/.test(before) ? " " : "";
  const pad_right = after && !/^[\s)），,]/.test(after) ? " " : "";
  textarea.value = `${before}${pad_left}${text}${pad_right}${after}`;
}

async function load_predispatch() {
  state.data_status = { ...state.data_status, loading: true };
  render_data_bar(current_tab());
  refresh();
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
    // T8：讀取失敗時不保留上一次的電價與曲線，避免舊值被當成當下建議。
    state.data = {};
    state.series = null;
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
  const shared = read_share(location.search);
  if (shared !== null) {
    try {
      apply_share(state, decode_share(shared, { registry, catalog }));
      state.share_notice = { text: "已套用分享網址的設定；電價依開啟當下取得的資料重算，結果可能與分享時不同。" };
    } catch (error) {
      state.share_notice = { error: true, text: `分享網址無法套用：${error.message}。已用預設值開啟。` };
    }
  }
  document.getElementById("reset-all").addEventListener("click", () => {
    state.value_overrides = {};
    state.expression_overrides = {};
    state.custom_labels = {};
    state.scenario_history = null;
    state.share_notice = null;
    document.getElementById("share-output")?.replaceChildren();
    if (location.search && typeof window.history?.replaceState === "function") window.history.replaceState(null, "", `${location.pathname}${location.hash}`);
    view.editing.clear();
    render();
  });
  document.getElementById("share-settings")?.addEventListener("click", share_settings);
  window.addEventListener("hashchange", render);
  // T8：頁面開著不動時，每分鐘重新判斷資料是否過期。
  const trust_timer = setInterval(() => {
    if (current_tab() !== "predispatch" || !state.data_status?.cycle) return;
    render_data_bar("predispatch");
    refresh();
  }, TRUST_CHECK_MS);
  trust_timer?.unref?.();
  const chart = document.getElementById("price-chart");
  if (chart && typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      if (chart.clientWidth && chart.clientWidth !== view.width && current_tab() === "predispatch") render_chart(evaluate_view());
    }).observe(chart);
  }
  render();
  if (current_tab() === "predispatch") load_predispatch();
}

start().catch((error) => {
  document.getElementById("verdict")?.replaceChildren(element("p", { class: "verdict-word error" }, "無法載入"), element("p", { class: "verdict-why" }, error.message));
  document.getElementById("formula-list").replaceChildren(element("p", { class: "result error" }, error.message));
});
