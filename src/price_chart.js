/**
 * 電價與充放電排程圖（SVG）：共用一條時間軸（x），左 y 軸是電價（AUD/MWh），右 y 軸是電池功率（MW，放電為正、充電為負）。
 * 時間軸固定為昨天、今天、明天三個交易日，每天 48 個 30 分鐘時段等距排列；實際電價實線、預調度電價虛線、充放電功率長條。
 * 時間刻度上下兩排是 NEM 市場時間與台北時間；依容器實際寬度繪製（不縮放字級），刻度間距不足時自動抽稀，避免文字重疊。
 * 游標滑過顯示垂直線與該時段的時間、電價；拖曳選取一段時間，暫時框框顯示該段的均價。只用 DOM API，不載入圖表套件。
 * P12：模型有多個循環時，每個循環都畫充放電長條，圖下摘要與游標說明標出「循環 1」「循環 2」與各自的判斷。
 */

import { time_label } from "./price_series.js";
import { money } from "./format.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HEIGHT = 280;
const PAD = { top: 40, right: 52, bottom: 48, left: 56 };
const SLOT_MS = 30 * 60 * 1000;
const MIN_LABEL_GAP = 64;
const DEFAULT_WIDTH = 960;

const svg = (tag, attributes = {}, text) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
};
const html = (tag, attributes = {}, text) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
};

const ms_of = (settlement_date) => Date.parse(`${settlement_date}Z`);
const stamp = (ms) => new Date(ms).toISOString().slice(5, 16).replace("-", "/").replace("T", " ");
const clock = (ms) => new Date(ms).toISOString().slice(11, 16);

/** 模型裡的循環；舊的單循環模型（只有 charge／discharge）視為一個循環。 */
const cycles_of = (model) => model.cycles ?? [{ charge: model.charge ?? null, discharge: model.discharge ?? null }];
/** 第 index 個循環的判斷文字；沒有逐循環判斷時，第一個循環沿用 decision。 */
const decision_of = (index, decision, decisions) => decisions?.[index] ?? (index === 0 ? decision : null);

/** 「14:30」→ 台北時間「12:30」（市場時間 − 2 小時）。 */
export function taipei_label(market_time) {
  const match = /^(\d\d):(\d\d)$/.exec(market_time);
  if (!match) return market_time;
  const hour = (Number(match[1]) + 22) % 24;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/** 取 4 到 6 個好讀的刻度。 */
export function nice_ticks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw);
  const ticks = [];
  for (let value = Math.floor(min / step) * step; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

/** 每隔幾個時段標一次時間，讓相鄰標籤至少相隔 min_gap px；只取 1、2、3、4、6、12、24、48 這些整點好讀的間隔。 */
export function label_every(slot_width, min_gap = MIN_LABEL_GAP) {
  const needed = Math.ceil(min_gap / Math.max(slot_width, 0.001));
  return [1, 2, 3, 4, 6, 12, 24, 48].find((step) => step >= needed) ?? needed;
}

/** 充電段或放電段的一行摘要，放在圖下方（HTML，可自動換行，不會疊字）。prefix 用來標「循環 1 」。 */
export function leg_text(kind, leg, power_mw, decision, prefix = "") {
  if (!leg) return null;
  const range = `${time_label(leg.first)}–${time_label(leg.last)}`;
  const taipei = `${taipei_label(time_label(leg.first))}–${taipei_label(time_label(leg.last))}`;
  const power = kind === "charge" ? `−${power_mw} MW` : `+${power_mw} MW`;
  const name = kind === "charge" ? "充電" : "放電";
  return `${prefix}${name} ${range}（台北 ${taipei}）· 均價 ${money(leg.average)}/MWh · ${power}${kind === "discharge" && decision ? ` · ${decision}` : ""}`;
}

/** 第 index 個時段的開始與結束（AEMO 標記是結束時間）。 */
function slot_span(model, index) {
  const end = ms_of(model.rows[index].time);
  return { start: end - SLOT_MS, end };
}

/** 一段時間的 NEM 與台北時間標籤，例如「10/21 02:00–06:00（台北 10/21 00:00–04:00）」。 */
export function span_label(start, end) {
  const same_day = (a, b) => stamp(a).slice(0, 5) === stamp(b).slice(0, 5);
  const text = (a, b) => `${stamp(a)}–${same_day(a, b) ? clock(b) : stamp(b)}`;
  return `${text(start, end)}（台北 ${text(start - 2 * 60 * 60 * 1000, end - 2 * 60 * 60 * 1000)}）`;
}

/** 游標所在的時段：時間、實際與預調度電價、充放電動作。 */
export function slot_detail(model, index, power_mw = 0, decision = null, decisions = null) {
  const row = model.rows[index];
  const { start, end } = slot_span(model, index);
  const inside = (leg) => leg && index >= leg.from && index <= leg.to;
  const cycles = cycles_of(model);
  const prefix = (number) => (cycles.length > 1 ? `循環 ${number + 1} ` : "");
  const lines = [];
  lines.push(row.actual === null ? "實際：無資料" : `實際 ${money(row.actual)}/MWh`);
  lines.push(row.forecast === null ? "預調度：無資料" : `預調度 ${money(row.forecast)}/MWh`);
  let action = "不動作";
  cycles.forEach((cycle, number) => {
    const label = decision_of(number, decision, decisions);
    if (inside(cycle.charge)) action = `${prefix(number)}充電 −${power_mw} MW`;
    else if (inside(cycle.discharge)) action = `${prefix(number)}放電 +${power_mw} MW${label ? `（${label}）` : ""}`;
  });
  lines.push(action);
  return { title: `NEM ${span_label(start, end)}`, lines };
}

/** 選取的一段時間：時段數與實際、預調度均價（只平均有資料的時段）。 */
export function range_summary(model, from, to) {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const rows = model.rows.slice(low, high + 1);
  const average = (kind, name) => {
    const values = rows.map((row) => row[kind]).filter((value) => value !== null);
    return values.length ? `${name}均價 ${money(values.reduce((sum, value) => sum + value, 0) / values.length)}/MWh（${values.length} 個時段）` : `${name}：無資料`;
  };
  const start = slot_span(model, low).start;
  const end = slot_span(model, high).end;
  return { title: `NEM ${span_label(start, end)}· ${rows.length} 個時段（${rows.length / 2} 小時）`, lines: [average("actual", "實際"), average("forecast", "預調度")] };
}

/** 游標的 x（SVG 座標）→ 時段編號。 */
export function index_at(x, full_width, count) {
  const step = (full_width - PAD.left - PAD.right) / count;
  return Math.max(0, Math.min(count - 1, Math.floor((x - PAD.left) / step)));
}

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import("./price_series.js").build_chart_model>} model
 * @param {{decision?: string|null, decisions?: (string|null)[]|null, power_mw?: number, animate?: boolean, width?: number, days?: {date: string, name: string}[]}} options
 *   decision 是第一個循環的判斷；decisions 依循環順序列出每個循環的判斷（P12）。
 */
