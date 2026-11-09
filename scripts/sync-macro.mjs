/**
 * sync-macro.mjs —— 把宏观三件套落到 data/macro.json
 *
 *   VIX ：CBOE 官方日线 CSV（cdn-api.cboe.com）
 *   10Y ：FRED DGS10（美联储圣路易斯分行）
 *   DXY ：open.er-api 汇率 × ICE 官方公式合成（无免费 DXY 直连源）
 *
 * 每项都保留「前值」，前端据此判断方向：DXY↓+10Y↓ = 强支撑，VIX 单日 >+20% = 避险模式。
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const UA = { "User-Agent": "Mozilla/5.0 (compatible; xau-copilot-sync/2.0)" };
const OUT = "data/macro.json";

async function text(url) {
  const r = await fetch(url, { headers: UA, redirect: "follow" });
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
  return r.text();
}

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
  sources: { vix: "cboe", tnx: "fred:DGS10", dxy: "er-api × ICE formula" },
  dxy: null, dxyPrev: null,
  tnx: null, tnxPrev: null,
  vix: null, vixPrev: null,
  dates: {},
  errs: [],
};

for (const [key, fn, prevKey] of [
  ["vix", fetchVix, "vix"],
  ["tnx", fetchTnx, "tnx"],
]) {
  try {
    const v = await fn();
    out[key] = +v.cur.toFixed(2);
    out[key + "Prev"] = +v.prev.toFixed(2);
    out.dates[key] = v.date;
  } catch (e) {
    out.errs.push(`${key}: ${e.message}`);
    // 抓取失败时沿用上次值，不让宏观卡整块变灰
    if (Number(prevDoc[prevKey]) > 0) {
      out[key] = prevDoc[prevKey];
      out[key + "Prev"] = prevDoc[prevKey + "Prev"] ?? null;
      out.dates[key] = (prevDoc.dates && prevDoc.dates[key]) || "沿用上次";
      out.errs.push(`${key} 沿用上次值`);
    }
  }
}

try {
  const prevDxy = Number(prevDoc.dxy) > 0 ? prevDoc.dxy : Number(prevDoc.dxyPrev) || null;
  const v = await fetchDxy(prevDxy);
  out.dxy = v.cur;
  out.dxyPrev = v.prev;
  out.dates.dxy = v.date;
} catch (e) {
  out.errs.push(`dxy: ${e.message}`);
  if (Number(prevDoc.dxy) > 0) {
    out.dxy = prevDoc.dxy;
    out.dxyPrev = prevDoc.dxyPrev ?? null;
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(
  `[macro] DXY ${out.dxy} (prev ${out.dxyPrev}) | 10Y ${out.tnx}% (prev ${out.tnxPrev}%) | VIX ${out.vix} (prev ${out.vixPrev})`
);
if (out.errs.length) console.warn("[macro] 降级项：" + out.errs.join(" ; "));
