/**
 * 招牌時刻：48 格潮汐色帶。每格一個 30 分鐘時段，高度依當日電價分成 5 級，
 * 建議充電／放電的時段填色；上下兩排刻度分別是 NEM 市場時間與台北時間（市場時間 − 2 小時）。
 * 只用 DOM 節點，不用 canvas 或圖表套件；時間沿用 AEMO SETTLEMENTDATE（時段結束時間）。
 */

import { time_label } from "./price_series.js";

const LEVELS = 5;
const TICK_EVERY = 6;

/** 「14:30」→ 台北時間「12:30」。 */
export function taipei_label(market_time) {
  const match = /^(\d\d):(\d\d)$/.exec(market_time);
  if (!match) return market_time;
  const hour = (Number(match[1]) + 22) % 24;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/** 依電價在這條時間軸上的排名分 1 到 5 級；沒有電價的時段為 0。 */
export function price_levels(prices) {
  const known = prices.filter((price) => price !== null).sort((a, b) => a - b);
  return prices.map((price) => {
    if (price === null) return 0;
    if (known.length === 1) return 3;
    const rank = known.indexOf(price) / (known.length - 1);
    return Math.min(LEVELS, 1 + Math.floor(rank * LEVELS));
  });
}

/** 每一格的資料：時段、電價、級距、屬於充電段、放電段或都不是。 */
export function tide_cells(model) {
  const prices = model.rows.map((row) => row.forecast ?? row.actual);
  const levels = price_levels(prices);
  const inside = (leg, index) => leg && leg.from >= 0 && index >= leg.from && index <= leg.to;
  return model.rows.map((row, index) => ({
    time: time_label(row.time),
    price: prices[index],
    level: levels[index],
    leg: inside(model.charge, index) ? "charge" : inside(model.discharge, index) ? "discharge" : null,
    kind: row.forecast !== null ? "forecast" : "actual",
  }));
}

/**
 * @param {HTMLElement} container
 * @param {ReturnType<import("./price_series.js").build_chart_model>} model
 * @param {{decision: string|null, animate: boolean}} options
 */
export function render_tide_strip(container, model, { decision = null, animate = false } = {}) {
  const cells = tide_cells(model);
  container.replaceChildren();
  container.setAttribute("class", `tide${animate ? " tide-fill" : ""}`);
  if (cells.length === 0) return cells;
  const columns = `repeat(${cells.length}, minmax(0, 1fr))`;
  const ticks = (name, label_of) => {
    const row = document.createElement("div");
    row.setAttribute("class", "tide-ticks");
    row.setAttribute("aria-hidden", "true");
    row.setAttribute("style", `grid-template-columns: 3.5rem ${columns}`);
    const head = document.createElement("span");
    head.setAttribute("class", "tide-zone");
    head.textContent = name;
    row.append(head);
    cells.forEach((cell, index) => {
      const tick = document.createElement("span");
      if (index % TICK_EVERY === 0) tick.textContent = label_of(cell.time);
      row.append(tick);
    });
    return row;
  };
  const strip = document.createElement("div");
  strip.setAttribute("class", "tide-cells");
  strip.setAttribute("role", "list");
  strip.setAttribute("aria-label", "30 分鐘時段色帶，用方向鍵逐格查看");
  strip.setAttribute("style", `grid-template-columns: 3.5rem ${columns}`);
  const spacer = document.createElement("span");
  spacer.setAttribute("aria-hidden", "true");
  strip.append(spacer);
  const items = cells.map((cell, index) => {
    const item = document.createElement("span");
    const leg = cell.leg ? ` is-${cell.leg}` : "";
    item.setAttribute("class", `tide-cell level-${cell.level}${leg}${cell.kind === "actual" ? " is-actual" : ""}`);
    item.setAttribute("role", "listitem");
    item.setAttribute("tabindex", index === 0 ? "0" : "-1");
    const action = cell.leg === "charge" ? "充電" : cell.leg === "discharge" ? `放電${decision ? `（${decision}）` : ""}` : "不動作";
    const price = cell.price === null ? "無電價" : `${Math.round(cell.price).toLocaleString("zh-TW")} AUD/MWh`;
    item.setAttribute("aria-label", `NEM ${cell.time}（台北 ${taipei_label(cell.time)}）· ${cell.kind === "actual" ? "實際" : "預調度"} ${price} · ${action}`);
    item.setAttribute("title", `NEM ${cell.time}（台北 ${taipei_label(cell.time)}）· ${price} · ${action}`);
    item.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? -index : event.key === "End" ? items.length - 1 - index : 0;
      if (step === 0) return;
      event.preventDefault?.();
      const next = items[Math.max(0, Math.min(items.length - 1, index + step))];
      item.setAttribute("tabindex", "-1");
      next.setAttribute("tabindex", "0");
      next.focus?.();
    });
    strip.append(item);
    return item;
  });
  container.append(ticks("NEM", (time) => time), strip, ticks("台北", taipei_label));
  return cells;
}
