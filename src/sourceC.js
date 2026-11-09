/**
 * Source C：宏观数据装载（DXY / 10Y / VIX）+ 汇率
 *
 * 数据来自 data/macro.json（Actions 定时抓取 CBOE VIX 官方 CSV、FRED DGS10、
 * 并用 open.er-api 汇率按官方公式合成 DXY）。
 * 汇率另有前端直连通道（open.er-api 带 CORS），用于溢价率实时换算。
 */

import { judgeMacro } from "./core/macro.js";
import { withTTL, QUOTE_TTL } from "./core/sanitize.js";

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function getJSON(fetchImpl, url) {
  const res = await fetchImpl(url, { cache: "no-store" });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"}`);
  return res.json();
}

/** 官方 DXY 公式（ICE 口径） */
export function synthDxy(rates) {
  const { EUR, JPY, GBP, CAD, SEK, CHF } = rates || {};
  if (![EUR, JPY, GBP, CAD, SEK, CHF].every((v) => n(v) > 0)) return null;
  return (
    50.14348112 *
    Math.pow(1 / EUR, -0.576) *
    Math.pow(JPY, 0.136) *
    Math.pow(1 / GBP, -0.119) *
    Math.pow(CAD, 0.091) *
    Math.pow(SEK, 0.042) *
    Math.pow(CHF, 0.036)
  );
}

export async function loadC(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  const cfg = ctx.config || {};
  const base = cfg.baseUrl || "";

  let doc = null;
  const errs = [];
  try {
    doc = await getJSON(fetchImpl, `${base}${cfg.macroUrl || "data/macro.json"}?t=${ctx.now || Date.now()}`);
  } catch (e) {
    errs.push(`宏观快照 ${e.message || e}`);
  }

  const macro = judgeMacro({
    dxy: n(doc && doc.dxy), dxyPrev: n(doc && doc.dxyPrev),
    tnx: n(doc && doc.tnx), tnxPrev: n(doc && doc.tnxPrev),
    vix: n(doc && doc.vix), vixPrev: n(doc && doc.vixPrev),
  });
  macro.asOf = (doc && doc.asOf) || null;
  macro.err = errs.length ? errs.join("；") : null;

  return macro;
}

export async function loadFx(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  const cfg = ctx.config || {};
  try {
    const j = await withTTL("fx:usdcny", QUOTE_TTL, () => getJSON(fetchImpl, cfg.fxUrl));
    const rate = n(j && j.rates && j.rates.CNY);
    if (rate && rate > 5 && rate < 10) {
      return { ok: true, rate, ts: Date.parse(j.time_last_update_utc || "") || Date.now(), fallback: false, err: null };
    }
    throw new Error("汇率数值异常");
  } catch (e) {
    return { ok: false, rate: n(cfg.fxFallback) || 7.1, ts: null, fallback: true, err: String(e.message || e) };
  }
}

/** 国内金价 = 国际 $/oz ÷ 31.1035 × 汇率 */
export const OZ_TO_GRAM = 31.1034768;
export function usdOzToCnyGram(usdOz, fx) {
  const u = n(usdOz), f = n(fx);
  if (!(u > 0) || !(f > 0)) return null;
  return (u / OZ_TO_GRAM) * f;
}