export function render_dispatch_chart(container, model, { decision = null, decisions = null, power_mw = 0, animate = false, width, days = null } = {}) {
  container.replaceChildren();
  const legend = html("div", { class: "chart-legend" });
  for (const [kind, text] of [["actual", "實際電價（左軸）"], ["forecast", "預調度電價（左軸）"], ["charge", "充電功率（右軸）"], ["discharge", "放電功率（右軸）"]]) {
    legend.append(html("span", { class: `legend-${kind}` }, text));
  }
  container.append(legend);
  if (model.rows.length === 0) return;

  const full_width = Math.max(320, Math.round(width || container.clientWidth || DEFAULT_WIDTH));
  const inner_width = full_width - PAD.left - PAD.right;
  const inner_height = HEIGHT - PAD.top - PAD.bottom;
  const step = inner_width / model.rows.length;
  const x = (index) => PAD.left + index * step + step / 2;
  const edge = (index) => PAD.left + index * step;

  const ticks = nice_ticks(model.min, model.max);
  const low = Math.min(ticks[0], model.min);
  const high = Math.max(ticks.at(-1), model.max);
  const y = (price) => PAD.top + (high === low ? inner_height / 2 : ((high - price) / (high - low)) * inner_height);
  const mw_limit = Math.max(power_mw, 1) * 1.25;
  const y_mw = (mw) => PAD.top + ((mw_limit - mw) / (2 * mw_limit)) * inner_height;

  const cycles = cycles_of(model);
  const summary = cycles.flatMap((cycle, number) => {
    const prefix = cycles.length > 1 ? `循環 ${number + 1} ` : "";
    const label = decision_of(number, decision, decisions);
    return [leg_text("charge", cycle.charge, power_mw, label, prefix), leg_text("discharge", cycle.discharge, power_mw, label, prefix)];
  }).filter(Boolean);
  const chart = svg("svg", {
    width: full_width, height: HEIGHT, viewBox: `0 0 ${full_width} ${HEIGHT}`, role: "group",
    "aria-label": `NSW1 30 分鐘電價與充放電排程${days ? `（${days.map((day) => `${day.name} ${day.date.slice(5).replace("-", "/")}`).join("、")}）` : ""}。${summary.join("；") || "尚未選出充放電時段"}`,
    class: `price-chart${animate ? " fill" : ""}`,
  });

  for (const tick of ticks) {
    chart.append(svg("line", { x1: PAD.left, x2: full_width - PAD.right, y1: y(tick), y2: y(tick), class: tick === 0 ? "axis-zero" : "grid" }));
    chart.append(svg("text", { x: PAD.left - 8, y: y(tick) + 4, "text-anchor": "end", class: "tick" }, tick.toLocaleString("zh-TW")));
  }
  for (const mw of power_mw > 0 ? [-power_mw, 0, power_mw] : [0]) {
    chart.append(svg("text", { x: full_width - PAD.right + 8, y: y_mw(mw) + 4, "text-anchor": "start", class: "tick tick-mw" }, mw > 0 ? `+${mw}` : mw < 0 ? `−${-mw}` : "0"));
  }
  chart.append(svg("text", { x: 4, y: 16, class: "axis-title" }, "AUD/MWh"));
  chart.append(svg("text", { x: full_width - 4, y: 16, "text-anchor": "end", class: "axis-title" }, "MW"));

  if (days) {
    const per_day = model.rows.length / days.length;
    days.forEach((day, index) => {
      if (index > 0) chart.append(svg("line", { x1: edge(index * per_day), x2: edge(index * per_day), y1: PAD.top - 16, y2: HEIGHT - PAD.bottom, class: "day-divider" }));
      chart.append(svg("text", { x: edge(index * per_day + per_day / 2), y: PAD.top - 12, "text-anchor": "middle", class: "day-label" }, `${day.name} ${day.date.slice(5).replace("-", "/")}`));
    });
  }

  for (const cycle of cycles) {
    for (const [kind, leg, sign] of [["charge", cycle.charge, -1], ["discharge", cycle.discharge, 1]]) {
      if (!leg || leg.from < 0 || leg.to < 0 || !(power_mw > 0)) continue;
      for (let index = leg.from; index <= leg.to; index += 1) {
        const top = sign > 0 ? y_mw(power_mw) : y_mw(0);
        chart.append(svg("rect", { x: edge(index) + step * 0.1, y: top, width: step * 0.8, height: Math.abs(y_mw(0) - y_mw(power_mw)), class: `band-${kind}` }));
      }
      chart.append(svg("line", { x1: edge(leg.from), x2: edge(leg.to + 1), y1: y(leg.average), y2: y(leg.average), class: `average-${kind}` }));
    }
  }

  if (model.boundary !== null) chart.append(svg("line", { x1: edge(model.boundary), x2: edge(model.boundary), y1: PAD.top, y2: HEIGHT - PAD.bottom, class: "boundary" }));

  for (const kind of ["actual", "forecast"]) {
    const segments = [];
    let current = [];
    model.rows.forEach((row, index) => {
      if (row[kind] === null) { if (current.length) segments.push(current); current = []; return; }
      current.push(`${x(index).toFixed(1)},${y(row[kind]).toFixed(1)}`);
    });
    if (current.length) segments.push(current);
    for (const points of segments) {
      if (points.length === 1) {
        const [cx, cy] = points[0].split(",");
        chart.append(svg("circle", { cx, cy, r: 2.5, class: `dot-${kind}` }));
      } else chart.append(svg("polyline", { points: points.join(" "), class: `line-${kind}` }));
    }
  }

  // 時間刻度標在時段邊界，顯示該時段的開始時間（00:00、06:00…），兩排分別是 NEM 與台北時間。
  const every = label_every(step);
  chart.append(svg("text", { x: PAD.left - 8, y: HEIGHT - 26, "text-anchor": "end", class: "tick tick-zone" }, "NEM"));
  chart.append(svg("text", { x: PAD.left - 8, y: HEIGHT - 8, "text-anchor": "end", class: "tick tick-zone" }, "台北"));
  for (let index = 0; index < model.rows.length; index += every) {
    const start = slot_span(model, index).start;
    chart.append(svg("text", { x: edge(index), y: HEIGHT - 26, "text-anchor": index === 0 ? "start" : "middle", class: "tick" }, clock(start)));
    chart.append(svg("text", { x: edge(index), y: HEIGHT - 8, "text-anchor": index === 0 ? "start" : "middle", class: "tick tick-taipei" }, clock(start - 2 * 60 * 60 * 1000)));
  }

  // 游標與選取
  const selection = svg("rect", { x: 0, y: PAD.top, width: 0, height: inner_height, class: "selection", visibility: "hidden" });
  const cursor = svg("line", { x1: 0, x2: 0, y1: PAD.top, y2: HEIGHT - PAD.bottom, class: "cursor", visibility: "hidden" });
  chart.append(selection, cursor);
  const stage = html("div", { class: "chart-stage" });
  const tip = html("div", { class: "chart-tip", role: "status", "aria-live": "polite", hidden: "" });
  const state = { anchor: null, dragging: false, range: null };

  const scale = () => {
    const rect = chart.getBoundingClientRect?.();
    return rect && rect.width ? { left: rect.left, width: rect.width, ratio: rect.width / full_width } : { left: 0, width: full_width, ratio: 1 };
  };
  const show_tip = (content, at_x) => {
    const { width: css_width, ratio } = scale();
    const css_x = at_x * ratio;
    const title = html("strong", {}, content.title);
    tip.replaceChildren(title, ...content.lines.map((line) => html("span", {}, line)));
    const side = css_x > css_width / 2 ? `right: ${Math.round(css_width - css_x + 8)}px` : `left: ${Math.round(css_x + 8)}px`;
    tip.setAttribute("style", `top: ${Math.round(PAD.top * ratio + 8)}px; ${side}`);
    tip.removeAttribute("hidden");
  };
  const hide = () => {
    cursor.setAttribute("visibility", "hidden");
    selection.setAttribute("visibility", "hidden");
    tip.setAttribute("hidden", "");
    state.range = null;
  };
  const point = (index) => {
    cursor.setAttribute("x1", x(index));
    cursor.setAttribute("x2", x(index));
    cursor.setAttribute("visibility", "visible");
    if (state.range && state.range.from !== state.range.to) {
      selection.setAttribute("x", edge(state.range.from));
      selection.setAttribute("width", edge(state.range.to + 1) - edge(state.range.from));
      selection.setAttribute("visibility", "visible");
      show_tip(range_summary(model, state.range.from, state.range.to), edge(state.range.to + 1));
    } else {
      selection.setAttribute("visibility", "hidden");
      show_tip(slot_detail(model, index, power_mw, decision, decisions), x(index));
    }
  };
  const index_from = (event) => {
    const { left, ratio } = scale();
    return index_at((event.clientX - left) / ratio, full_width, model.rows.length);
  };
  const extend = (index) => { state.range = { from: Math.min(state.anchor, index), to: Math.max(state.anchor, index) }; };

  chart.addEventListener("pointerdown", (event) => {
    const index = index_from(event);
    state.anchor = index;
    state.dragging = true;
    state.range = { from: index, to: index };
    chart.setPointerCapture?.(event.pointerId);
    point(index);
  });
  chart.addEventListener("pointermove", (event) => {
    const index = index_from(event);
    if (state.dragging) extend(index);
    point(index);
  });
  chart.addEventListener("pointerup", (event) => {
    state.dragging = false;
    if (state.range && state.range.from === state.range.to) state.range = null;
    point(index_from(event));
  });
  chart.addEventListener("pointerleave", () => { if (!state.dragging) hide(); });
  chart.addEventListener("pointercancel", () => { state.dragging = false; hide(); });

  // 鍵盤：方向鍵逐格移動，Shift＋方向鍵選取一段時間
  const hits = [];
  model.rows.forEach((row, index) => {
    const detail = slot_detail(model, index, power_mw, decision, decisions);
    const hit = svg("rect", { x: edge(index), y: PAD.top, width: step, height: inner_height, class: "hit", tabindex: index === 0 ? "0" : "-1", role: "img", "aria-label": [detail.title, ...detail.lines].join(" · ") });
    hit.addEventListener("focus", () => { if (state.anchor === null) state.anchor = index; point(index); });
    hit.addEventListener("blur", () => { if (!state.range) hide(); });
    hit.addEventListener("keydown", (event) => {
      const delta = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: hits.length - 1 - index }[event.key];
      if (event.key === "Escape") { state.anchor = index; hide(); return; }
      if (delta === undefined) return;
      event.preventDefault?.();
      const target = Math.max(0, Math.min(hits.length - 1, index + delta));
      if (event.shiftKey) extend(target);
      else { state.anchor = target; state.range = null; }
      hit.setAttribute("tabindex", "-1");
      hits[target].setAttribute("tabindex", "0");
      hits[target].focus?.();
      point(target);
    });
    hits.push(hit);
    chart.append(hit);
  });
  stage.append(chart, tip);
  container.append(stage);
  const list = html("ul", { class: "leg-summary" });
  for (const text of summary) list.append(html("li", {}, text));
  if (summary.length) container.append(list);
}
