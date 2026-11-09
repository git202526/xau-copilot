/** sourceB.js —— 外部独立行情（多源防盲信：绝不复用老应用的口径）
 *  通道优先级：Binance PAXG（主）→ Binance 备用域名 → CoinGecko PAXG（仅收盘价）
 *  原则：只吃「已收盘」日线；不足 20 根就降级，绝不拿 19 根凑 MA20。
 */
import { CONFIG } from "./config.js";
import { ma, atr, round, toCnyGram } from "./engine.js";

const num = (v) => (Number.isFinite(+v) ? +v : null);

function parseBinance(rows) {
  if (!Array.isArray(rows)) throw new Error("bad payload");
  const out = rows
    .map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], ct: +r[6] }))
    .filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
  if (!out.length) throw new Error("no bars");
  return out;
}

/** CoinGecko market_chart：只有收盘价，无 OHLC（ATR 将不可用，界面标注） */
function parseCoinGecko(j) {
  const prices = j && Array.isArray(j.prices) ? j.prices : [];
  const out = prices
    .map(([ts, p]) => ({ t: +ts, ct: +ts, o: +p, h: +p, l: +p, c: +p }))
    .filter((b) => Number.isFinite(b.c) && b.c > 0);
  if (out.length < 21) throw new Error("no bars");
  return out;
}

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

  const providers = [
    { key: "binance", label: "Binance PAXG", url: config.binanceUrl, parse: parseBinance, ohlc: true },
    { key: "binance-alt", label: "Binance PAXG 备用", url: config.binanceAltUrl, parse: parseBinance, ohlc: true },
    { key: "coingecko", label: "CoinGecko PAXG", url: config.coingeckoUrl, parse: parseCoinGecko, ohlc: false },
  ].filter((p) => p.url);

  const fxP = loadFx(fetchImpl, config);

  const errs = [];
  let bars = [];
  let used = null;
  for (const p of providers) {
    try {
      const r = await fetchImpl(p.url);
      if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
      const parsed = p.parse(await r.json());
      const clean = parsed.filter((b) => b.ct <= now); // 只留已收盘
      if (clean.length < config.maPeriod + 1) throw new Error(`已收盘 ${clean.length} 根，不足 ${config.maPeriod + 1}`);
      bars = clean;
      used = p;
      break;
    } catch (e) {
      errs.push(`${p.key}: ${(e && e.message) || e}`);
    }
  }

  const fxInfo = await fxP;

  if (!bars.length) {
    return {
      ok: false, source: null, sourceLabel: null, err: errs.join(" | "), bars: 0,
      fx: fxInfo.rate, fxOk: fxInfo.ok,
      priceUsdOz: null, priceCnyGram: null, ma20UsdOz: null, ma20CnyGram: null,
      devPct: null, trend: null, atrUsdOz: null, atrCnyGram: null, degradedReason: "all-providers-failed",
    };
  }

  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const ma20 = ma(closes, config.maPeriod);
  const dz = (config.deadZonePct || 0.05) / 100;
  const trend = price > ma20 * (1 + dz) ? 1 : price < ma20 * (1 - dz) ? -1 : 0;
  const atrRaw = used.ohlc ? atr(bars, config.atrPeriod) : null;

  return {
    ok: true, source: used.key, sourceLabel: used.label,
    err: errs.length ? errs.join(" | ") : null, bars: bars.length,
    fx: fxInfo.rate, fxOk: fxInfo.ok,
    priceUsdOz: round(price, 1),
    priceCnyGram: round(toCnyGram(price, fxInfo.rate), 2),
    ma20UsdOz: round(ma20, 1),
    ma20CnyGram: round(toCnyGram(ma20, fxInfo.rate), 2),
    devPct: round((price / ma20 - 1) * 100, 2),
    trend,
    atrUsdOz: atrRaw ? round(atrRaw, 1) : null,
    atrCnyGram: atrRaw ? round(toCnyGram(atrRaw, fxInfo.rate), 2) : null,
    asOf: bars[bars.length - 1].ct,
  };
}
