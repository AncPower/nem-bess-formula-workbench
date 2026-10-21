/**
 * P7：把使用者調整的設定編進網址，並以同一份當次資料比較預設版與目前版本。
 * 網址只保存設定（數值覆寫、改寫的式子、自訂中文名稱、啟用中的歷史分位數條件、P12 預調度範圍內最多循環數），不保存電價或歷史摘要。
 */

import { MAX_CYCLES, valid_max_cycles } from "./cycles.js";
import { parse_expression } from "./expression.js";

export const SHARE_PARAM = "s";
export const SHARE_VERSION = 1;
export const MAX_SHARE_LENGTH = 6000;
const KEY = /^[a-z_][a-z0-9_]*$/;
const CUSTOM_KEY = /^u_[0-9a-z_]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUANTILES = ["p10", "p50", "p90"];
const MAX_EXPRESSION = 500;
const MAX_LABEL = 40;
const MAX_ENTRIES = 100;
const OPERATOR_CHARS = /[-+*/^(),<>×÷−–≥≤＝≠，（）＋＊／]/;
/** 與 app.js 的 key_of 相同：自訂中文名稱的代號由名稱決定。 */
export const custom_key = (label) => `u_${[...label].map((char) => char.codePointAt(0).toString(36)).join("_")}`;

const is_object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const identifiers = (expression) => expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];

/** 目前頁面上會影響結果的設定。歷史分位數只在啟用時保存；循環上限只在使用者改過（不是預設）時保存。 */
export function share_snapshot(state) {
  const expressions = { ...state.expression_overrides };
  const used = new Set(Object.values(expressions).flatMap(identifiers));
  const labels = Object.fromEntries(Object.entries(state.custom_labels ?? {}).filter(([key]) => used.has(key) || Object.hasOwn(state.value_overrides, key)));
  const history = state.scenario_history?.active
    ? { start: state.scenario_history.start, end: state.scenario_history.end, standard: state.scenario_history.standard, quantile: state.scenario_history.quantile, active: true }
    : null;
  const snapshot = { v: SHARE_VERSION, values: { ...state.value_overrides }, expressions, labels, history };
  if (Number.isInteger(state.max_cycles)) snapshot.max_cycles = state.max_cycles;
  return snapshot;
}

export const is_default_snapshot = (snapshot) => !Object.keys(snapshot.values).length && !Object.keys(snapshot.expressions).length && !snapshot.history && snapshot.max_cycles === undefined;

function to_base64url(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function from_base64url(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw Error("內容含有無法辨識的字元");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  let binary;
  try { binary = atob(padded); } catch { throw Error("內容不是有效的編碼"); }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))); } catch { throw Error("內容不是有效的文字"); }
}

export function encode_share(snapshot) {
  const encoded = to_base64url(JSON.stringify(snapshot));
  if (encoded.length > MAX_SHARE_LENGTH) throw Error(`設定太多，網址超過 ${MAX_SHARE_LENGTH} 個字元，無法分享`);
  return encoded;
}

