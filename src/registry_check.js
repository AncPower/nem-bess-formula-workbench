/**
 * 公式登記檔與變數目錄的格式檢查。CI 與頁面共用：任何一項不符就列出問題，不讓壞掉的公式上線。
 */

import { collect_variables, parse_expression } from "./expression.js";

const PAGES = new Set(["predispatch", "scenario", "shared"]);
const FORMATS = new Set(["number", "currency", "decision"]);
const SOURCE_TYPES = new Set(["user", "config", "data"]);
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** @returns {string[]} 問題清單；空陣列代表通過 */
export function check_registry(registry, catalog) {
  const problems = [];
  const variable_keys = new Set();
  for (const entry of catalog.variables ?? []) {
    if (!KEY_PATTERN.test(entry.key ?? "")) problems.push(`變數 key 格式不對：${entry.key}`);
    if (variable_keys.has(entry.key)) problems.push(`變數 key 重複：${entry.key}`);
    variable_keys.add(entry.key);
    if (typeof entry.label !== "string" || entry.label === "") problems.push(`變數 ${entry.key} 缺少 label`);
    if (typeof entry.default !== "number") problems.push(`變數 ${entry.key} 的 default 必須是數字`);
    if (!SOURCE_TYPES.has(entry.source?.type)) problems.push(`變數 ${entry.key} 的 source.type 不對`);
    if (entry.source?.type !== "user" && typeof entry.source?.ref !== "string") problems.push(`變數 ${entry.key} 缺少 source.ref`);
  }
  const formula_ids = new Set();
  for (const formula of registry.formulas ?? []) {
    const label = `公式 ${formula.id}`;
    if (!KEY_PATTERN.test(formula.id ?? "")) problems.push(`公式 id 格式不對：${formula.id}`);
    if (formula_ids.has(formula.id) || variable_keys.has(formula.id)) problems.push(`${label} 的 id 與其他公式或變數重複`);
    formula_ids.add(formula.id);
    if (!PAGES.has(formula.page)) problems.push(`${label} 的 page 必須是 predispatch、scenario 或 shared`);
    if (!FORMATS.has(formula.format)) problems.push(`${label} 的 format 不對`);
    const guidance = formula.guidance ?? {};
    for (const field of ["principle", "method", "how_to_choose"]) {
      if (typeof guidance[field] !== "string" || guidance[field] === "") problems.push(`${label} 缺少 guidance.${field}`);
    }
    if (!Array.isArray(guidance.sources) || guidance.sources.length === 0) problems.push(`${label} 至少要有一個來源`);
    for (const source of guidance.sources ?? []) {
      if (!/^https:\/\//.test(source.url ?? "") || !source.title) problems.push(`${label} 的來源必須有 title 與 https 網址`);
    }
    try {
      const uses = collect_variables(parse_expression(formula.expression));
      for (const name of uses) {
        if (!variable_keys.has(name) && !formula_ids.has(name)) problems.push(`${label} 引用了未定義的「${name}」（只能引用變數或前面的公式）`);
      }
    } catch (error) {
      problems.push(`${label} 的式子無法解析：${error.message}`);
    }
  }
  return problems;
}
