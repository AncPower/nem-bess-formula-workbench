/**
 * 電價曲線圖（SVG）：實際電價實線、預調度電價虛線、建議充電段與放電段色帶、實際與預測分界線。
 * 只用 DOM API 產生節點，不載入圖表套件。
 */

import { date_time_label, time_label } from "./price_series.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 1240;
const HEIGHT = 250;
const PAD = { top: 34, right: 16, bottom: 30, left: 56 };

const svg = (tag, attributes = {}, text) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
};

const money = (value) => `A$ ${Math.round(value).toLocaleString("zh-TW")}`;

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

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import("./price_series.js").build_chart_model>} model
 * @param {{decision: string|null}} options decision：「執行」「等待」或 null
 */
export function render_price_chart(container, model, { decision = null } = {}) {
  container.replaceChildren();
  const legend = document.createElement("div");
  legend.setAttribute("class", "chart-legend");
  for (const [kind, text] of [["actual", "實際電價"], ["forecast", "預調度電價"], ["charge", "建議充電時段"], ["discharge", "建議放電時段"]]) {
    const item = document.createElement("span");
    item.setAttribute("class", `legend-${kind}`);
    item.textContent = text;
    legend.append(item);
  }
  container.append(legend);
  if (model.rows.length === 0) return;

  const ticks = nice_ticks(model.min, model.max);
  const low = Math.min(ticks[0], model.min);
  const high = Math.max(ticks.at(-1), model.max);
  const inner_width = WIDTH - PAD.left - PAD.right;
  const inner_height = HEIGHT - PAD.top - PAD.bottom;
  const step = inner_width / model.rows.length;
  const x = (index) => PAD.left + index * step + step / 2;
  const y = (price) => PAD.top + (high === low ? inner_height / 2 : ((high - price) / (high - low)) * inner_height);

  const summary = [
    model.charge ? `建議充電 ${time_label(model.charge.first)} 到 ${time_label(model.charge.last)}，均價 ${money(model.charge.average)}` : "尚未選出充電時段",
    model.discharge ? `建議放電 ${time_label(model.discharge.first)} 到 ${time_label(model.discharge.last)}，均價 ${money(model.discharge.average)}` : "尚未選出放電時段",
  ].join("；");
  const chart = svg("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: "img", "aria-label": `NSW1 30 分鐘電價曲線。${summary}`, class: "price-chart" });

  for (const tick of ticks) {
    chart.append(svg("line", { x1: PAD.left, x2: WIDTH - PAD.right, y1: y(tick), y2: y(tick), class: tick === 0 ? "axis-zero" : "grid" }));
    chart.append(svg("text", { x: PAD.left - 8, y: y(tick) + 4, "text-anchor": "end", class: "tick" }, tick.toLocaleString("zh-TW")));
  }

  for (const [kind, leg] of [["charge", model.charge], ["discharge", model.discharge]]) {
    if (!leg || leg.from < 0 || leg.to < 0) continue;
    const left = PAD.left + leg.from * step;
    const width = (leg.to - leg.from + 1) * step;
    chart.append(svg("rect", { x: left, y: PAD.top, width, height: inner_height, class: `band-${kind}` }));
    chart.append(svg("line", { x1: left, x2: left + width, y1: y(leg.average), y2: y(leg.average), class: `average-${kind}` }));
    const label = `${kind === "charge" ? "充電" : `放電${decision ? `（${decision}）` : ""}`} ${money(leg.average)}`;
    chart.append(svg("text", { x: left + width / 2, y: PAD.top - 10, "text-anchor": "middle", class: `band-label-${kind}` }, label));
  }

  if (model.boundary !== null) {
    const boundary_x = PAD.left + model.boundary * step;
    chart.append(svg("line", { x1: boundary_x, x2: boundary_x, y1: PAD.top, y2: HEIGHT - PAD.bottom, class: "boundary" }));
    chart.append(svg("text", { x: boundary_x + 4, y: HEIGHT - PAD.bottom - 6, class: "boundary-label" }, "← 實際｜預調度 →"));
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

  const label_every = Math.max(1, Math.ceil(model.rows.length / 12));
  model.rows.forEach((row, index) => {
    if (index % label_every === 0) chart.append(svg("text", { x: x(index), y: HEIGHT - 10, "text-anchor": "middle", class: "tick" }, time_label(row.time)));
    const hit = svg("rect", { x: PAD.left + index * step, y: PAD.top, width: step, height: inner_height, class: "hit" });
    const parts = [date_time_label(row.time)];
    if (row.actual !== null) parts.push(`實際 ${money(row.actual)}/MWh`);
    if (row.forecast !== null) parts.push(`預調度 ${money(row.forecast)}/MWh`);
    hit.append(svg("title", {}, parts.join("｜")));
    chart.append(hit);
  });
  chart.append(svg("text", { x: 4, y: 14, class: "tick" }, "AUD/MWh"));
  container.append(chart);
}
