/**
 * 安全的式子解析與求值：只支援數字、變數、四則運算、次方、比較、括號與白名單函式，不使用 eval。
 *
 * 語法：
 *   數字 1、0.95、1e3；變數 a_b、spread；運算 + - * / ^；比較 > >= < <= == !=
 *   函式 min、max、abs、round、if(條件, 成立值, 不成立值)、and(a, b, ...)、or(a, b, ...)
 *   比較結果為 1（成立）或 0（不成立）。
 */

const FUNCTIONS = Object.freeze({
  min: { arity: [1, Infinity], fn: (...a) => Math.min(...a) },
  max: { arity: [1, Infinity], fn: (...a) => Math.max(...a) },
  abs: { arity: [1, 1], fn: (a) => Math.abs(a) },
  round: { arity: [1, 2], fn: (a, d = 0) => Math.round(a * 10 ** d) / 10 ** d },
  if: { arity: [3, 3], fn: (c, a, b) => (c !== 0 ? a : b) },
  and: { arity: [2, Infinity], fn: (...a) => (a.every((v) => v !== 0) ? 1 : 0) },
  or: { arity: [2, Infinity], fn: (...a) => (a.some((v) => v !== 0) ? 1 : 0) },
});

export const SUPPORTED_FUNCTIONS = Object.keys(FUNCTIONS);

const TOKEN_PATTERN = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|[-+*/^(),<>]))/y;

function tokenize(source) {
  const tokens = [];
  TOKEN_PATTERN.lastIndex = 0;
  let position = 0;
  while (position < source.length) {
    if (/^\s*$/.test(source.slice(position))) break;
    TOKEN_PATTERN.lastIndex = position;
    const match = TOKEN_PATTERN.exec(source);
    if (!match) throw new Error(`第 ${position + 1} 個字元無法辨識：「${source.slice(position).trim()[0]}」`);
    const [, number, name, operator] = match;
    if (number !== undefined) tokens.push({ type: "number", value: Number(number) });
    else if (name !== undefined) tokens.push({ type: "name", value: name });
    else tokens.push({ type: "op", value: operator });
    position = TOKEN_PATTERN.lastIndex;
  }
  return tokens;
}

const BINARY = {
  ">": [1, (a, b) => +(a > b)], ">=": [1, (a, b) => +(a >= b)], "<": [1, (a, b) => +(a < b)],
  "<=": [1, (a, b) => +(a <= b)], "==": [1, (a, b) => +(a === b)], "!=": [1, (a, b) => +(a !== b)],
  "+": [2, (a, b) => a + b], "-": [2, (a, b) => a - b],
  "*": [3, (a, b) => a * b], "/": [3, (a, b) => a / b],
  "^": [5, (a, b) => a ** b],
};

/**
 * 解析式子成語法樹。
 * @param {string} source 式子
 * @returns {object} 語法樹
 */
export function parse_expression(source) {
  if (typeof source !== "string" || source.trim() === "") throw new Error("式子是空的");
  const tokens = tokenize(source);
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const expect = (value) => {
    const token = next();
    if (!token || token.value !== value) throw new Error(`這裡應該是「${value}」`);
  };

  function parse_binary(min_precedence) {
    let left = parse_unary();
    for (;;) {
      const token = peek();
      if (!token || token.type !== "op" || !Object.hasOwn(BINARY, token.value)) break;
      const [precedence] = BINARY[token.value];
      if (precedence < min_precedence) break;
      next();
      const right_associative = token.value === "^";
      const right = parse_binary(right_associative ? precedence : precedence + 1);
      left = { kind: "binary", op: token.value, left, right };
    }
    return left;
  }

  function parse_unary() {
    const token = peek();
    if (token && token.type === "op" && (token.value === "-" || token.value === "+")) {
      next();
      return { kind: "unary", op: token.value, operand: parse_binary(4) };
    }
    return parse_primary();
  }

  function parse_primary() {
    const token = next();
    if (!token) throw new Error("式子提早結束");
    if (token.type === "number") return { kind: "number", value: token.value };
    if (token.type === "name") {
      if (peek() && peek().value === "(") {
        const spec = Object.hasOwn(FUNCTIONS, token.value) ? FUNCTIONS[token.value] : null;
        if (!spec) throw new Error(`不支援的函式「${token.value}」，可用：${SUPPORTED_FUNCTIONS.join("、")}`);
        next();
        const args = [];
        if (peek() && peek().value !== ")") {
          args.push(parse_binary(0));
          while (peek() && peek().value === ",") { next(); args.push(parse_binary(0)); }
        }
        expect(")");
        const [low, high] = spec.arity;
        if (args.length < low || args.length > high) throw new Error(`函式「${token.value}」的參數數量不對`);
        return { kind: "call", name: token.value, args };
      }
      return { kind: "variable", name: token.value };
    }
    if (token.value === "(") {
      const inner = parse_binary(0);
      expect(")");
      return inner;
    }
    throw new Error(`這裡不能放「${token.value}」`);
  }

  const tree = parse_binary(0);
  if (index < tokens.length) throw new Error(`多出「${tokens[index].value}」`);
  return tree;
}

/**
 * 列出式子用到的變數名稱。
 * @param {object} tree 語法樹
 * @returns {Set<string>} 變數名稱
 */
export function collect_variables(tree, found = new Set()) {
  if (tree.kind === "variable") found.add(tree.name);
  else if (tree.kind === "binary") { collect_variables(tree.left, found); collect_variables(tree.right, found); }
  else if (tree.kind === "unary") collect_variables(tree.operand, found);
  else if (tree.kind === "call") tree.args.forEach((arg) => collect_variables(arg, found));
  return found;
}

/**
 * 依變數值求值。
 * @param {object} tree 語法樹
 * @param {Record<string, number>} variables 變數值
 * @returns {number} 結果
 */
export function evaluate_tree(tree, variables) {
  switch (tree.kind) {
    case "number": return tree.value;
    case "variable": {
      if (!Object.hasOwn(variables, tree.name)) throw new Error(`沒有定義變數「${tree.name}」`);
      return variables[tree.name];
    }
    case "unary": {
      const value = evaluate_tree(tree.operand, variables);
      return tree.op === "-" ? -value : value;
    }
    case "binary": return BINARY[tree.op][1](evaluate_tree(tree.left, variables), evaluate_tree(tree.right, variables));
    case "call": return FUNCTIONS[tree.name].fn(...tree.args.map((arg) => evaluate_tree(arg, variables)));
    default: throw new Error("未知的語法節點");
  }
}

/** 解析並求值的捷徑。 */
export function evaluate_expression(source, variables) {
  return evaluate_tree(parse_expression(source), variables);
}
