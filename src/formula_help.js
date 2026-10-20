/**
 * 公式說明：代號的業務意義、輸入欄分組，以及把式子轉成中文算式。
 * 只做顯示，不參與計算；計算一律交給 engine.js。
 */

/** 輸入欄分組，依顯示順序。 */
export const GROUPS = [
  { id: "price", label: "電價" },
  { id: "battery", label: "設備" },
  { id: "rule", label: "判斷與彙總" },
  { id: "scenario", label: "情境假設" },
  { id: "custom", label: "你新增的" },
];

/** 代號 → 分組與白話意義。 */
export const TERMS = {
  charge_price: { group: "price", meaning: "充電那段時間的平均電價，也就是買電成本" },
  discharge_price: { group: "price", meaning: "放電那段時間的平均電價，也就是賣電收入" },
  power_mw: { group: "battery", meaning: "電池每小時最多能充或放多少電，決定每段要幾個 30 分鐘" },
  capacity_mwh: { group: "battery", meaning: "電池一次充滿能存多少電" },
  rte: { group: "battery", meaning: "充進 1 MWh 能放出幾 MWh；0.88 代表損失 12%" },
  degradation_cost: { group: "battery", meaning: "每放 1 MWh 電，電池老化的成本" },
  mlf: { group: "battery", meaning: "AEMO 依併網點公布的損失係數，結算電量要乘上它" },
  spread_standard: { group: "rule", meaning: "價差至少要多少才值得跑一個循環" },
  days: { group: "scenario", meaning: "要估算的天數" },
  availability: { group: "scenario", meaning: "可以調度的天數比例，扣掉維修與中斷" },
  daily_revenue: { group: "scenario", meaning: "每天的淨收益，填 P10、P50 或 P90 得到不同情境" },
  w_demand: { group: "scenario", meaning: "需求因素在調整倍數裡的份量，只看相對大小" },
  w_supply: { group: "scenario", meaning: "供給因素在調整倍數裡的份量，只看相對大小" },
  w_battery: { group: "scenario", meaning: "電池容量成長因素在調整倍數裡的份量，只看相對大小" },
  idx_demand: { group: "scenario", meaning: "需求相對參考期間的變化，1 代表不變" },
  idx_supply: { group: "scenario", meaning: "供給吃緊程度相對參考期間的變化，1 代表不變" },
  idx_battery: { group: "scenario", meaning: "價差保留程度，小於 1 代表新電池把價差壓縮了" },
  executed_cycle_net_revenue: { group: "rule", meaning: "判斷為執行的循環，淨收益自動加總" },
  spread: { meaning: "放電均價減充電均價" },
  cycle_net_revenue: { meaning: "跑一個循環、扣掉效率損失與老化成本後的淨賺" },
  dispatch_decision: { meaning: "1 代表執行，0 代表等待" },
  factor_multiplier: { meaning: "各因素加權平均後的收益倍數" },
  period_revenue: { meaning: "目標期間的總收益" },
  daily_net_revenue: { meaning: "當天已執行循環的淨收益" },
};

export const SHORT_LABELS = { executed_cycle_net_revenue: "已執行循環淨收益加總" };

export function group_of(variable) {
  if (variable.added_by_user) return "custom";
  return TERMS[variable.key]?.group ?? (variable.origin === "aggregate" ? "rule" : "custom");
}

/** 「邊際損失係數（Marginal Loss Factor, MLF）」→「邊際損失係數」，讓算式好讀。 */
export function short_label(label) {
  return label.replace(/（[^（）]*）$/, "");
}

const OPERATORS = { "*": "×", "/": "÷", "-": "−", "+": "+", "^": "^", ">": ">", "<": "<", ">=": "≥", "<=": "≤", "==": "＝", "!=": "≠" };
const FUNCTION_NAMES = { min: "取最小", max: "取最大", abs: "絕對值", round: "四捨五入", if: "如果", and: "同時成立", or: "任一成立" };
const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|[-+*/^(),<>]))/y;

/**
 * 把式子轉成中文算式，例如「discharge_price - charge_price」→「放電段均價 − 充電段均價」。
 * 無法辨識的字元回傳 null（式子本身的錯誤由計算引擎回報）。
 * @param {string} expression
 * @param {(name: string) => string} label_of 代號 → 中文名稱
 */
export function describe_expression(expression, label_of) {
  const parts = [];
  let position = 0;
  let previous = null;
  while (position < expression.length) {
    if (/^\s*$/.test(expression.slice(position))) break;
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(expression);
    if (!match) return null;
    const [, number, name, operator] = match;
    position = TOKEN.lastIndex;
    if (number !== undefined) parts.push(number);
    else if (name !== undefined) {
      const is_call = /^\s*\(/.test(expression.slice(position));
      parts.push(is_call && Object.hasOwn(FUNCTION_NAMES, name) ? FUNCTION_NAMES[name] : label_of(name));
    } else if (operator === "(" || operator === ")") parts.push(operator);
    else if (operator === ",") parts.push("，");
    else {
      const unary = (operator === "-" || operator === "+") && (previous === null || (previous.type === "op" && previous.value !== ")"));
      parts.push(unary ? OPERATORS[operator] : ` ${OPERATORS[operator]} `);
    }
    previous = number !== undefined ? { type: "number" } : name !== undefined ? { type: "name" } : { type: "op", value: operator };
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}
