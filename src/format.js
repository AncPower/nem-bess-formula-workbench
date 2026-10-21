/** 顯示格式不改變計算值；歷史明細可保留兩位，總額預設整元。 */
export function money(value, { digits = 0, symbol = true } = {}) {
  const text = value.toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return symbol ? `A$ ${text}` : text;
}

export const price_input = (value) => String(Number(value.toFixed(2)));
