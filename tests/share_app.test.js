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
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const IDS = ["page-title", "page-lede", "verdict", "chart-section", "data-bar", "price-chart", "calc-status", "history-panel", "formula-list", "reset-all", "compare-body", "share-output", "share-settings"];
const PRICES = { "5MIN": Array.from({ length: 16 }, (_, index) => ({ REGIONID: "NSW1", PERIODTYPE: "FORECAST", SETTLEMENTDATE: `2026-10-21T${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00`, RRP: index < 8 ? 40 : 180 })) };

/** 以全新的 app 模組實例開一次頁面；search 模擬網址的 ?s=。 */
async function open_page({ search = "", hash = "#predispatch", sample, instance }) {
  const ids = Object.fromEntries(IDS.map((id) => [id, new Node("div")]));
  const links = ["predispatch", "scenario"].map((tab) => { const link = new Node("a"); link.dataset.tab = tab; return link; });
  const events = {};
  const copied = [];
  const replaced = [];
  globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag), getElementById: (id) => ids[id], querySelectorAll: () => links };
  globalThis.window = { addEventListener: (event, handler) => { events[event] = handler; }, history: { replaceState: (...args) => replaced.push(args) } };
  globalThis.location = { hash, search, origin: "https://ancpower.github.io", pathname: "/nem-bess-formula-workbench/" };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text) => { copied.push(text); } } }, configurable: true, writable: true });
  globalThis.fetch = async (path) => ({
    ok: true,
    arrayBuffer: async () => { const bytes = readFileSync(new URL(`../${path}`, import.meta.url)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    json: async () => path.startsWith("https:") ? PRICES : path === "data/daily_summary.json" ? sample : load(path),
  });
  await import(`../src/app.js?${instance}`);
  await flush();
  const card = (name) => ids["formula-list"].children.find((node) => descendants(node).some((child) => child.tag === "h3" && child.textContent === name));
  const page = {
    ids, events, copied, replaced,
    result: (name) => descendants(card(name)).find((node) => (node.attributes.class ?? "").startsWith("result")).textContent,
    input: (key) => descendants(ids["formula-list"]).find((node) => node.attributes["data-key"] === key),
    compare_text: () => descendants(ids["compare-body"]).map((node) => node.textContent).join("|"),
    compare_rows: () => descendants(ids["compare-body"]).filter((node) => node.tag === "tr").slice(1).map((row) => row.children.map((cell) => cell.textContent)),
    card,
    button: (scope, text) => descendants(scope).find((node) => node.tag === "button" && node.textContent === text),
  };
  return page;
}

test("P7 分享與比較：產生網址、在新頁面還原、比較預設版，壞網址不套用", async () => {
  const saved = Object.fromEntries(["document", "window", "location", "fetch", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const sample = build({ region_id: "NSW1", start_date: "2026-07-01", end_date: "2026-07-01", sources: [{ url: "https://nemweb.com.au/test" }], prices: Array.from({ length: 288 }, (_, index) => [new Date(Date.parse("2026-07-01") + (index + 1) * 300000).toISOString().slice(0, 16), index < 144 ? 40 : 180]) }, load("formulas/registry.json"), load("formulas/variables.json"), load("config/battery.json"));
    sample.input_fingerprint = await fingerprint();

    const first = await open_page({ sample, instance: "first" });
    assert.equal(first.result("執行或等待"), "執行");
    assert.match(first.compare_text(), /目前與預設相同。/, "沒改任何設定時明確說相同");
    first.ids["share-settings"].listeners.click();
    await flush();
    assert.equal(first.copied.at(-1), "https://ancpower.github.io/nem-bess-formula-workbench/#predispatch", "沒有調整時網址不帶設定");

    first.input("spread_standard").value = "141"; first.input("spread_standard").listeners.change();
    first.button(first.card("每日執行淨收益"), "改寫公式").listeners.click();
    const editor = descendants(first.card("每日執行淨收益")).find((node) => node.tag === "textarea");
    editor.value = "已執行循環淨收益加總 − 每日固定費用"; editor.listeners.change();
    const fee = descendants(first.card("每日執行淨收益")).find((node) => node.tag === "input" && node.attributes["data-key"]?.startsWith("u_"));
    fee.value = "100"; fee.listeners.change();
    assert.equal(first.result("執行或等待"), "等待");
    assert.equal(first.result("每日執行淨收益"), "A$ -100");

    const text = first.compare_text();
    assert.match(text, /價差標準：0 → 141/);
    assert.match(text, /每日固定費用（你新增的）＝ 100/);
    assert.match(text, /改寫「每日執行淨收益」＝ 已執行循環淨收益加總 − 每日固定費用/);
    const rows = Object.fromEntries(first.compare_rows().map(([name, ...cells]) => [name, cells]));
    assert.deepEqual(rows["執行或等待"], ["執行", "等待", "不同"], "預設版與你的版本並排");
    assert.deepEqual(rows["每日執行淨收益"], ["A$ 2,800", "A$ -100", "−A$ 2,900"]);
    assert.deepEqual(rows["價差"], ["140 AUD/MWh", "140 AUD/MWh", "相同"], "沒受影響的公式標相同");

    first.ids["share-settings"].listeners.click();
    await flush();
    const url = new URL(first.copied.at(-1));
    assert.equal(url.hash, "#predispatch");
    assert.ok(url.searchParams.get("s"), "網址帶設定");
    assert.match(descendants(first.ids["share-output"]).map((node) => node.textContent).join(""), /不保存電價/);
    assert.equal(descendants(first.ids["share-output"]).find((node) => node.tag === "input").attributes.value, url.href, "網址也顯示在畫面上可手動複製");

    const second = await open_page({ search: url.search, sample, instance: "second" });
    assert.equal(second.input("spread_standard").value, "141", "新頁面還原數值");
    assert.equal(second.result("執行或等待"), "等待");
    assert.equal(second.result("每日執行淨收益"), "A$ -100", "還原改寫的公式與新增的變數");
    assert.match(second.compare_text(), /已套用分享網址的設定/);
    assert.match(second.compare_text(), /價差標準：0 → 141/);
    second.ids["reset-all"].listeners.click();
    assert.equal(second.result("執行或等待"), "執行");
    assert.match(second.compare_text(), /目前與預設相同。/, "全部還原後比較回到無差異");
    assert.doesNotMatch(second.compare_text(), /已套用分享網址/);
    assert.deepEqual(second.replaced.at(-1)?.[2], "/nem-bess-formula-workbench/#predispatch", "還原時從網址移除分享設定，重新整理不會再套用");

    const broken = await open_page({ search: "?s=@@@", sample, instance: "broken" });
    assert.match(broken.compare_text(), /分享網址無法套用：.*已用預設值開啟/);
    assert.equal(broken.result("執行或等待"), "執行");
    const tampered = Buffer.from(JSON.stringify({ v: 1, values: { spread_standard: 141, executed_cycle_net_revenue: 9 }, expressions: {}, labels: {}, history: null })).toString("base64url");
    const partial = await open_page({ search: `?s=${tampered}`, sample, instance: "partial" });
    assert.match(partial.compare_text(), /自動加總/);
    assert.equal(partial.input("spread_standard").value, "0", "有一欄不合格就整份不套用");

    partial.input("spread_standard").value = "141"; partial.input("spread_standard").listeners.change();
    partial.button(partial.card("價差"), "改寫公式").listeners.click();
    const long = descendants(partial.card("價差")).find((node) => node.tag === "textarea");
    long.value = "放電段均價 − 充電段均價 ".repeat(40); long.listeners.change();
    partial.ids["share-settings"].listeners.click();
    await flush();
    assert.match(descendants(partial.ids["share-output"]).map((node) => node.textContent).join(""), /無法產生分享網址：公式 spread 的式子不合法/, "產生前先自我驗證，不給出打不開的網址");
    assert.equal(partial.copied.length, 0);

    const history = Buffer.from(JSON.stringify({ v: 1, values: {}, expressions: {}, labels: {}, history: { start: "2026-07-01", end: "2026-07-01", standard: 0, quantile: "p50", active: true } })).toString("base64url");
    const scenario = await open_page({ search: `?s=${history}`, hash: "#scenario", sample, instance: "scenario" });
    await flush();
    assert.equal(scenario.input("daily_revenue").value, "2800", "分享的歷史分位數條件在情境頁重新帶入");
    assert.match(scenario.compare_text(), /每日淨收益改用歷史 P50（2026-07-01 至 2026-07-01，價差標準 0 AUD\/MWh）/);
    assert.deepEqual(Object.fromEntries(scenario.compare_rows().map(([name, ...cells]) => [name, cells]))["目標期間收益"][2] !== "相同", true);
    scenario.ids["share-settings"].listeners.click();
    await flush();
    assert.equal(new URL(scenario.copied.at(-1)).searchParams.get("s"), history, "情境頁再分享得到同一份設定");
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
