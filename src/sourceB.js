/** sourceB.js —— 外部独立行情（XAUUSD 优先，PAXG 仅作最后兜底）
 *
 *  历史教训：PAXG 与 GC=F 基差不同，跨源比价会算错趋势。所以这里先按「同一品种」取数：
 *  1) XAUUSD：日线来自 Actions 同步的新浪伦敦金（XAU），现价来自 gold-api（同为 XAU/USD）
 *  2) 兜底：Binance PAXG（标签明确写「代理」，不冒充 XAUUSD）
 *  统一规则：MA20 只用「已收盘」日线；不足 20 根直接降级，绝不凑数。
 */
import { CONFIG } from "./config.js";
import { ma, atr, round, toCnyGram, dayKey } from "./engine.js";

const num = (v) => (Number.isFinite(+v) ? +v : null);

/* ---------- Provider 1：XAUUSD ---------- */
async function loadXau(opt) {
  const { fetchImpl, config, now } = opt;
  const r = await fetchImpl(`${config.xauUrl}${config.xauUrl.includes("?") ? "&" : "?"}t=${now}`, { cache: "no-store" });
  if (!r || !r.ok) throw new Error("snapshot HTTP " + (r && r.status));
  const doc = await r.json();
  if (!doc || !Array.isArray(doc.bars)) throw new Error("snapshot 缺 bars");

  const today = dayKey(now, 8);
  const closed = doc.bars
    .map((b) => ({ t: Date.parse(b.d + "T00:00:00Z"), o: +b.o, h: +b.h, l: +b.l, c: +b.c, d: b.d }))
    .filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0))
    .filter((b) => b.d < today); // 当日未收盘 K 剔除

  if (closed.length < config.maPeriod) throw new Error(`已收盘仅 ${closed.length} 根`);

  let spot = null;
  let spotSource = "close";
  try {
    const sr = await fetchImpl(config.xauSpotUrl, { cache: "no-store" });
    if (sr && sr.ok) {
      const sj = await sr.json();
      const p = num(sj && sj.price);
      if (p && p > 0) {
        spot = p;
        spotSource = "gold-api";
      }
    }
  } catch (_) {}
  if (!spot) {
    spot = num(doc.spot) || closed[closed.length - 1].c;
    spotSource = doc.spotSource || "sina-close";
  }

  return {
    key: "xau",
    label: "XAUUSD 伦敦金现",
    instrument: "XAUUSD",
    bars: closed,
    spot,
    spotSource,
    atrUsd: atr(closed, config.atrPeriod),
    asOf: doc.asOf ? Date.parse(doc.asOf) : closed[closed.length - 1].t,
  };
}

/* ---------- Provider 2/3：PAXG（兜底） ---------- */
function parseBinance(rows) {
  if (!Array.isArray(rows)) throw new Error("bad payload");
  const out = rows
    .map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], ct: +r[6] }))
    .filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
  if (!out.length) throw new Error("no bars");
  return out;
}

async function loadPaxg(opt, url, key, label) {
  const { fetchImpl, config, now } = opt;
  const r = await fetchImpl(url);
  if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
  const bars = parseBinance(await r.json()).filter((b) => b.ct <= now);
  if (bars.length < config.maPeriod + 1) throw new Error(`已收盘 ${bars.length} 根，不足 ${config.maPeriod + 1}`);
  return {
    key, label, instrument: "PAXG",
    bars, spot: bars[bars.length - 1].c, spotSource: "binance",
    atrUsd: atr(bars, config.atrPeriod), asOf: bars[bars.length - 1].ct,
  };
}

/* ---------- 汇率（只用于展示换算成元/克，不参与趋势判定） ---------- */
async function loadFx(fetchImpl, config) {
  try {
    const r = await fetchImpl(config.fxUrl);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const rate = num(j && j.rates && j.rates.CNY);
    if (!rate || rate <= 0) throw new Error("no CNY");
    return { rate, ok: true, err: null };
  } catch (e) {
    return { rate: config.fxFallback, ok: false, err: String((e && e.message) || e) };
  }
}

export async function loadB(opt = {}) {
  const config = opt.config || CONFIG;
  const fetchImpl = opt.fetchImpl || globalThis.fetch;
  const now = Number(opt.now) || Date.now();
  const ctx = { fetchImpl, config, now };

  const fxP = loadFx(fetchImpl, config);
  const errs = [];
  let pick = null;

  const attempts = [
    () => loadXau(ctx),
    () => loadPaxg(ctx, config.binanceUrl, "binance", "PAXG · Binance（代理）"),
    () => loadPaxg(ctx, config.binanceAltUrl, "binance-alt", "PAXG · Binance 备用（代理）"),
  ];
  for (const attempt of attempts) {
    try {
      pick = await attempt();
      break;
    } catch (e) {
      errs.push((e && e.message) || String(e));
    }
  }

  const fxInfo = await fxP;

  if (!pick) {
    return {
      ok: false, source: null, sourceLabel: null, instrument: null, err: errs.join(" | "), bars: 0,
      fx: fxInfo.rate, fxOk: fxInfo.ok,
      priceUsdOz: null, priceCnyGram: null, ma20UsdOz: null, ma20CnyGram: null,
      devPct: null, trend: null, atrUsdOz: null, atrCnyGram: null, degradedReason: "all-providers-failed",
      asOf: null, closes: [], maSeries: [],
    };
  }

  const closes = pick.bars.map((b) => b.c);
  const ma20 = ma(closes, config.maPeriod);
  const dz = (config.deadZonePct || 0.05) / 100;
  const price = pick.spot;
  const trend = price > ma20 * (1 + dz) ? 1 : price < ma20 * (1 - dz) ? -1 : 0;

  return {
    ok: true,
    source: pick.key,
    sourceLabel: pick.label,
    instrument: pick.instrument,
    err: errs.length ? errs.join(" | ") : null,
    bars: pick.bars.length,
    fx: fxInfo.rate,
    fxOk: fxInfo.ok,
    priceUsdOz: round(price, 2),
    priceCnyGram: round(toCnyGram(price, fxInfo.rate), 2),
    ma20UsdOz: round(ma20, 2),
    ma20CnyGram: round(toCnyGram(ma20, fxInfo.rate), 2),
    devPct: round((price / ma20 - 1) * 100, 2),
    trend,
    atrUsdOz: pick.atrUsd ? round(pick.atrUsd, 1) : null,
    atrCnyGram: pick.atrUsd ? round(toCnyGram(pick.atrUsd, fxInfo.rate), 2) : null,
    spotSource: pick.spotSource,
    asOf: pick.asOf,
    prevClose: round(closes[closes.length - 1], 2),
    dayPct: round((price / closes[closes.length - 1] - 1) * 100, 2),
    closes: closes.slice(-30),
    maSeries: closes.map((_, i) => (i + 1 >= config.maPeriod ? ma(closes.slice(0, i + 1), config.maPeriod) : null)).slice(-30),
  };
}
