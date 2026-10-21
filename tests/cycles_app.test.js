import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.dataset = {}; this.textContent = ""; }
  setAttribute(key, value) { this.attributes[key] = value; if (key === "value") this.value = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const IDS = ["page-title", "page-lede", "verdict", "chart-section", "data-bar", "price-chart", "calc-status", "history-panel", "formula-list", "reset-all", "compare-body", "share-output", "share-settings"];
// 48 個預調度時段（每段 8 個時段）：40 → 180、30 → 200 兩組低谷高峰，其後持平 100。
// 最佳單循環是 30 → 200（價差 170）；兩個循環是 40 → 180 加 30 → 200（價差 140 + 170）。
const price_at = (index) => (index < 8 ? 40 : index < 16 ? 180 : index < 24 ? 30 : index < 32 ? 200 : 100);
const PRICES = { "5MIN": [
  ...Array.from({ length: 48 }, (_, index) => ({ REGIONID: "NSW1", PERIODTYPE: "FORECAST", SETTLEMENTDATE: new Date(Date.parse("2026-10-21T00:00:00Z") + index * 1800000).toISOString().slice(0, 19), RRP: price_at(index) })),
  ...Array.from({ length: 12 }, (_, i) => ({ REGIONID: "NSW1", PERIODTYPE: "ACTUAL", SETTLEMENTDATE: new Date(Date.parse("2026-10-20T22:35:00Z") + i * 300000).toISOString().slice(0, 19), RRP: 90 })),
] };

async function open_page({ search = "", instance }) {
  const ids = Object.fromEntries(IDS.map((id) => [id, new Node("div")]));
  const copied = [];
  globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag), getElementById: (id) => ids[id], querySelectorAll: () => [] };
  globalThis.window = { addEventListener: () => {}, history: { replaceState: () => {} } };
  globalThis.location = { hash: "#predispatch", search, origin: "https://ancpower.github.io", pathname: "/nem-bess-formula-workbench/" };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text) => { copied.push(text); } } }, configurable: true, writable: true });
  globalThis.fetch = async (path) => ({ ok: true, json: async () => (path.startsWith("https:") ? PRICES : load(path)) });
  await import(`../src/app.js?${instance}`);
  await flush();
  const card = (name) => ids["formula-list"].children.find((node) => descendants(node).some((child) => child.tag === "h3" && child.textContent === name));
  return {
    ids, copied, card,
    result: (name) => descendants(card(name)).find((node) => (node.attributes.class ?? "").startsWith("result")).textContent,
    input: (key) => descendants(ids["formula-list"]).find((node) => node.attributes["data-key"] === key),
    word: () => descendants(ids.verdict).find((node) => (node.attributes.class ?? "").startsWith("verdict-word")).textContent,
    why: () => descendants(ids.verdict).find((node) => node.attributes.class === "verdict-why").textContent,
    bar: () => descendants(ids["data-bar"]).map((node) => node.textContent).join("|"),
    cap: () => descendants(ids["data-bar"]).find((node) => node.tag === "select"),
    legs: () => descendants(ids["price-chart"]).filter((node) => node.tag === "li").map((node) => node.textContent),
    bands: (kind) => descendants(ids["price-chart"]).filter((node) => node.attributes.class === `band-${kind}`).length,
    compare: () => descendants(ids["compare-body"]).map((node) => node.textContent).join("|"),
  };
}

