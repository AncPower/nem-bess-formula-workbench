import { test } from "node:test";
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

 test("實際 app 串接：單循環、每日卡片、調參、分頁、錯誤與還原", async () => {
  const saved = Object.fromEntries(["document", "window", "location", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    const ids = Object.fromEntries(["data-bar", "variable-list", "formula-list", "reset-all"].map((id) => [id, new Node("div")]));
    const links = ["predispatch", "scenario"].map((tab) => { const link = new Node("a"); link.dataset.tab = tab; return link; });
    const events = {};
    globalThis.document = { createElement: (tag) => new Node(tag), getElementById: (id) => ids[id], querySelectorAll: () => links };
    globalThis.window = { addEventListener: (event, handler) => { events[event] = handler; } };
    globalThis.location = { hash: "#predispatch" };
    globalThis.fetch = async (path) => ({
      ok: true,
      json: async () => path.startsWith("https:") ? { "5MIN": Array.from({ length: 16 }, (_, index) => ({
        REGIONID: "NSW1", PERIODTYPE: "FORECAST", SETTLEMENTDATE: `2026-10-21T${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}:00`, RRP: index < 8 ? 40 : 180,
      })) } : JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")),
    });
    await import("../src/app.js");
    await flush();
    const card = (name) => ids["formula-list"].children.find((node) => descendants(node).some((child) => child.tag === "h3" && child.textContent === name));
    const result = (name) => descendants(card(name)).find((node) => (node.attributes.class ?? "").startsWith("result")).textContent;
    const input = (key) => descendants(ids["variable-list"]).find((node) => node.attributes.id === `var-${key}`);
    assert.equal(result("每日執行淨收益"), "A$ 2,800");
    assert.equal(input("executed_cycle_net_revenue").attributes.disabled, "");
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
    assert.equal(card("每日執行淨收益"), undefined);
    assert.equal(input("daily_revenue").value, "2651");
    input("daily_revenue").value = "100"; input("daily_revenue").listeners.change();
    assert.equal(result("目標期間收益"), "A$ 8,550");
    location.hash = "#predispatch"; events.hashchange();
    const expression = descendants(card("價差")).find((node) => node.tag === "textarea");
    expression.value = "("; expression.listeners.change();
    assert.match(result("每日執行淨收益"), /無法彙總/);
    ids["reset-all"].listeners.click();
    assert.equal(result("每日執行淨收益"), "A$ 2,800");
    location.hash = "#scenario"; events.hashchange();
    assert.equal(input("daily_revenue").value, "2651");
    assert.equal(links[1].attributes["aria-current"], "page");
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
