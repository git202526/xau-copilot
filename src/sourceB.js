/**
 * Source B：外部独立行情 —— 仅 XAUUSD 伦敦金现
 *
 * 通道（同源自洽，绝不跨源混算）：
 *   1) 日线：data/xauusd.json（Actions 每 15 分钟从新浪全球期货 XAU 抓取并裁剪）
 *   2) 现价：api.gold-api.com/price/XAU（CORS 开放，无 key，60s 缓存）
 *   3) 评级：data/rating.json（Actions 侧用 src/core/rating.js 预算，前端只读）
 *
 * 不使用任何加密资产代币作为黄金代理。
 */

import { withTTL, QUOTE_TTL, MACRO_TTL, STALE_MS } from "./core/sanitize.js";

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round = (v, d = 2) => (v == null ? null : +Number(v).toFixed(d));

function maOf(closes, p) {
  if (closes.length < p) return null;
  return closes.slice(-p).reduce((a, b) => a + b, 0) / p;
}

/** 剔除当日未收盘的最后一根（UTC+0 日界，收盘价未定不参与均线） */
function dropUnclosed(bars, now) {
  if (!bars.length) return bars;
  const last = bars[bars.length - 1];
  const d = String(last.d || last.date || "");
  const today = new Date(now).toISOString().slice(0, 10);
  if (d !== today) return bars;
  const h = new Date(now).getUTCHours();
  return h >= 23 ? bars : bars.slice(0, -1);
}

async function getJSON(fetchImpl, url, opts = {}) {
  const res = await fetchImpl(url, { cache: "no-store", ...opts });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"}`);
  return res.json();
}

export async function loadB(ctx = {}) {
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  const now = ctx.now || Date.now();
  const cfg = ctx.config || {};
  const base = cfg.baseUrl || "";

  const errs = [];
  let snap = null;
  let ratingDoc = null;

  try {
    snap = await withTTL("b:snap", MACRO_TTL, () =>
      getJSON(fetchImpl, `${base}${cfg.xauUrl || "data/xauusd.json"}?t=${now}`)
    );
  } catch (e) {
    errs.push(`日线快照 ${e.message || e}`);
  }

  try {
    ratingDoc = await getJSON(fetchImpl, `${base}${cfg.ratingUrl || "data/rating.json"}?t=${now}`);
  } catch (e) {
    errs.push(`评级 ${e.message || e}`);
  }

  let spot = null;
  let spotAt = null;              // 本次实时抓取的时间戳（缓存命中时保留原抓取时刻）
  let spotSource = "snapshot";
  if (cfg.xauSpotUrl) {
    try {
      const q = await withTTL("b:spot", QUOTE_TTL, async () => {
        const j = await getJSON(fetchImpl, cfg.xauSpotUrl);
        return { price: n(j && j.price), at: now };
      });
      if (q && q.price && q.price > 100) {
        spot = q.price;
        spotAt = q.at;
        spotSource = "gold-api";
      }
    } catch (e) {
      errs.push(`实时现价 ${e.message || e}`);
    }
  }
  if (spot == null && snap && n(snap.spot) != null) {
    spot = n(snap.spot);
    spotSource = "snapshot";
    errs.push("实时现价不可用，回退快照价");
  }

  /* 服务端预算指标：前端只读透出，绝不自行计算（严禁前端造轮子）。
     缺失或降级时置 null，由 decideTechnical 统一判降级，不白屏。 */
  const indicators = snap && snap.indicators && snap.indicators.ok === true ? snap.indicators : null;

  if (!snap || !Array.isArray(snap.bars) || snap.bars.length < 21) {
    return {
      ok: false, instrument: "XAUUSD", sourceLabel: "XAUUSD 伦敦金现",
      err: errs.join("；") || "日线不足 21 根", ts: null, rating: null, ratingOk: false, trend: 0,
      indicators: null,
    };
  }

  const bars = dropUnclosed(snap.bars, now);
  const closes = bars.map((b) => n(b.c ?? b.close)).filter((v) => v != null);
  if (closes.length < 21) {
    return { ok: false, instrument: "XAUUSD", sourceLabel: "XAUUSD 伦敦金现", err: "剔除未收盘后不足 21 根", ts: null, rating: null, ratingOk: false, trend: 0, indicators: null };
  }

  const ma20 = maOf(closes, 20);
  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const price = spot != null ? spot : lastClose;

  const devPct = ma20 ? ((price - ma20) / ma20) * 100 : null;
  const dayPct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;

  const dead = n(cfg.deadZonePct) ?? 0.05;
  let trend = 0;
  if (ma20 && devPct != null) {
    if (devPct > dead) trend = 1;
    else if (devPct < -dead) trend = -1;
  }

  let atr14 = null;
  if (bars.length >= 15) {
    const trs = [];
    for (let i = 1; i < bars.length; i++) {
      const h = n(bars[i].h ?? bars[i].high), l = n(bars[i].l ?? bars[i].low);
      const pc = n(bars[i - 1].c ?? bars[i - 1].close);
      if (h != null && l != null && pc != null) trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    if (trs.length >= 14) atr14 = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
  }

  const ratingOk = Boolean(ratingDoc && ratingDoc.ok && n(ratingDoc.score) != null);
  /* 新鲜度锚点：实时现价成功 → 用本次抓取时刻；否则回退日线快照写入时刻。
     注意快照里 spotAt/asOf 是 ISO 字符串，不能用 Number() 解析（会静默变成 null）。 */
  const parseTs = (v) => {
    if (v == null || v === "") return null;
    const num = Number(v);
    if (Number.isFinite(num) && num > 0) return num;
    const dp = Date.parse(v);
    return Number.isFinite(dp) ? dp : null;
  };
  const snapTs = parseTs(snap.spotAt) ?? parseTs(snap.asOf);
  const ts = spotSource === "gold-api" && spotAt != null ? spotAt : snapTs;
  const stale = ts != null ? now - ts > STALE_MS : false;

  return {
    ok: true,
    instrument: "XAUUSD",
    sourceLabel: "XAUUSD 伦敦金现",
    priceUsdOz: round(price),
    ma20UsdOz: round(ma20),
    devPct: round(devPct),
    dayPct: round(dayPct),
    lastClose: round(lastClose),
    trend,
    bars: closes.length,
    atr14: round(atr14, 1),
    closes: closes.slice(-30),
    maSeries: closes
      .map((_, i) => (i + 1 >= 20 ? maOf(closes.slice(0, i + 1), 20) : null))
      .map((v) => (v == null ? null : +v.toFixed(2)))
      .slice(-30),
    spotSource,
    asOf: snap.asOf || null,
    ts,
    stale,
    indicators,
    ratingOk,
    rating: ratingOk
      ? { score: n(ratingDoc.score), label: ratingDoc.label, buy: ratingDoc.buy, sell: ratingDoc.sell, neutral: ratingDoc.neutral, at: ratingDoc.at || null }
      : null,
    err: errs.length ? errs.join("；") : null,
  };
}

export { dropUnclosed };