test("P12 預調度範圍內兩個循環：逐循環判斷、加總、上限切換、手動試算與分享", async () => {
  const saved = Object.fromEntries(["document", "window", "location", "fetch", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-20T23:40:00+10:00") });
  try {
    const page = await open_page({ instance: "p12" });
    assert.equal(page.cap().attributes["aria-label"], "預調度範圍內最多循環數");
    assert.equal(page.cap().value, "2", "預設值來自 config/dispatch.json");
    assert.match(page.bar(), /排出 2 個循環（預調度範圍內最多 2 個）/);
    assert.doesNotMatch(page.bar(), /每日循環/, "上限以預調度範圍計，不用「每日」");
    assert.equal(page.word(), "執行", "結論列大字是循環 1（下一個循環）");
    assert.equal(page.why(), "循環 1：執行（價差 140 ≥ 0，淨收益 A$ 2,800） · 循環 2：執行（價差 170 ≥ 0，淨收益 A$ 3,400） · 預調度範圍執行淨收益 A$ 6,200");
    assert.equal(page.result("價差"), "循環 1 140 AUD/MWh · 循環 2 170 AUD/MWh", "每循環公式逐循環列出");
    assert.equal(page.result("執行或等待"), "循環 1 執行 · 循環 2 執行");
    assert.equal(page.result("每日執行淨收益"), "A$ 6,200", "只加總執行的循環");
    assert.ok(descendants(page.card("每日執行淨收益")).some((node) => node.textContent === "彙總：預調度範圍內已執行的循環"));
    assert.equal(page.bands("charge"), 16, "兩個循環的充電長條都畫出");
    assert.equal(page.bands("discharge"), 16);
    assert.deepEqual(page.legs().map((text) => text.split(" ").slice(0, 3).join(" ")), ["循環 1 充電", "循環 1 放電", "循環 2 充電", "循環 2 放電"]);
    assert.ok(page.legs()[3].endsWith("+5 MW · 執行"));
    assert.match(page.compare(), /目前與預設相同/);

    page.input("spread_standard").value = "150"; page.input("spread_standard").listeners.change();
    assert.equal(page.word(), "等待", "循環 1 不達標");
    assert.match(page.why(), /^循環 1：等待（價差 140 < 150，淨收益 A\$ 2,800） · 循環 2：執行（價差 170 ≥ 150/);
    assert.equal(page.result("每日執行淨收益"), "A$ 3,400", "不達標的循環不計入");
    assert.ok(page.legs()[1].endsWith("· 等待") && page.legs()[3].endsWith("· 執行"), "排程圖逐循環標判斷");
    page.ids["reset-all"].listeners.click();

    page.cap().value = "1"; page.cap().listeners.change();
    assert.equal(page.cap().value, "1");
    assert.equal(page.why(), "價差 170 ≥ 標準 0 AUD/MWh · 每循環淨收益 A$ 3,400 · 預調度範圍執行淨收益 A$ 3,400", "上限 1 與原本的單循環相同");
    assert.equal(page.bands("charge"), 8);
    assert.match(page.compare(), /預調度範圍內最多循環數：2 → 1/);
    page.ids["share-settings"].listeners.click();
    await flush();
    const url = new URL(page.copied.at(-1));
    assert.equal(JSON.parse(Buffer.from(url.searchParams.get("s"), "base64url").toString()).max_cycles, 1, "分享網址保存上限");
    page.cap().value = "2"; page.cap().listeners.change();
    assert.match(page.compare(), /目前與預設相同/, "改回預設值就不算調整");

    page.input("charge_price").value = "50"; page.input("charge_price").listeners.change();
    assert.equal(page.word(), "手動試算");
    assert.match(page.why(), /試算結果：執行 · 價差 130 ≥ 標準 0 AUD\/MWh · 每循環淨收益 A\$ 2,600 · 預調度範圍執行淨收益 A\$ 2,600 · 手動均價只試算循環 1，另 1 個循環未計入$/);
    assert.equal(page.bands("charge"), 8, "手動試算只畫循環 1");
    page.ids["reset-all"].listeners.click();
    assert.equal(page.result("每日執行淨收益"), "A$ 6,200", "全部還原回到兩個循環");

    const shared = await open_page({ search: url.search, instance: "p12-shared" });
    assert.equal(shared.cap().value, "1", "新頁面還原上限");
    assert.equal(shared.result("每日執行淨收益"), "A$ 3,400");
    shared.ids["reset-all"].listeners.click();
    assert.equal(shared.cap().value, "2", "全部還原回到預設上限");
  } finally {
    mock.timers.reset();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
