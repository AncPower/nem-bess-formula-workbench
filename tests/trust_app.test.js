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
const flush = () => new Promise((resolve) => setImmediate(resolve));
const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const PRICES = { "5MIN": [
  ...Array.from({ length: 16 }, (_, index) => ({ REGIONID: "NSW1", PERIODTYPE: "FORECAST", SETTLEMENTDATE: `2026-10-21T${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00`, RRP: index < 8 ? 35 : 190 })),
  ...Array.from({ length: 6 }, (_, i) => ({ REGIONID: "NSW1", PERIODTYPE: "ACTUAL", SETTLEMENTDATE: new Date(Date.parse("2026-10-20T23:05:00Z") + i * 300000).toISOString().slice(0, 19), RRP: 88 })),
] };

test("T8 資料可信度：即時、手動試算、過期自動轉換、讀取中、讀取失敗不沿用舊電價", async () => {
  const saved = Object.fromEntries(["document", "window", "location", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  // 最後實際時段是 NEM 2026-10-20 23:30；從 10 分鐘後開始。setInterval 也一起模擬，才能測頁面開著不動會自動轉成過期。
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-20T23:40:00+10:00") });
  try {
    const ids = Object.fromEntries(["page-title", "page-lede", "verdict", "chart-section", "data-bar", "price-chart", "calc-status", "history-panel", "formula-list", "reset-all", "compare-body"].map((id) => [id, new Node("div")]));
    let respond = async () => PRICES;
    globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag), getElementById: (id) => ids[id], querySelectorAll: () => [] };
    globalThis.window = { addEventListener: () => {} };
    globalThis.location = { hash: "#predispatch", search: "" };
    globalThis.fetch = async (path) => path.startsWith("https:")
      ? { ok: true, json: () => respond() }
      : { ok: true, json: async () => load(path) };
    await import("../src/app.js");
    await flush(); await flush();

    const word = () => descendants(ids.verdict).find((node) => (node.attributes.class ?? "").startsWith("verdict-word"));
    const why = () => descendants(ids.verdict).find((node) => node.attributes.class === "verdict-why").textContent;
    const bar = () => descendants(ids["data-bar"]).map((node) => node.textContent).join("|");
    const chart = () => descendants(ids["price-chart"]);
    const input = (key) => descendants(ids["formula-list"]).find((node) => node.attributes["data-key"] === key);
    const reload = () => descendants(ids["data-bar"]).find((node) => node.tag === "button").listeners.click();

    assert.equal(word().textContent, "執行", "即時資料才給執行");
    assert.equal(input("charge_price").value, "35", "用的是讀到的電價，不是預設值");
    assert.match(word().attributes.class, /decision-go/);
    assert.match(bar(), /最後實際時段 10 分鐘前/);
    assert.ok(chart().some((node) => node.tag === "li" && node.textContent.endsWith("+5 MW · 執行")));

    const compare = () => descendants(ids["compare-body"]).map((node) => node.textContent).join("|");
    respond = async () => ({ "5MIN": PRICES["5MIN"].map((row) => row.PERIODTYPE === "FORECAST" && row.RRP === 35 ? { ...row, RRP: 35.123456789 } : row) });
    reload(); await flush(); await flush();
    assert.equal(input("charge_price").value, "35.12", "價格框只顯示兩位");
    assert.ok(chart().some((node) => node.attributes.class === "average-charge"), "圖表仍有原精度均價線");
    assert.match(compare(), /目前與預設相同/, "顯示四捨五入不建立價格覆寫");
    input("spread_standard").value = "154.878"; input("spread_standard").listeners.change();
    assert.equal(word().textContent, "等待", "原始價差 154.876543211 小於門檻，若誤用 35.12 則會變成執行");
    const precise_reason = why();
    input("charge_price").listeners.change();
    assert.equal(word().textContent, "等待", "未輸入就離開欄位不變成手動試算");
    assert.equal(why(), precise_reason, "不把四捨五入值寫回計算");
    input("charge_price").value = "35.12"; input("charge_price").listeners.input(); input("charge_price").listeners.change();
    assert.equal(word().textContent, "手動試算", "實際輸入相同顯示值仍算手動覆寫");
    assert.match(why(), /試算結果：執行/, "實際修改後才用 35.12 計算");
    ids["reset-all"].listeners.click();
    respond = async () => PRICES;
    reload(); await flush(); await flush();

    input("charge_price").value = "50"; input("charge_price").listeners.change();
    assert.equal(word().textContent, "手動試算", "手動改均價不能當作當下建議");
    assert.match(why(), /^你改了「充電段均價」，不是當下建議 · 試算結果：執行 · 價差 140/);
    assert.ok(chart().some((node) => node.tag === "li" && node.textContent.endsWith("· 試算：執行")), "排程圖也標試算");
    ids["reset-all"].listeners.click();
    assert.equal(word().textContent, "執行", "全部還原後回到即時");

    mock.timers.tick(25 * 60 * 1000);
    assert.equal(word().textContent, "執行", "35 分鐘（含）以內仍是即時");
    mock.timers.tick(1 * 60 * 1000);
    assert.equal(word().textContent, "資料可能過期", "頁面開著不動，超過 35 分鐘自動轉成可能過期");
    assert.match(why(), /^最後實際時段是 36 分鐘前（超過 35 分鐘），請重新讀取 · 試算結果：執行/);
    assert.match(bar(), /最後實際時段 36 分鐘前，可能過期/);

    let fail;
    respond = () => new Promise((_, reject) => { fail = reject; });
    reload();
    assert.equal(word().textContent, "讀取中", "讀取中不給判斷");
    await flush();
    fail(new Error("AEMO API 回應 503"));
    await flush(); await flush();
    assert.equal(word().textContent, "讀取失敗");
    assert.match(why(), /^AEMO API 回應 503。沒有拿舊電價判斷/);
    assert.ok(chart().some((node) => /^讀到 AEMO 電價後/.test(node.textContent)), "讀取失敗清掉上一次的曲線");
    assert.equal(input("charge_price").value, "40", "讀取失敗清掉上一次的均價（35），回到預設");
    assert.equal(input("discharge_price").value, "180", "讀取失敗清掉上一次的均價（190），回到預設");

    input("charge_price").value = "30"; input("charge_price").listeners.change();
    input("discharge_price").value = "200"; input("discharge_price").listeners.change();
    assert.equal(word().textContent, "手動試算", "讀取失敗後手動輸入就是手動試算");
    assert.match(why(), /^你改了「充電段均價」、「放電段均價」/);

    respond = async () => PRICES;
    ids["reset-all"].listeners.click();
    reload();
    await flush(); await flush();
    assert.equal(word().textContent, "資料可能過期", "重新讀到的資料本身仍舊時，不會因為剛讀取就變即時");
  } finally {
    mock.timers.reset();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
