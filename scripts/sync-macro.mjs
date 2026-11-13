/**
 * sync-macro.mjs —— 把宏观三件套落到 data/macro.json
 *
 * 主源（v2.5.2 起）：CNBC 实时报价（Tradeweb / ICE / CBOE 直连，带 last_time）
 *   US10Y  10 年期美债收益率
 *   .DXY   ICE 美元指数
 *   .VIX   CBOE 波动率指数
 *
 * 回退源（主源不可用时）：
 *   VIX ：CBOE 官方日线 CSV（cdn-api.cboe.com）
 *   10Y ：FRED DGS10（美联储圣路易斯分行，日频 T+1，遇美股假期会再延一天）
 *   DXY ：open.er-api 汇率 × ICE 官方公式合成
 *
 * 为什么换主源：用户反馈「10Y 和美元指数截止 11.11，今天 13 号还不更新」。
 *   FRED DGS10 是日频且 T+1 发布，11-11 美国退伍军人节休市 → 数据停在 11-10；
 *   CBOE CSV 同样只到上一交易日收盘。CNBC 的 last_time 是当下时刻，能真正反映「现在」。
 *
 * 每项都保留「前值」，前端据此判断方向：DXY↓+10Y↓ = 强支撑，VIX 单日 >+20% = 避险模式。
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; xau-copilot-sync/2.1)" };
const OUT = "data/macro.json";

/* 注意：CNBC 多标的用 `|` 分隔（%7C）；用逗号会被当成一个标的，返回 code:1 空壳 */
const CNBC =
  "https://quote.cnbc.com/quote-html-webservice/quote.htm" +
  "?symbols=US10Y%7C.DXY%7C.VIX&requestMethod=quick&noform=1&partnerId=2&fund=1&exthrs=1&output=json";

async function text(url) {
  const r = await fetch(url, { headers: UA, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
  return r.text();
}

/** `2026-11-13T08:54:18.000-0500` → `2026-11-13T08:54:18-05:00`（Date.parse 才稳） */
export function normalizeAt(s) {
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2})(\d{2})$/);
  if (!m) return null;
  return `${m[1]}${m[2]}:${m[3]}`;
}

/**
 * 解析 CNBC 多标的响应。
 * @returns {{tnx:object|null,dxy:object|null,vix:object|null}} 每项 {cur,prev,at}，缺项为 null
 */
export function parseCnbc(json) {
  const raw = json && json.QuickQuoteResult && json.QuickQuoteResult.QuickQuote;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const pick = (symbol) => {
    const it = arr.find((x) => String((x && x.symbol) || "").toUpperCase() === symbol.toUpperCase());
    if (!it) return null;
    const cur = Number(it.last);
    const prev = Number(it.previous_day_closing);
    if (!Number.isFinite(cur) || cur <= 0) return null;
    return {
      cur,
      prev: Number.isFinite(prev) && prev > 0 ? prev : null,
      at: normalizeAt(it.last_time),
    };
  };

  return { tnx: pick("US10Y"), dxy: pick(".DXY"), vix: pick(".VIX") };
}

async function fetchCnbc() {
  const r = await fetch(CNBC, { headers: UA, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} @ cnbc`);
  return parseCnbc(await r.json());
}

/* ── 回退源 ── */

/* CBOE：DATE,OPEN,HIGH,LOW,CLOSE */
async function fetchVix() {
  const csv = await text("https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv");
  const rows = csv.trim().split(/\r?\n/).slice(1);
  const vals = rows
    .map((l) => l.split(","))
    .map((c) => ({ d: c[0], v: +c[4] }))
    .filter((x) => Number.isFinite(x.v));
  if (vals.length < 2) throw new Error("VIX 行数不足");
  const a = vals[vals.length - 2], b = vals[vals.length - 1];
  return { cur: b.v, prev: a.v, date: b.d };
}

/* FRED：observation_date,DGS10 —— 可能含 "." 缺失 */
async function fetchTnx() {
  const csv = await text("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10");
  const vals = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(","))
    .map((c) => ({ d: c[0], v: parseFloat(c[1]) }))
    .filter((x) => Number.isFinite(x.v));
  if (vals.length < 2) throw new Error("DGS10 行数不足");
  const a = vals[vals.length - 2], b = vals[vals.length - 1];
  return { cur: b.v, prev: a.v, date: b.d };
}

/* DXY：ICE 公式，权重与符号来自官方定义 */
function synthDxy(r) {
  const { EUR, JPY, GBP, CAD, SEK, CHF } = r || {};
  if (![EUR, JPY, GBP, CAD, SEK, CHF].every((v) => Number(v) > 0)) return null;
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

async function fetchDxy(prevDxy) {
  const r = await fetch("https://open.er-api.com/v6/latest/USD", { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} @ er-api`);
  const j = await r.json();
  const dxy = synthDxy(j.rates);
  if (dxy == null) throw new Error("汇率字段缺失，无法合成 DXY");

  /* 前一日 DXY：优先用 frankfurter 历史汇率独立合成，避免「自己和自己比」得不出方向 */
  let prev = prevDxy;
  try {
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const hr = await fetch(`https://api.frankfurter.dev/v1/${day}?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF`, { headers: UA });
    if (hr.ok) {
      const hj = await hr.json();
      const pd = synthDxy(hj.rates);
      if (pd != null) prev = +pd.toFixed(3);
    }
  } catch {
    /* 历史汇率拿不到就沿用上次落盘值 */
  }
  return { cur: +dxy.toFixed(3), prev, date: (j.time_last_update_utc || "").slice(0, 16) };
}

