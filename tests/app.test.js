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

 test("實際 app 串接：分頁標題、結論、排程圖、中文名稱框框、改寫公式、分頁、錯誤與還原", async () => {
  const saved = Object.fromEntries(["document", "window", "location", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
    const sample = build({ region_id: "NSW1", start_date: "2026-07-01", end_date: "2026-07-01", sources: [{ url: "https://nemweb.com.au/test" }], prices: Array.from({ length: 288 }, (_, index) => [new Date(Date.parse("2026-07-01") + (index + 1) * 300000).toISOString().slice(0, 16), index < 144 ? 40 : 180]) }, load("formulas/registry.json"), load("formulas/variables.json"), load("config/battery.json"));
    sample.input_fingerprint = await fingerprint();
    const ids = Object.fromEntries(["page-title", "page-lede", "verdict", "chart-section", "data-bar", "price-chart", "calc-status", "history-panel", "formula-list", "reset-all"].map((id) => [id, new Node("div")]));
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
    const list = () => descendants(ids["formula-list"]);
    const card = (name) => ids["formula-list"].children.find((node) => descendants(node).some((child) => child.tag === "h3" && child.textContent === name));
    const result = (name) => descendants(card(name)).find((node) => (node.attributes.class ?? "").startsWith("result")).textContent;
    const inputs = (key) => list().filter((node) => node.attributes["data-key"] === key);
    const input = (key) => inputs(key)[0];
    const chip_of = (scope, label) => descendants(scope).find((node) => /^chip /.test(node.attributes.class ?? "") && node.children.some((child) => child.attributes.class === "chip-name" && child.textContent === label));
    const button = (scope, text) => descendants(scope).find((node) => node.tag === "button" && node.textContent === text);
    const verdict_word = () => descendants(ids.verdict).find((node) => (node.attributes.class ?? "").startsWith("verdict-word")).textContent;
    const verdict_why = () => descendants(ids.verdict).find((node) => node.attributes.class === "verdict-why").textContent;

    assert.equal(ids["page-title"].textContent, "預調度：下一個循環要執行還是等待", "標題說明分頁用途");
    assert.match(ids["page-lede"].textContent, /每段長度＝容量 ÷ 功率/);
    assert.equal(verdict_word(), "執行");
    assert.equal(verdict_why(), "價差 140 ≥ 標準 0 AUD/MWh · 每循環淨收益 A$ 2,800 · 當日執行淨收益 A$ 2,800");
    assert.ok(![ids["page-lede"], ids.verdict].some((node) => descendants(node).some((child) => /不是預測/.test(child.textContent))), "不另外加免責口號");
    assert.equal(result("每日執行淨收益"), "A$ 2,800");
    assert.equal(input("executed_cycle_net_revenue").attributes.disabled, "");

    const chart = descendants(ids["price-chart"]);
    for (const kind of ["line-actual", "line-forecast", "boundary"]) assert.ok(chart.some((node) => node.attributes.class === kind), `排程圖缺少 ${kind}`);
    assert.equal(chart.filter((node) => node.attributes.class === "band-charge").length, 8, "充電功率長條，一個時段一條");
    assert.equal(chart.filter((node) => node.attributes.class === "band-discharge").length, 8);
    assert.ok(chart.some((node) => node.textContent === "AUD/MWh") && chart.some((node) => node.textContent === "MW"), "左右兩個 y 軸");
    assert.deepEqual(chart.filter((node) => node.attributes.class === "day-label").map((node) => node.textContent), ["昨天 10/19", "今天 10/20", "明天 10/21"], "x 軸等距排列昨天、今天、明天");
    assert.ok(chart.some((node) => node.attributes.class === "chart-tip"), "游標滑過的說明框");
    assert.equal(chart.filter((node) => node.attributes.class === "hit").length, 144, "三天固定 144 個時段，沒有資料的時段也佔位");
    assert.ok(chart.some((node) => node.tag === "li" && node.textContent === "放電 04:00–07:30（台北 02:00–05:30）· 均價 A$ 180/MWh · +5 MW · 執行"));
    const tick_x = chart.filter((node) => node.tag === "text" && node.attributes.class === "tick" && /^\d\d:\d\d$/.test(node.textContent)).map((node) => Number(node.attributes.x));
    assert.ok(tick_x.length >= 2 && tick_x.every((x, index) => index === 0 || x - tick_x[index - 1] >= 64), "時間刻度至少相隔 64px，不會疊字");
    assert.match(descendants(ids["data-bar"]).map((node) => node.textContent).join(""), /實際 2 個＋預調度 16 個 30 分鐘時段 · 每段 8 個時段/);

    const spread_card = card("價差");
    assert.deepEqual(descendants(spread_card).filter((node) => node.attributes.class === "chip-name").map((node) => node.textContent), ["放電段均價", "充電段均價"]);
    assert.ok(!list().some((node) => /\b(discharge_price|charge_price|spread_standard|capacity_mwh)\b/.test(node.textContent)), "畫面上不出現英文代號");
    assert.match(chip_of(spread_card, "放電段均價").attributes.class, /cat-price/, "電價類共用底色");
    assert.match(chip_of(card("每循環淨收益"), "容量").attributes.class, /cat-battery/, "設備類共用底色");
    assert.match(chip_of(card("執行或等待"), "價差").attributes.class, /cat-result/, "引用其他公式的結果");
    const tip = descendants(chip_of(spread_card, "放電段均價")).find((node) => node.attributes.class === "chip-tip");
    assert.match(tip.textContent, /單位：AUD\/MWh/, "單位與說明放在滑鼠移上才顯示的提示");
    assert.equal(tip.attributes.role, "tooltip");

    assert.equal(inputs("charge_price").length, 2, "同一個變數出現在兩條公式");
    inputs("charge_price")[0].value = "50"; inputs("charge_price")[0].listeners.input();
    assert.equal(inputs("charge_price")[1].value, "50", "同名框框同步");
    ids["reset-all"].listeners.click();

    input("spread_standard").value = "141"; input("spread_standard").listeners.input();
    assert.equal(ids["calc-status"].textContent, "計算中…");
    assert.equal(result("執行或等待"), "執行", "預覽延遲期間不重算");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(result("執行或等待"), "等待");
    assert.match(ids["calc-status"].textContent, /^已更新/);
    assert.ok(input("spread_standard"), "即時預覽不重建輸入框");
    assert.equal(verdict_word(), "等待");
    assert.ok(descendants(ids["price-chart"]).some((node) => node.tag === "li" && node.textContent.endsWith("+5 MW · 等待")));
    assert.equal(descendants(ids["price-chart"]).find((node) => node.tag === "svg").attributes.class, "price-chart fill", "結論改變時功率長條播放填滿動態");
    ids["reset-all"].listeners.click();

    button(card("每日執行淨收益"), "改寫公式").listeners.click();
    const daily_editor = descendants(card("每日執行淨收益")).find((node) => node.tag === "textarea");
    assert.equal(daily_editor.value, "已執行循環淨收益加總", "改寫時也用中文名稱");
    daily_editor.value = "已執行循環淨收益加總 − 每日固定費用"; daily_editor.listeners.change();
    const fee = chip_of(card("每日執行淨收益"), "每日固定費用");
    assert.ok(fee, "打新的中文名稱就多一個輸入框");
    assert.match(fee.attributes.class, /cat-custom/);
    const fee_input = descendants(fee).find((node) => node.tag === "input");
    fee_input.value = "100"; fee_input.listeners.change();
    assert.equal(result("每日執行淨收益"), "A$ 2,700");
    assert.ok(button(card("每日執行淨收益"), "還原建議公式"));
    ids["reset-all"].listeners.click();
    assert.equal(descendants(card("每日執行淨收益")).find((node) => node.tag === "textarea"), undefined, "全部還原時收起改寫區");
    input("spread_standard").value = "141";
    input("spread_standard").listeners.change();
    assert.equal(result("執行或等待"), "等待");
    assert.equal(result("每日執行淨收益"), "A$ 0");

    location.hash = "#scenario"; events.hashchange();
    assert.equal(ids["chart-section"].attributes.hidden, "");
    assert.equal(ids["page-title"].textContent, "情境評估：目標期間能賺多少、價差標準要不要調");
    assert.match(verdict_why(), /^目標期間收益 · \d+ 天 × 可用率 [\d.]+ × 每日 A\$ 2,651 × 調整倍數 [\d.]+$/);
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
    assert.match(chip_of(card("目標期間收益"), "目標期間天數").attributes.class, /cat-scenario/, "情境假設共用底色");
    input("daily_revenue").value = "100"; input("daily_revenue").listeners.change();
    assert.equal(result("目標期間收益"), "A$ 8,550");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const history_input = (label) => descendants(ids["history-panel"]).find((node) => node.attributes["aria-label"] === label);
    assert.equal(input("daily_revenue").value, "100", "載入摘要不覆蓋手動值");
    button(ids["history-panel"], "使用歷史分位數").listeners.click();
    assert.equal(input("daily_revenue").value, "2800");
    assert.equal(result("目標期間收益"), "A$ 239,400", "歷史分位數真的進入情境公式");
    assert.match(descendants(chip_of(card("目標期間收益"), "每日淨收益")).map((node) => node.textContent).join(""), /歷史 P50/);
    history_input("收益參考價差標準 AUD/MWh").value = "141";
    history_input("收益參考價差標準 AUD/MWh").listeners.change();
    assert.equal(input("daily_revenue").value, "0", "有效但不執行的日子納入零收益");
    assert.equal(result("目標期間收益"), "A$ 0");
    history_input("收益參考起日").value = "2026-08-01";
    history_input("收益參考起日").listeners.change();
    assert.match(result("目標期間收益"), /日期/, "自動模式失敗不可靜默回退預設收益");
    assert.equal(input("daily_revenue").value, "", "無效歷史資料不能把預設收益冒充成分位數");
    history_input("收益參考起日").value = "2026-07-01";
    history_input("收益參考價差標準 AUD/MWh").value = "0";
    history_input("收益參考起日").listeners.change();
    assert.equal(result("目標期間收益"), "A$ 239,400");
    location.hash = "#predispatch"; events.hashchange();
    location.hash = "#scenario"; events.hashchange();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(input("daily_revenue").value, "2800", "分頁切換保留歷史模式");
    input("daily_revenue").value = "100"; input("daily_revenue").listeners.change();
    await new Promise((resolve) => setTimeout(resolve, 30));
    history_input("帶入分位數").value = "p90"; history_input("帶入分位數").listeners.change();
    assert.equal(input("daily_revenue").value, "100", "手動輸入後日期與分位數變更不能覆蓋");
    assert.equal(result("目標期間收益"), "A$ 8,550");
    location.hash = "#predispatch"; events.hashchange();
    assert.equal(ids["history-panel"].attributes.hidden, "");
    assert.equal(ids["chart-section"].attributes.hidden, undefined);
    button(card("價差"), "改寫公式").listeners.click();
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
