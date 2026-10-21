import { fetch_report as read_report } from "./predispatch.js";

/** Bound both request and body reading without changing the historical selection fingerprint. */
export async function fetch_report(fetch_impl = fetch) {
  const signal = AbortSignal.timeout(15000);
  try {
    return await read_report((url, options) => fetch_impl(url, { ...options, signal }));
  } catch (error) {
    if (error?.name === "TimeoutError") throw new Error("AEMO 電價讀取超過 15 秒，請求逾時");
    throw error;
  }
}
