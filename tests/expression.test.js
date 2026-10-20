import { test } from "node:test";
import assert from "node:assert/strict";
import { collect_variables, evaluate_expression, parse_expression } from "../src/expression.js";

test("四則運算與優先順序", () => {
  assert.equal(evaluate_expression("1 + 2 * 3", {}), 7);
  assert.equal(evaluate_expression("(1 + 2) * 3", {}), 9);
  assert.equal(evaluate_expression("2 ^ 3 ^ 2", {}), 512);
  assert.equal(evaluate_expression("-2 ^ 2", {}), -4);
  assert.equal(evaluate_expression("10 - 4 - 3", {}), 3);
});

test("變數、比較與函式", () => {
  const variables = { spread: 120, standard: 100, net: -5 };
  assert.equal(evaluate_expression("spread >= standard", variables), 1);
  assert.equal(evaluate_expression("and(spread >= standard, net > 0)", variables), 0);
  assert.equal(evaluate_expression("if(net > 0, net, 0)", variables), 0);
  assert.equal(evaluate_expression("max(1, spread, 3)", variables), 120);
  assert.equal(evaluate_expression("round(2.345, 2)", {}), 2.35);
});

test("不允許任意程式碼", () => {
  assert.throws(() => parse_expression("constructor(1)"), /不支援的函式/);
  assert.throws(() => parse_expression("alert('x')"), /無法辨識/);
  assert.throws(() => parse_expression("a; b"), /無法辨識/);
  assert.throws(() => parse_expression("a.b"), /無法辨識/);
});

test("語法錯誤給出可讀訊息", () => {
  assert.throws(() => parse_expression(""), /空的/);
  assert.throws(() => parse_expression("(1 + 2"), /「\)」/);
  assert.throws(() => parse_expression("1 2"), /多出/);
  assert.throws(() => parse_expression("abs(1, 2)"), /參數數量/);
  assert.throws(() => evaluate_expression("x + 1", {}), /沒有定義變數「x」/);
});

test("列出用到的變數", () => {
  assert.deepEqual([...collect_variables(parse_expression("a * min(b, 2) + -c"))].sort(), ["a", "b", "c"]);
});
