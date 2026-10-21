import { test } from "node:test";
import assert from "node:assert/strict";
import { index_at, label_every, leg_text, range_summary, render_dispatch_chart, slot_detail, span_label, taipei_label } from "../src/price_chart.js";
import { build_chart_model, three_day_window } from "../src/price_series.js";

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.textContent = ""; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];

test("台北時間＝市場時間 − 2 小時，跨午夜要繞回", () => {
  assert.equal(taipei_label("14:30"), "12:30");
  assert.equal(taipei_label("00:00"), "22:00");
  assert.equal(taipei_label("01:30"), "23:30");
});

test("時間刻度依寬度抽稀，只取整點好讀的間隔", () => {
  assert.equal(label_every(100), 1);
  assert.equal(label_every(30), 3);
  assert.equal(label_every(10), 12);
});

test("窄螢幕（360px）時間刻度不重疊，兩個 y 軸都在；摘要放在圖外可換行", () => {
  const saved = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
  try {
    const forecast = Array.from({ length: 48 }, (_, index) => ({ settlement_date: `2026-10-21T${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00`, price: index % 24 < 12 ? 40 : 180 }));
    const cycle = { charge_start: forecast[4].settlement_date, discharge_start: forecast[16].settlement_date, periods_per_leg: 8, charge_average_price: 40, discharge_average_price: 180 };
    for (const width of [360, 768, 1366]) {
      const container = new Node("div");
      render_dispatch_chart(container, build_chart_model({ actual: [], forecast }, cycle), { decision: "執行", power_mw: 5, width });
      const nodes = descendants(container);
      for (const row of ["tick", "tick tick-taipei"]) {
        const xs = nodes.filter((node) => node.tag === "text" && node.attributes.class === row && /^\d\d:\d\d$/.test(node.textContent)).map((node) => Number(node.attributes.x));
        assert.ok(xs.length >= 2, `${width}px 至少兩個刻度`);
        assert.ok(xs.every((x, index) => index === 0 || x - xs[index - 1] >= 64), `${width}px 刻度相隔不足`);
      }
      assert.equal(nodes.find((node) => node.tag === "svg").attributes.width, String(width), "依容器實際寬度繪製，不縮放字級");
      assert.ok(nodes.some((node) => node.textContent === "−5") && nodes.some((node) => node.textContent === "+5"), "右軸功率刻度");
      assert.equal(nodes.filter((node) => node.tag === "li").length, 2);
    }
  } finally {
    globalThis.document = saved;
  }
});

test("充放電摘要", () => {
  const leg = { first: "2026-10-21T00:30:00", last: "2026-10-21T04:00:00", average: 41.6 };
  assert.equal(leg_text("charge", leg, 5, "執行"), "充電 00:30–04:00（台北 22:30–02:00）· 均價 A$ 42/MWh · −5 MW");
  assert.equal(leg_text("discharge", leg, 5, "等待"), "放電 00:30–04:00（台北 22:30–02:00）· 均價 A$ 42/MWh · +5 MW · 等待");
  assert.equal(leg_text("charge", null, 5), null);
});

const day_slots = (date, price_of) => Array.from({ length: 48 }, (_, index) => {
  const end = Date.parse(`${date}T00:00:00Z`) + (index + 1) * 30 * 60 * 1000;
  return { settlement_date: new Date(end).toISOString().slice(0, 19), price: price_of(index) };
});

test("三天等距時間軸：昨天、今天、明天各 48 格；今天取第一個預調度時段所屬交易日", () => {
  const window = three_day_window({ actual: day_slots("2026-10-20", () => 50), forecast: day_slots("2026-10-21", () => 80).slice(20) });
  assert.deepEqual(window.days.map((day) => `${day.name} ${day.date}`), ["昨天 2026-10-20", "今天 2026-10-21", "明天 2026-10-22"]);
  assert.equal(window.times.length, 144);
  assert.equal(window.times[0], "2026-10-20T00:30:00");
  assert.equal(window.times[47], "2026-10-21T00:00:00", "00:00 標記屬於前一個交易日");
  assert.equal(window.times[143], "2026-10-23T00:00:00");
  assert.equal(three_day_window({ actual: [], forecast: [] }), null);
});

