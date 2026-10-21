import { review_history } from "./history_review.js";
import { mount_quantiles } from "./history_quantiles.js";
let pending;
export function mount_history(bar, state, on_change) {
  const { registry, catalog, config } = state;
  pending ??= fetch("data/daily_summary.json", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw Error("尚無歷史摘要，請先執行本 repo 的下載與產製命令");
    const summary = await response.json();
    for (const path of ["formulas/registry.json", "formulas/variables.json", "config/battery.json"]) {
      const source = await fetch(path, { cache: "no-store" });
      if (!source.ok) throw Error(`無法驗證 ${path}`);
      const digest = await crypto.subtle.digest("SHA-256", await source.arrayBuffer());
      if (Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") !== summary.input_fingerprint?.[path]) throw Error("公式或設備已變更，歷史摘要需重新產製");
    }
    return summary;
  });
  const section = document.createElement("section"); bar.append(section);
  const add = (tag, text, parent = section) => { const node = document.createElement(tag); node.textContent = text; parent.append(node); return node; };
  add("h3", "價差標準檢討：歷史收益保留率");
  add("p", "事後電價檢討，不是最佳門檻或預測，不會建議上調。沿用原單循環窗口；效率與損耗試算不重新選窗，可能漏掉新參數下更好的機會。使用登記檔建議公式，不採用其他卡片的臨時改寫。");
  const status = add("p", "讀取歷史摘要中…");
  status.setAttribute("class", "loading");
  pending.then((summary) => {
    if (!Array.from(bar.children).includes(section)) return;
    status.removeAttribute("class");
    status.textContent = `NSW1 · NEM 時間 UTC+10 · 資料 ${summary.period.start_date} 至 ${summary.period.end_date} · 產生 ${summary.generated_at} · ${summary.sources.length} 個 AEMO 月檔`;
    mount_quantiles(section, summary, state, on_change);
    const inputs = {};
    for (const [key, label, type, value] of [
      ["start", "起日", "date", summary.period.start_date], ["end", "迄日", "date", summary.period.end_date],
      ["standard", "試算標準 AUD/MWh", "number", config.spread_standard.spread_standard_aud_per_mwh],
      ["retention", "保留率門檻（0 至 1）", "number", 0.99], ["rte", "來回效率（0 至 1）", "number", config.battery.round_trip_efficiency],
      ["degradation", "每 MWh 損耗成本 AUD", "number", config.battery.degradation_cost_aud_per_mwh],
    ]) {
      const wrapper = add("label", `${label} `), input = document.createElement("input");
      input.type = type; input.value = String(value); input.step = "any"; input.setAttribute("aria-label", label);
      wrapper.append(input); inputs[key] = input;
    }
    const button = add("button", "重新試算"), output = add("div", "");
    const calculate = () => {
      output.replaceChildren();
      try {
        const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => { if (!input.value) throw Error("試算欄位不得留空"); return [key, ["start", "end"].includes(key) ? input.value : Number(input.value)]; }));
        const result = review_history({ summary, registry, catalog, battery: config.battery, ...values });
        add("h4", `試算：${result.recommendation}`, output);
        add("p", `有效 ${result.valid_days} 天；執行 ${result.selected.executed_days} 天；淨收益 A$ ${result.selected.revenue.toFixed(2)}；保留率 ${result.selected.retention === null ? "無法計算" : `${(100 * result.selected.retention).toFixed(2)}%`}；保留範圍 ${result.range ? result.range.join(" 至 ") : "無"} AUD/MWh`, output);
        add("p", `錯失 ${result.selected.missed_days} 天／A$ ${result.selected.missed_revenue.toFixed(2)}；日期：${result.selected.missed_dates.join("、") || "無"}`, output);
        add("p", `排除日期：${result.excluded.map((day) => `${day.date}（${day.reason}）`).join("、") || "無"}。${result.warnings.join("；")}`, output);
        add("p", `損益兩平價差（僅成本參考）：${result.cost_reference ? `中位數 ${result.cost_reference.median.toFixed(2)}，範圍 ${result.cost_reference.min.toFixed(2)} 至 ${result.cost_reference.max.toFixed(2)} AUD/MWh` : "無可用循環"}。試算不修改設定；未排除事件日。`, output);
        const table = add("table", "", output), header = add("tr", "", table);
        for (const text of ["標準", "執行天數", "淨收益 AUD", "錯失天數", "錯失收益 AUD", "保留率"]) add("th", text, header);
        for (const row of result.scan) {
          const tr = add("tr", "", table);
          for (const text of [row.standard, row.executed_days, row.revenue.toFixed(2), row.missed_days, row.missed_revenue.toFixed(2), row.retention === null ? "N/A" : `${(row.retention * 100).toFixed(2)}%`]) add("td", String(text), tr);
        }
      } catch (error) { add("p", error.message, output); }
    };
    button.addEventListener("click", calculate); calculate();
  }).catch((error) => { status.setAttribute("class", "error"); status.textContent = error.message; });
}
