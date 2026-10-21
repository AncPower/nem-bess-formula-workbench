import { test } from "node:test";
import assert from "node:assert/strict";
import { parse_price_series, build_chart_model } from "../src/price_series.js";
import { range_summary, render_dispatch_chart } from "../src/price_chart.js";
import { data_time, data_trust } from "../src/data_trust.js";
import { money, price_input } from "../src/format.js";

const row = (time, price) => ({ REGIONID: "NSW1", PERIODTYPE: "ACTUAL", SETTLEMENTDATE: time, RRP: price });
const stamp = (minute) => new Date(Date.parse("2026-10-20T23:30:00Z") + minute * 60000).toISOString().slice(0, 19);
const payload = (rows) => ({ "5MIN": rows });
const six = () => [5, 10, 15, 20, 25, 30].map((minute, i) => row(stamp(minute), 10 * (i + 1)));

test("實際六筆按時段結束時間聚合，跨午夜、亂序與拖曳均價一致", () => {
  const series = parse_price_series(payload(six().reverse()));
  assert.deepEqual(series.actual, [{ settlement_date: stamp(30), price: 35 }]);
  assert.deepEqual(series.actual_source, { count: 6, first: stamp(5), last: stamp(30) });
  const model = build_chart_model(series, null, [stamp(0), stamp(30)]);
  assert.equal(model.rows[0].actual, null);
  assert.equal(model.rows[1].actual, 35);
  assert.match(range_summary(model, 0, 1).lines[0], /A\$ 35\/MWh（1 個時段）/);
});

test("缺筆與不完整尾端不當作完整時段；T8 仍看最新原始時間", () => {
  const rows = [...six(), row(stamp(35), 999), row(stamp(40), 1000)];
  const series = parse_price_series(payload(rows));
  assert.equal(series.actual.length, 1);
  assert.equal(data_time(series), Date.parse(`${stamp(40)}+10:00`));
  const now = Date.parse(`${stamp(40)}+10:00`) + 35 * 60000;
  assert.equal(data_trust({ status: { cycle: {} }, series, now }).kind, "live");
  const partial = parse_price_series(payload(six().filter((_, i) => i !== 2)));
  assert.equal(partial.actual.length, 0);
  assert.equal(data_time(partial), Date.parse(`${stamp(30)}+10:00`));
  assert.equal(parse_price_series(payload([row(stamp(0), 1)])).actual.length, 0);
});

test("重複時段不算第六筆；衝突重複或未對齊時間明確報錯", () => {
  const points = six();
  assert.equal(parse_price_series(payload([...points, points[0]])).actual[0].price, 35);
  assert.equal(parse_price_series(payload([...points.slice(1), points[1]])).actual.length, 0);
  assert.throws(() => parse_price_series(payload([...points, row(stamp(5), 999)])), /重複/);
  assert.throws(() => parse_price_series(payload([row(stamp(1), 10)])), /5 分鐘/);
  assert.throws(() => parse_price_series(payload([row("invalid", 10)])), /時間/);
  assert.throws(() => parse_price_series(payload([row("2026-02-30T00:00:00", 10)])), /時間/);
});

test("288 筆連續 5 分鐘資料產生 48 個半小時均價；兩端不完整時不硬湊", () => {
  const rows = Array.from({ length: 288 }, (_, i) => row(stamp(5 * (i + 1)), i % 6));
  const series = parse_price_series(payload(rows));
  assert.equal(series.actual.length, 48);
  assert.ok(series.actual.every((point) => point.price === 2.5));
  assert.equal(parse_price_series(payload(rows.slice(1, -1))).actual.length, 46);
});

test("提示框上緣低於日期列，不隨左右切換回到頂端", () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
    setAttribute(k, v) { this.attributes[k] = v; }
    removeAttribute(k) { delete this.attributes[k]; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
  }
  const descendants = (node) => [node, ...node.children.flatMap(descendants)];
  const saved = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
  try {
    for (const width of [360, 768, 1366]) {
      const container = new Node("div");
      const model = build_chart_model({ actual: [30, 60, 90, 120].map((minute) => ({ settlement_date: stamp(minute), price: 35 })), forecast: [] }, null);
      render_dispatch_chart(container, model, { width, days: [{ name: "今天", date: "2026-10-21" }] });
      const nodes = descendants(container);
      const chart = nodes.find((node) => node.tag === "svg");
      const tip = nodes.find((node) => node.attributes.class === "chart-tip");
      const date = nodes.find((node) => node.attributes.class === "day-label");
      for (const ratio of [1, 0.5]) {
        chart.getBoundingClientRect = () => ({ left: 0, width: width * ratio });
        for (const x of [width * ratio * 0.2, width * ratio * 0.8]) {
          chart.listeners.pointermove({ clientX: x });
          const top = Number(/top: (\d+)px/.exec(tip.attributes.style)?.[1]);
          assert.ok(top >= 40 * ratio, "左右兩側提示框都低於繪圖區頂端");
          assert.ok(top > Number(date.attributes.y) * ratio, "不蓋住日期列");
          assert.match(tip.attributes.style, x < width * ratio / 2 ? /left:/ : /right:/);
        }
      }
    }
  } finally { globalThis.document = saved; }
});

test("金額共用千分位格式，價格顯示兩位但不改原值", () => {
  assert.equal(money(240061.91, { digits: 2 }), "A$ 240,061.91");
  assert.equal(money(240061.91), "A$ 240,062");
  assert.equal(money(-1234.56, { digits: 2, symbol: false }), "-1,234.56");
  const original = 117.7481874;
  assert.equal(price_input(original), "117.75");
  assert.equal(original, 117.7481874);
});