/** 解碼並逐欄驗證；任何一欄不合格就整份拒絕，不做部分套用。 */
export function decode_share(text, { registry, catalog }) {
  if (typeof text !== "string" || text.length === 0) throw Error("分享內容是空的");
  if (text.length > MAX_SHARE_LENGTH) throw Error("分享內容太長");
  let data;
  try { data = JSON.parse(from_base64url(text)); } catch (error) { throw Error(error instanceof SyntaxError ? "內容不是有效的設定格式" : error.message); }
  if (!is_object(data)) throw Error("內容不是有效的設定格式");
  const allowed = ["v", "values", "expressions", "labels", "history", "max_cycles"];
  const extra = Object.keys(data).filter((key) => !allowed.includes(key));
  if (extra.length) throw Error(`不支援的欄位：${extra.join("、")}`);
  if (data.v !== SHARE_VERSION) throw Error("分享網址的版本不支援");
  for (const field of ["values", "expressions", "labels"]) {
    if (!is_object(data[field])) throw Error(`${field} 格式錯誤`);
    if (Object.keys(data[field]).length > MAX_ENTRIES) throw Error(`${field} 項目太多`);
  }

  const formula_ids = new Set(registry.formulas.map((formula) => formula.id));
  const expressions = {};
  for (const [id, expression] of Object.entries(data.expressions)) {
    if (!formula_ids.has(id)) throw Error(`找不到公式 ${id}`);
    if (typeof expression !== "string" || !expression.trim() || expression.length > MAX_EXPRESSION) throw Error(`公式 ${id} 的式子不合法`);
    // 竄改的式子（例如不支援的函式）在這裡就整份拒絕，不留到計算時才顯示「無法計算」。
    try { parse_expression(expression); } catch (error) { throw Error(`公式 ${id} 的式子無法解析：${error.message}`); }
    expressions[id] = expression;
  }

  const labels = {};
  for (const [key, label] of Object.entries(data.labels)) {
    if (!CUSTOM_KEY.test(key)) throw Error(`自訂名稱 ${key} 不合法`);
    if (typeof label !== "string" || !label || label !== label.trim() || label.length > MAX_LABEL || OPERATOR_CHARS.test(label) || /^[a-z_][a-z0-9_]*$/.test(label)) throw Error(`自訂名稱「${label}」不合法`);
    if (custom_key(label) !== key) throw Error(`自訂名稱「${label}」與代號不符`);
    labels[key] = label;
  }

  const aggregates = new Set(Object.keys(registry.aggregates ?? {}));
  const known = new Set([...catalog.variables.map((variable) => variable.key), ...Object.keys(labels), ...Object.values(expressions).flatMap(identifiers)]);
  const values = {};
  for (const [key, value] of Object.entries(data.values)) {
    if (aggregates.has(key)) throw Error(`${key} 是自動加總，不能直接改`);
    if (!KEY.test(key) || !known.has(key)) throw Error(`找不到變數 ${key}`);
    if (typeof value !== "number" || !Number.isFinite(value)) throw Error(`變數 ${key} 的值不是數字`);
    values[key] = value;
  }

  let history = null;
  if (data.history !== null && data.history !== undefined) {
    const h = data.history;
    if (!is_object(h) || h.active !== true) throw Error("歷史分位數設定格式錯誤");
    if (!DATE.test(h.start ?? "") || !DATE.test(h.end ?? "")) throw Error("歷史參考日期格式錯誤");
    if (typeof h.standard !== "number" || !Number.isFinite(h.standard)) throw Error("歷史參考價差標準不是數字");
    if (!QUANTILES.includes(h.quantile)) throw Error("歷史分位數只能是 P10、P50 或 P90");
    history = { start: h.start, end: h.end, standard: h.standard, quantile: h.quantile, active: true };
  }
  const snapshot = { v: SHARE_VERSION, values, expressions, labels, history };
  if (data.max_cycles !== undefined) {
    if (!valid_max_cycles(data.max_cycles)) throw Error(`預調度範圍內最多循環數只能是 1 到 ${MAX_CYCLES} 的整數`);
    snapshot.max_cycles = data.max_cycles;
  }
  return snapshot;
}

export function apply_share(state, snapshot) {
  state.value_overrides = { ...snapshot.values };
  state.expression_overrides = { ...snapshot.expressions };
  state.custom_labels = { ...snapshot.labels };
  state.scenario_history = snapshot.history ? { ...snapshot.history } : null;
  state.max_cycles = snapshot.max_cycles ?? null;
}

export function read_share(search) {
  if (!search) return null;
  return new URLSearchParams(search).get(SHARE_PARAM);
}

/** 分享網址：沒有任何調整時只給分頁網址。 */
export function share_url({ origin, pathname }, snapshot, tab) {
  const base = `${origin}${pathname}`;
  if (is_default_snapshot(snapshot)) return `${base}#${tab}`;
  return `${base}?${SHARE_PARAM}=${encode_share(snapshot)}#${tab}`;
}

/** 逐條公式比較預設版與目前版本；兩邊都是同一份當次資料算出來的。 */
export function compare_rows(formulas, base_results, current_results) {
  const valid = (result) => result && !result.error && Number.isFinite(result.value);
  return formulas.map((formula) => {
    const base = base_results.find((result) => result.id === formula.id);
    const current = current_results.find((result) => result.id === formula.id);
    let same;
    let delta = null;
    if (valid(base) && valid(current)) {
      if (formula.format === "decision") same = (base.value !== 0) === (current.value !== 0);
      else { delta = current.value - base.value; same = Math.abs(delta) < 1e-9; }
    } else same = (base?.error ?? null) === (current?.error ?? null);
    return { id: formula.id, name: formula.name, format: formula.format, unit: formula.unit, base, current, delta, same };
  });
}
