/**
 * 計算引擎：依公式登記檔與變數目錄，解析每個變數的值，依相依順序算出每條公式。
 *
 * 變數值的優先順序：使用者覆寫 > 資料轉接（data）> 設定檔（config）> 預設值。
 * 公式的輸出也是變數，後面的公式可以引用（例如 dispatch_decision 引用 spread）。
 * 式子裡出現目錄沒有的名稱時，視為使用者新增的變數，預設值為 0。
 */

import { collect_variables, evaluate_tree, parse_expression } from "./expression.js";

/** 依「a.b.c」路徑取值。 */
export function read_path(root, path) {
  return path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), root);
}

/**
 * @param {object} args
 * @param {{formulas: object[]}} args.registry 公式登記檔
 * @param {{variables: object[]}} args.catalog 變數目錄
 * @param {{config?: object, data?: object}} [args.context] 設定檔與資料轉接的值
 * @param {Record<string, number>} [args.value_overrides] 使用者覆寫的變數值
 * @param {Record<string, string>} [args.expression_overrides] 使用者改寫的式子
 * @returns {{variables: object[], results: object[]}} 每個變數的值與來源、每條公式的結果
 */
export function compute({ registry, catalog, context = {}, value_overrides = {}, expression_overrides = {} }) {
  const formula_ids = new Set(registry.formulas.map((formula) => formula.id));
  const parsed = new Map();
  for (const formula of registry.formulas) {
    const expression = expression_overrides[formula.id] ?? formula.expression;
    try {
      const tree = parse_expression(expression);
      parsed.set(formula.id, { expression, tree, uses: [...collect_variables(tree)] });
    } catch (error) {
      parsed.set(formula.id, { expression, error: error.message, uses: [] });
    }
  }

  const variables = new Map();
  for (const entry of catalog.variables) variables.set(entry.key, resolve_variable(entry, context, value_overrides));
  for (const { uses } of parsed.values()) {
    for (const name of uses) {
      if (!formula_ids.has(name) && !variables.has(name)) {
        const entry = { key: name, label: name, unit: "—", default: 0, source: { type: "user" }, added_by_user: true };
        variables.set(name, resolve_variable(entry, context, value_overrides));
      }
    }
  }

  const values = Object.fromEntries([...variables].map(([key, item]) => [key, item.value]));
  const results = new Map();
  const visiting = new Set();

  function evaluate_formula(id) {
    if (results.has(id)) return results.get(id);
    const formula = registry.formulas.find((item) => item.id === id);
    const item = parsed.get(id);
    if (visiting.has(id)) return finish(id, formula, item, null, "公式互相引用，形成循環");
    if (item.error) return finish(id, formula, item, null, item.error);
    visiting.add(id);
    for (const name of item.uses) {
      if (formula_ids.has(name)) {
        const dependency = evaluate_formula(name);
        if (dependency.error) {
          visiting.delete(id);
          return finish(id, formula, item, null, `引用的公式「${dependency.name}」無法計算`);
        }
        values[name] = dependency.value;
      }
    }
    visiting.delete(id);
    try {
      const value = evaluate_tree(item.tree, values);
      if (!Number.isFinite(value)) return finish(id, formula, item, null, "結果不是有限數值（可能除以 0）");
      return finish(id, formula, item, value, null);
    } catch (error) {
      return finish(id, formula, item, null, error.message);
    }
  }

  function finish(id, formula, item, value, error) {
    const result = { id, name: formula.name, expression: item.expression, uses: item.uses, value, error, edited: item.expression !== formula.expression };
    results.set(id, result);
    return result;
  }

  registry.formulas.forEach((formula) => evaluate_formula(formula.id));
  return { variables: [...variables.values()], results: registry.formulas.map((formula) => results.get(formula.id)) };
}

function resolve_variable(entry, context, value_overrides) {
  const base = { ...entry };
  if (Object.hasOwn(value_overrides, entry.key)) return { ...base, value: value_overrides[entry.key], origin: "user" };
  const { type, ref } = entry.source ?? { type: "user" };
  if (type === "data" || type === "config") {
    const value = read_path(type === "data" ? context.data : context.config, ref);
    if (typeof value === "number" && Number.isFinite(value)) return { ...base, value, origin: type };
  }
  return { ...base, value: entry.default, origin: "default" };
}