test("滑過顯示時間與電價；拖曳選取一段時間顯示均價", () => {
  const saved = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
  try {
    const actual = day_slots("2026-10-20", (index) => index < 24 ? 40 : 100);
    const forecast = [...day_slots("2026-10-21", (index) => 60 + index), ...day_slots("2026-10-22", () => 90)];
    const series = { actual, forecast };
    const timeline = three_day_window(series);
    const model = build_chart_model(series, null, timeline.times);
    const container = new Node("div");
    render_dispatch_chart(container, model, { power_mw: 5, width: 1000, days: timeline.days });
    const nodes = descendants(container);
    assert.deepEqual(nodes.filter((node) => node.attributes.class === "day-label").map((node) => node.textContent), ["昨天 10/20", "今天 10/21", "明天 10/22"]);
    assert.equal(nodes.filter((node) => node.attributes.class === "day-divider").length, 2, "三天之間兩條分隔線");
    const chart = nodes.find((node) => node.tag === "svg");
    const tip = nodes.find((node) => node.attributes.class === "chart-tip");
    const cursor = nodes.find((node) => node.attributes.class === "cursor");
    const selection = nodes.find((node) => node.attributes.class === "selection");
    const step = (1000 - 56 - 52) / 144;
    const at = (index) => ({ clientX: 56 + step * (index + 0.5), pointerId: 1 });

    chart.listeners.pointermove(at(50));
    assert.equal(cursor.attributes.visibility, "visible", "滑過時出現垂直線");
    assert.equal(tip.attributes.hidden, undefined);
    assert.deepEqual(descendants(tip).slice(1).map((node) => node.textContent), ["NEM 10/21 01:00–01:30（台北 10/20 23:00–23:30）", "實際：無資料", "預調度 A$ 62/MWh", "不動作"]);

    chart.listeners.pointerdown(at(0));
    chart.listeners.pointermove(at(47));
    chart.listeners.pointerup(at(47));
    assert.equal(selection.attributes.visibility, "visible", "拖曳後出現暫時選取框");
    assert.deepEqual(descendants(tip).slice(1).map((node) => node.textContent), ["NEM 10/20 00:00–10/21 00:00（台北 10/19 22:00–10/20 22:00）· 48 個時段（24 小時）", "實際均價 A$ 70/MWh（48 個時段）", "預調度：無資料"]);
    chart.listeners.pointerleave();
    assert.equal(tip.attributes.hidden, "", "離開圖表時框框消失");
    assert.equal(selection.attributes.visibility, "hidden");

    chart.listeners.pointerdown(at(10));
    chart.listeners.pointerup(at(10));
    assert.equal(selection.attributes.visibility, "hidden", "單點不算選取");
  } finally {
    globalThis.document = saved;
  }
});

test("時段說明、區間均價與座標換算", () => {
  const rows = [
    { time: "2026-10-21T00:30:00", actual: 10, forecast: null },
    { time: "2026-10-21T01:00:00", actual: 30, forecast: 50 },
    { time: "2026-10-21T01:30:00", actual: null, forecast: 70 },
  ];
  const model = { rows, charge: { from: 1, to: 1 }, discharge: { from: 2, to: 2 } };
  assert.deepEqual(slot_detail(model, 1, 5, "執行").lines, ["實際 A$ 30/MWh", "預調度 A$ 50/MWh", "充電 −5 MW"]);
  assert.equal(slot_detail(model, 2, 5, "等待").lines[2], "放電 +5 MW（等待）");
  assert.deepEqual(range_summary(model, 2, 0).lines, ["實際均價 A$ 20/MWh（2 個時段）", "預調度均價 A$ 60/MWh（2 個時段）"]);
  assert.match(range_summary(model, 0, 2).title, /3 個時段（1.5 小時）$/);
  assert.equal(span_label(Date.parse("2026-10-21T23:30:00Z"), Date.parse("2026-10-22T00:00:00Z")), "10/21 23:30–10/22 00:00（台北 10/21 21:30–22:00）");
  assert.equal(index_at(0, 1000, 144), 0);
  assert.equal(index_at(5000, 1000, 144), 143);
});
