/**
 * 公式的中文寫法：畫面上只出現中文名稱，不出現英文代號。
 * to_parts：把引擎用的式子拆成「名稱框框／運算子／數字／函式」片段，供畫面逐段渲染。
 * to_chinese：把式子轉成可編輯的中文式子；from_chinese：把使用者打的中文式子轉回引擎用的式子。
 * 只做轉譯，不參與計算；解析與求值一律交給 expression.js。
 */

const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|[-+*/^(),<>]))/y;
export const OPERATOR_TEXT = { "*": "×", "/": "÷", "-": "−", "+": "+", "^": "^", ">": ">", "<": "<", ">=": "≥", "<=": "≤", "==": "＝", "!=": "≠", ",": "，", "(": "(", ")": ")" };
export const FUNCTION_TEXT = { min: "取最小", max: "取最大", abs: "絕對值", round: "四捨五入", if: "如果", and: "同時成立", or: "任一成立" };
const TEXT_OPERATOR = { "×": "*", "÷": "/", "−": "-", "–": "-", "≥": ">=", "≤": "<=", "＝": "==", "≠": "!=", "，": ",", "（": "(", "）": ")", "＋": "+", "＊": "*", "／": "/" };
const FUNCTION_BY_TEXT = Object.fromEntries(Object.entries(FUNCTION_TEXT).map(([name, text]) => [text, name]));
const SPLIT = /(>=|<=|==|!=|[-+*/^(),<>×÷−–≥≤＝≠，（）＋＊／])/;

/**
 * @returns {({type: "name", name: string} | {type: "number", text: string} | {type: "op", text: string} | {type: "call", name: string, text: string})[] | null}
 */
export function to_parts(expression) {
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
    if (number !== undefined) parts.push({ type: "number", text: number });
    else if (name !== undefined) {
      const is_call = /^\s*\(/.test(expression.slice(position));
      parts.push(is_call ? { type: "call", name, text: FUNCTION_TEXT[name] ?? name } : { type: "name", name });
    } else {
      const unary = (operator === "-" || operator === "+") && (previous === null || (previous.type === "op" && previous.text !== ")"));
      parts.push({ type: "op", text: OPERATOR_TEXT[operator], unary });
    }
    previous = parts.at(-1);
  }
  return parts;
}

/** 「discharge_price - charge_price」→「放電段均價 − 充電段均價」。無法拆解時回傳原式。 */
export function to_chinese(expression, label_of) {
  const parts = to_parts(expression);
  if (!parts) return expression;
  return parts.map((part) => {
    if (part.type === "name") return label_of(part.name);
    if (part.type === "call") return part.text;
    if (part.type === "op") return part.text === "(" || part.text === ")" || part.text === "，" || part.unary ? part.text : ` ${part.text} `;
    return part.text;
  }).join("").replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}

/**
 * 「放電段均價 − 充電段均價」→「discharge_price - charge_price」。
 * @param {string} text 使用者打的中文式子
 * @param {(word: string) => string} key_of 中文名稱 → 代號；不認得的名稱由呼叫端決定（例如新增一個自訂變數）
 */
export function from_chinese(text, key_of) {
  const pieces = text.split(SPLIT);
  const out = [];
  pieces.forEach((piece, index) => {
    if (index % 2 === 1) { out.push(TEXT_OPERATOR[piece] ?? piece); return; }
    const word = piece.trim();
    if (word === "") return;
    const next = pieces.slice(index + 1).find((item) => item.trim() !== "");
    if (/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(word)) out.push(word);
    else if ((next === "(" || next === "（") && (Object.hasOwn(FUNCTION_BY_TEXT, word) || Object.hasOwn(FUNCTION_TEXT, word))) out.push(FUNCTION_BY_TEXT[word] ?? word);
    else out.push(key_of(word));
  });
  return out.join(" ")
    .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+,/g, ",")
    .replace(/\b(min|max|abs|round|if|and|or) \(/g, "$1(")
    .replace(/\s+/g, " ").trim();
}
