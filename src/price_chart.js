/**
 * 電價與充放電排程圖（SVG）：共用一條時間軸（x），左 y 軸是電價（AUD/MWh），右 y 軸是電池功率（MW，放電為正、充電為負）。
 * 實際電價實線、預調度電價虛線、充放電功率長條、實際與預調度分界線；時間刻度上下兩排是 NEM 市場時間與台北時間。
 * 依容器實際寬度繪製（不縮放字級），刻度間距不足時自動抽稀，避免文字重疊。只用 DOM API，不載入圖表套件。
 */

import { date_time_label, time_label } from "./price_series.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HEIGHT = 280;
const PAD = { top: 28, right: 52, bottom: 48, left: 56 };
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

const money = (value) => `A$ ${Math.round(value).toLocaleString("zh-TW")}`;

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

/** 充電段或放電段的一行摘要，放在圖下方（HTML，可自動換行，不會疊字）。 */
export function leg_text(kind, leg, power_mw, decision) {
  if (!leg) return null;
  const range = `${time_label(leg.first)}–${time_label(leg.last)}`;
  const taipei = `${taipei_label(time_label(leg.first))}–${taipei_label(time_label(leg.last))}`;
  const power = kind === "charge" ? `−${power_mw} MW` : `+${power_mw} MW`;
  const name = kind === "charge" ? "充電" : "放電";
  return `${name} ${range}（台北 ${taipei}）· 均價 ${money(leg.average)}/MWh · ${power}${kind === "discharge" && decision ? ` · ${decision}` : ""}`;
}

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import("./price_series.js").build_chart_model>} model
 * @param {{decision?: string|null, power_mw?: number, animate?: boolean, width?: number}} options
 */
export function render_dispatch_chart(container, model, { decision = null, power_mw = 0, animate = false, width } = {}) {
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

  const ticks = nice_ticks(model.min, model.max);
  const low = Math.min(ticks[0], model.min);
  const high = Math.max(ticks.at(-1), model.max);
  const y = (price) => PAD.top + (high === low ? inner_height / 2 : ((high - price) / (high - low)) * inner_height);
  const mw_limit = Math.max(power_mw, 1) * 1.25;
  const y_mw = (mw) => PAD.top + ((mw_limit - mw) / (2 * mw_limit)) * inner_height;

  const summary = [leg_text("charge", model.charge, power_mw, decision), leg_text("discharge", model.discharge, power_mw, decision)].filter(Boolean);
  const chart = svg("svg", {
    width: full_width, height: HEIGHT, viewBox: `0 0 ${full_width} ${HEIGHT}`, role: "group",
    "aria-label": `NSW1 30 分鐘電價與充放電排程。${summary.join("；") || "尚未選出充放電時段"}`,
    class: `price-chart${animate ? " fill" : ""}`,
  });

  for (const tick of ticks) {
    chart.append(svg("line", { x1: PAD.left, x2: full_width - PAD.right, y1: y(tick), y2: y(tick), class: tick === 0 ? "axis-zero" : "grid" }));
    chart.append(svg("text", { x: PAD.left - 8, y: y(tick) + 4, "text-anchor": "end", class: "tick" }, tick.toLocaleString("zh-TW")));
  }
  for (const mw of power_mw > 0 ? [-power_mw, 0, power_mw] : [0]) {
    chart.append(svg("text", { x: full_width - PAD.right + 8, y: y_mw(mw) + 4, "text-anchor": "start", class: "tick tick-mw" }, mw > 0 ? `+${mw}` : mw < 0 ? `−${-mw}` : "0"));
  }
  chart.append(svg("text", { x: 4, y: 14, class: "axis-title" }, "AUD/MWh"));
  chart.append(svg("text", { x: full_width - 4, y: 14, "text-anchor": "end", class: "axis-title" }, "MW"));

  for (const [kind, leg, sign] of [["charge", model.charge, -1], ["discharge", model.discharge, 1]]) {
    if (!leg || leg.from < 0 || leg.to < 0 || !(power_mw > 0)) continue;
    for (let index = leg.from; index <= leg.to; index += 1) {
      const top = sign > 0 ? y_mw(power_mw) : y_mw(0);
      chart.append(svg("rect", { x: PAD.left + index * step + step * 0.1, y: top, width: step * 0.8, height: Math.abs(y_mw(0) - y_mw(power_mw)), class: `band-${kind}` }));
    }
    const left = PAD.left + leg.from * step;
    chart.append(svg("line", { x1: left, x2: left + (leg.to - leg.from + 1) * step, y1: y(leg.average), y2: y(leg.average), class: `average-${kind}` }));
  }

  if (model.boundary !== null) {
    const boundary_x = PAD.left + model.boundary * step;
    chart.append(svg("line", { x1: boundary_x, x2: boundary_x, y1: PAD.top, y2: HEIGHT - PAD.bottom, class: "boundary" }));
    chart.append(svg("text", { x: boundary_x + 4, y: PAD.top + 12, class: "boundary-label" }, "預調度 →"));
  }

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

  const every = label_every(step);
  chart.append(svg("text", { x: PAD.left - 8, y: HEIGHT - 26, "text-anchor": "end", class: "tick tick-zone" }, "NEM"));
  chart.append(svg("text", { x: PAD.left - 8, y: HEIGHT - 8, "text-anchor": "end", class: "tick tick-zone" }, "台北"));
  const hits = [];
  model.rows.forEach((row, index) => {
    const time = time_label(row.time);
    if (index % every === 0) {
      chart.append(svg("text", { x: x(index), y: HEIGHT - 26, "text-anchor": "middle", class: "tick" }, time));
      chart.append(svg("text", { x: x(index), y: HEIGHT - 8, "text-anchor": "middle", class: "tick tick-taipei" }, taipei_label(time)));
    }
    const inside = (leg) => leg && index >= leg.from && index <= leg.to;
    const action = inside(model.charge) ? `充電 −${power_mw} MW` : inside(model.discharge) ? `放電 +${power_mw} MW${decision ? `（${decision}）` : ""}` : "不動作";
    const parts = [`NEM ${date_time_label(row.time)}（台北 ${taipei_label(time)}）`];
    if (row.actual !== null) parts.push(`實際 ${money(row.actual)}/MWh`);
    if (row.forecast !== null) parts.push(`預調度 ${money(row.forecast)}/MWh`);
    parts.push(action);
    const hit = svg("rect", { x: PAD.left + index * step, y: PAD.top, width: step, height: inner_height, class: "hit", tabindex: index === 0 ? "0" : "-1", role: "img", "aria-label": parts.join(" · ") });
    hit.append(svg("title", {}, parts.join(" · ")));
    hit.addEventListener("keydown", (event) => {
      const delta = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: hits.length - 1 - index }[event.key];
      if (delta === undefined) return;
      event.preventDefault?.();
      const next = hits[Math.max(0, Math.min(hits.length - 1, index + delta))];
      hit.setAttribute("tabindex", "-1");
      next.setAttribute("tabindex", "0");
      next.focus?.();
    });
    hits.push(hit);
    chart.append(hit);
  });
  container.append(chart);
  const list = html("ul", { class: "leg-summary" });
  for (const text of summary) list.append(html("li", {}, text));
  if (summary.length) container.append(list);
}
