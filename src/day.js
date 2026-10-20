import { compute } from "./engine.js";

/**
 * Evaluate supplied cycles, then sum selected outputs and evaluate daily formulas.
 * This schedules formulas through compute(); it does not select charging windows.
 * Each cycle is a data context, e.g. { predispatch: { charge_average_price, ... } }.
 */
export function compute_day({ registry, catalog, cycles, context = {}, value_overrides = {}, expression_overrides = {} }) {
  if (!Array.isArray(cycles)) throw new TypeError("cycles 必須是陣列");
  const aggregates = registry.aggregates ?? {};
  const run = (scope, data, extra_catalog = [], variable_errors = {}, overrides = value_overrides) => {
    const forbidden = Object.fromEntries(registry.formulas
      .filter((formula) => formula.scope !== scope)
      .map((formula) => [formula.id, `不可跨計算層級引用「${formula.id}」`]));
    if (scope !== "daily") {
      for (const key of Object.keys(aggregates)) forbidden[key] = `不可跨計算層級引用「${key}」`;
    }
    return compute({
      registry: { formulas: registry.formulas.filter((formula) => formula.scope === scope) },
      catalog: { variables: [...catalog.variables, ...extra_catalog] },
      context: { ...context, data }, value_overrides: overrides, expression_overrides,
      variable_errors: { ...forbidden, ...variable_errors },
    });
  };
  const evaluated = cycles.map((data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("循環必須是資料物件");
    return run("cycle", { ...context.data, ...data });
  });
  const totals = {};
  const errors = {};
  const inputs = [];
  for (const [key, spec] of Object.entries(aggregates)) {
    let total = 0;
    for (const [index, cycle] of evaluated.entries()) {
      const source = cycle.results.find((result) => result.id === spec.formula);
      const decision = cycle.results.find((result) => result.id === spec.when);
      if (!source || !decision || source.error || decision.error) {
        errors[key] = `第 ${index + 1} 個循環無法彙總：${source?.error || decision?.error || "缺少來源公式"}`;
        break;
      }
      if (decision.value !== 0) total += source.value;
    }
    if (!Number.isFinite(total)) errors[key] = "每日加總不是有限數值";
    totals[key] = total;
    inputs.push({ key, label: `已執行循環加總（${key}）`, unit: "", default: 0, source: { type: "data", ref: `daily.${key}` } });
  }
  const overrides = Object.fromEntries(Object.entries(value_overrides).filter(([key]) => !Object.hasOwn(aggregates, key)));
  const daily = run("daily", { ...context.data, daily: totals }, inputs, errors, overrides);
  daily.variables = daily.variables.map((variable) => Object.hasOwn(aggregates, variable.key) ? { ...variable, origin: "aggregate" } : variable);
  return { cycles: evaluated, daily };
}
