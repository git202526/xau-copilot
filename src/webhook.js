/** webhook.js —— 模块 7：静默推送（失败绝不影响渲染） */
import { CONFIG } from "./config.js";
import { dayKey, round } from "./engine.js";

export function eventOf(state) {
  const s = state && state.decision && state.decision.scenario;
  if (s === "resonance_short") return "RESONANCE_SHORT";
  if (s === "resonance_long") return "RESONANCE_LONG";
  if (state && state.grid && state.grid.fuse) return "GRID_FUSE";
  return null;
}

export function buildPayload(state, ts = Date.now()) {
  const d = state.decision || {};
  const A = state.A || {};
  const B = state.B || {};
  return {
    app: "XAU Copilot",
    event: eventOf(state),
    ts,
    price: B.priceCnyGram != null ? B.priceCnyGram : null,
    ma20: B.ma20CnyGram != null ? B.ma20CnyGram : null,
    trendA: A.trendText || null,
    confidence: d.confidence || null,
    text: `${d.headline || ""}｜${d.body || ""}`.slice(0, 300),
    position: {
      gram: A.position ? round(A.position.gram, 2) : null,
      avgCost: A.position ? A.position.avgCost : null,
    },
  };
}

/**
 * 只在「强共振」或「网格熔断」时推送；同事件同日只推一次。
 * @returns {Promise<{sent:boolean, reason?:string, event?:string}>}
 */
export async function sendAlert(state, opt = {}) {
  const config = opt.config || CONFIG;
  const url = opt.webhookUrl != null ? opt.webhookUrl : config.webhookUrl;
  const storage = opt.storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const fetchImpl = opt.fetchImpl || globalThis.fetch;
  const now = Number(opt.now) || Date.now();

  if (!url) return { sent: false, reason: "no-url" };
  const event = eventOf(state);
  if (!event) return { sent: false, reason: "no-trigger" };

  const key = `${config.hookKeyPrefix}${event}:${dayKey(now, 8)}`;
  try {
    if (storage && storage.getItem(key)) return { sent: false, reason: "dedup", event };
  } catch (_) {}

  const payload = buildPayload(state, now);
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctl ? ctl.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    if (r && r.ok === false && r.status >= 400) throw new Error("hook HTTP " + r.status);
    try { storage && storage.setItem(key, String(now)); } catch (_) {}
    return { sent: true, event };
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { sent: false, reason: "failed", event, err: String((e && e.message) || e) };
  }
}
