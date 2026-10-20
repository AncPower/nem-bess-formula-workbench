import { test } from "node:test";
import assert from "node:assert/strict";
import { label_every, leg_text, render_dispatch_chart, taipei_label } from "../src/price_chart.js";
import { build_chart_model } from "../src/price_series.js";

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ""; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
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
