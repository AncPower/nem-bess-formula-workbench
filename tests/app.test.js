import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, fingerprint } from "../analysis/build.mjs";

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.textContent = ""; }
  setAttribute(key, value) { this.attributes[key] = value; if (key === "value") this.value = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
const flush = () => new Promise((resolve) => setImmediate(resolve));

 test("實際 app 串接：單循環、每日卡片、調參、分頁、錯誤與還原", async () => {
  const saved = Object.fromEntries(["document", "window", "location", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
    const sample = build({ region_id: "NSW1", start_date: "2026-07-01", end_date: "2026-07-01", sources: [{ url: "https://nemweb.com.au/test" }], prices: Array.from({ length: 288 }, (_, index) => [new Date(Date.parse("2026-07-01") + (index + 1) * 300000).toISOString().slice(0, 16), index < 144 ? 40 : 180]) }, load("formulas/registry.json"), load("formulas/variables.json"), load("config/battery.json"));
    sample.input_fingerprint = await fingerprint();
    const ids = Object.fromEntries(["verdict", "tide-strip", "data-bar", "price-chart", "calc-status", "history-panel", "variable-list", "formula-list", "reset-all"].map((id) => [id, new Node("div")]));
    const links = ["predispatch", "scenario"].map((tab) => { const link = new Node("a"); link.dataset.tab = tab; return link; });
    const events = {};
    globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag), getElementById: (id) => ids[id], querySelectorAll: () => links };
    globalThis.window = { addEventListener: (event, handler) => { events[event] = handler; } };
    globalThis.location = { hash: "#predispatch" };
    globalThis.fetch = async (path) => ({
      ok: true,
      arrayBuffer: async () => { const bytes = readFileSync(new URL(`../${path}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
      json: async () => path.startsWith("https:") ? { "5MIN": [...Array.from({ length: 16 }, (_, index) => ({
        REGIONID: "NSW1", PERIODTYPE: "FORECAST", SETTLEMENTDATE: `2026-10-21T${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00`, RRP: index < 8 ? 40 : 180,
      })), { REGIONID: "NSW1", PERIODTYPE: "ACTUAL", SETTLEMENTDATE: "2026-10-20T23:00:00", RRP: 95 }, { REGIONID: "NSW1", PERIODTYPE: "ACTUAL", SETTLEMENTDATE: "2026-10-20T23:30:00", RRP: 88 }] } : path === "data/daily_summary.json" ? sample : JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")),
    });
    await import("../src/app.js");
    await flush();
    const card = (name) => ids["formula-list"].children.find((node) => descendants(node).some((child) => child.tag === "h3" && child.textContent === name));
    const result = (name) => descendants(card(name)).find((node) => (node.attributes.class ?? "").startsWith("result")).textContent;
    const input = (key) => descendants(ids["variable-list"]).find((node) => node.attributes.id === `var-${key}`);
    assert.equal(result("每日執行淨收益"), "A$ 2,800");
    assert.equal(input("executed_cycle_net_revenue").attributes.disabled, "");
    const chart = descendants(ids["price-chart"]);
    for (const kind of ["line-actual", "line-forecast", "band-charge", "band-discharge", "boundary"]) assert.ok(chart.some((node) => node.attributes.class === kind), `曲線圖缺少 ${kind}`);
    assert.ok(chart.some((node) => node.textContent === "放電（執行） A$ 180"));
    const verdict = () => descendants(ids.verdict);
    assert.equal(verdict().find((node) => (node.attributes.class ?? "").startsWith("verdict-word")).textContent, "執行", "結論列首屏先講答案");
    assert.ok(verdict().some((node) => node.attributes.class === "verdict-why" && /^價差 140 ≥ 標準 0 AUD\/MWh · 每循環淨收益 A\$ 2,800 · 當日執行淨收益 A\$ 2,800/.test(node.textContent)));
    const cells = () => descendants(ids["tide-strip"]).filter((node) => /^tide-cell /.test(node.attributes.class ?? ""));
    assert.equal(cells().length, 18, "每個 30 分鐘時段一格（2 個實際＋16 個預調度）");
    assert.equal(cells().filter((node) => node.attributes.class.includes("is-charge")).length, 8);
    assert.equal(cells().filter((node) => node.attributes.class.includes("is-discharge")).length, 8);
    assert.match(cells().find((node) => node.attributes.class.includes("is-discharge")).attributes["aria-label"], /^NEM 04:00（台北 02:00）· 預調度 180 AUD\/MWh · 放電（執行）$/);
    assert.ok(descendants(ids["variable-list"]).some((node) => node.attributes.class === "hint" && node.textContent.startsWith("價差至少要多少")), "白話說明常駐在欄位下方");
    assert.ok(descendants(ids["data-bar"]).some((node) => /實際 2 個、預調度 16 個.*充電 00:00 到 03:30、放電 04:00 到 07:30/.test(node.textContent)));
    assert.equal(descendants(card("價差")).find((node) => node.attributes.class === "plain-formula").textContent, "放電段均價 − 充電段均價");
    const chip = descendants(card("價差")).find((node) => node.attributes.class === "chip" && descendants(node).some((child) => child.tag === "code" && child.textContent === "discharge_price"));
    assert.ok(chip, "代號對照要列出式子用到的代號");
    assert.deepEqual(descendants(chip).slice(1).map((node) => node.textContent), ["放電段均價", "discharge_price", "＝180"]);
    input("spread_standard").value = "141"; input("spread_standard").listeners.input();
    assert.equal(ids["calc-status"].textContent, "計算中…");
    assert.equal(result("執行或等待"), "執行", "預覽延遲期間不重算");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(result("執行或等待"), "等待");
    assert.match(ids["calc-status"].textContent, /^已更新/);
    assert.ok(input("spread_standard"), "即時預覽不重建輸入欄");
    assert.ok(descendants(ids["price-chart"]).some((node) => node.textContent === "放電（等待） A$ 180"));
    assert.equal(verdict().find((node) => (node.attributes.class ?? "").startsWith("verdict-word")).textContent, "等待");
    assert.equal(ids["tide-strip"].attributes.class, "tide tide-fill", "結論改變時色帶播放填滿動態");
    ids["reset-all"].listeners.click();
    const daily_expression = descendants(card("每日執行淨收益")).find((node) => node.tag === "textarea");
    daily_expression.value = "executed_cycle_net_revenue - daily_fee"; daily_expression.listeners.change();
    assert.ok(input("daily_fee"), "每日式子新增的變數也必須有輸入欄");
    input("daily_fee").value = "100"; input("daily_fee").listeners.change();
    assert.equal(result("每日執行淨收益"), "A$ 2,700");
    ids["reset-all"].listeners.click();
    input("spread_standard").value = "141";
    input("spread_standard").listeners.change();
    assert.equal(result("執行或等待"), "等待");
    assert.equal(result("每日執行淨收益"), "A$ 0");
    location.hash = "#scenario"; events.hashchange();
    assert.equal(ids["price-chart"].attributes.hidden, "");
    assert.equal(ids["tide-strip"].children.length, 0, "情境評估不顯示色帶");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(descendants(ids["history-panel"]).some((node) => node.textContent === "試算：維持"));
    descendants(ids["history-panel"]).find((node) => node.attributes["aria-label"] === "試算標準 AUD/MWh").value = "141";
    descendants(ids["history-panel"]).find((node) => node.textContent === "重新試算").listeners.click();
    assert.ok(descendants(ids["history-panel"]).some((node) => node.textContent === "試算：建議下調"));
    descendants(ids["history-panel"]).find((node) => node.attributes["aria-label"] === "試算標準 AUD/MWh").value = "0";
    descendants(ids["history-panel"]).find((node) => node.textContent === "重新試算").listeners.click();
    assert.ok(descendants(ids["history-panel"]).some((node) => node.textContent === "試算：維持"));
    assert.equal(card("每日執行淨收益"), undefined);
    assert.equal(input("daily_revenue").value, "2651");
    input("daily_revenue").value = "100"; input("daily_revenue").listeners.change();
    assert.equal(result("目標期間收益"), "A$ 8,550");
    location.hash = "#predispatch"; events.hashchange();
    assert.equal(ids["history-panel"].attributes.hidden, "");
    const expression = descendants(card("價差")).find((node) => node.tag === "textarea");
    expression.value = "("; expression.listeners.change();
    assert.match(result("每日執行淨收益"), /無法彙總/);
    ids["reset-all"].listeners.click();
    assert.equal(result("每日執行淨收益"), "A$ 2,800");
    location.hash = "#scenario"; events.hashchange();
    assert.equal(input("daily_revenue").value, "2651");
    assert.equal(links[1].attributes["aria-current"], "page");
    await flush();
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