const FALLBACK = { tnx: fetchTnx, vix: fetchVix };

async function main() {
  const prevDoc = (() => {
    try {
      return JSON.parse(existsSync(OUT) ? readFileSync(OUT, "utf8") : "{}");
    } catch {
      return {};
    }
  })();

  const out = {
    symbol: "MACRO",
    asOf: new Date().toISOString(),
    sources: { vix: null, tnx: null, dxy: null },
    dxy: null, dxyPrev: null,
    tnx: null, tnxPrev: null,
    vix: null, vixPrev: null,
    dates: {},
    times: {},          // v2.5.2：每项数据的真实时刻（ISO 带时区）
    errs: [],
  };

  /* 1) 主源：一次请求拿三项，全实时 */
  let cnbc = null;
  try {
    cnbc = await fetchCnbc();
    if (!cnbc.tnx && !cnbc.dxy && !cnbc.vix) throw new Error("三标的均未返回");
  } catch (e) {
    out.errs.push(`cnbc: ${e.message}`);
  }

  /* 2) 逐项落值：主源命中即用，否则走回退源，再否则沿用上次 */
  for (const key of ["tnx", "dxy", "vix"]) {
    const hit = cnbc && cnbc[key];
    if (hit && Number.isFinite(hit.cur)) {
      out[key] = +hit.cur.toFixed(2);
      out[key + "Prev"] = hit.prev != null ? +hit.prev.toFixed(2) : null;
      out.times[key] = hit.at;
      out.dates[key] = hit.at ? hit.at.slice(0, 16).replace("T", " ") : null;
      out.sources[key] = "cnbc";
      continue;
    }

    try {
      const prevDxy = Number(prevDoc.dxy) > 0 ? prevDoc.dxy : Number(prevDoc.dxyPrev) || null;
      const v = key === "dxy" ? await fetchDxy(prevDxy) : await FALLBACK[key]();
      out[key] = +v.cur.toFixed(2);
      out[key + "Prev"] = v.prev != null ? +v.prev.toFixed(2) : null;
      out.dates[key] = v.date || null;
      out.times[key] = null;          // 回退源只有交易日，没有精确时刻
      out.sources[key] = key === "dxy" ? "er-api×ICE" : key === "tnx" ? "fred:DGS10" : "cboe";
      out.errs.push(`${key}: cnbc 未命中，回退 ${out.sources[key]}`);
    } catch (e) {
      out.errs.push(`${key}: ${e.message}`);
      // 抓取失败时沿用上次值，不让宏观卡整块变灰
      if (Number(prevDoc[key]) > 0) {
        out[key] = prevDoc[key];
        out[key + "Prev"] = prevDoc[key + "Prev"] ?? null;
        out.dates[key] = (prevDoc.dates && prevDoc.dates[key]) || "沿用上次";
        out.times[key] = (prevDoc.times && prevDoc.times[key]) || null;
        out.sources[key] = "沿用上次";
        out.errs.push(`${key} 沿用上次值`);
      }
    }
  }

  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `[macro] DXY ${out.dxy} (prev ${out.dxyPrev}) | 10Y ${out.tnx}% (prev ${out.tnxPrev}%) | VIX ${out.vix} (prev ${out.vixPrev})`,
  );
  console.log(
    `[macro] 数据时刻 DXY ${out.times.dxy || "--"} | 10Y ${out.times.tnx || "--"} | VIX ${out.times.vix || "--"}`,
  );
  if (out.errs.length) console.warn("[macro] 降级项：" + out.errs.join(" ; "));
}

/* 仅当被直接执行时才跑主流程；被测试 import 时只暴露纯函数，不触网 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
