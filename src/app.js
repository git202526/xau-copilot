/**
 * 装配层：把四个源拉齐 → 跑引擎 → 产出一个只读 state
 * 渲染层只消费 state，不再做任何判断。
 */
import { CONFIG } from "./config.js";
import { loadB } from "./sourceB.js";
import { loadC, loadFx, usdOzToCnyGram, OZ_TO_GRAM } from "./sourceC.js";
import { normalizeA, degraded } from "./core/normalize.js";
import { decide } from "./core/confidence.js";
import { assess } from "./core/risk.js";
import { assessGrid } from "./core/grid.js";
import { rebalance } from "./core/rebalance.js";
import { discipline } from "./core/discipline.js";
import { isStale, ageMinutes, premiumState } from "./core/sanitize.js";

async function getJSON(fetchImpl, url) {
  const res = await fetchImpl(url, { cache: "no-store" });
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"}`);
  return res.json();
}

/** Source A：老应用快照 + 同步元信息 */
export async function loadA(fetchImpl = globalThis.fetch, cfg = CONFIG) {
  const errs = [];
  let raw = null;
  let meta = null;
  try {
    raw = await getJSON(fetchImpl, `${cfg.dataUrl}?t=${Date.now()}`);
  } catch (e) {
    errs.push(`老应用数据 ${e.message || e}`);
  }
  try {
    meta = await getJSON(fetchImpl, cfg.dataUrl.replace(/live\.json$/, "meta.json"));
  } catch (e) {
    /* meta 缺失不致命 */
  }
  return { raw, meta, err: errs.length ? errs.join("；") : null };
}

export async function buildState(ctx = {}) {
  const now = ctx.now || Date.now();
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  const cfg = { ...CONFIG, ...(ctx.config || {}) };

  const [aRes, B, C, fx] = await Promise.all([
    loadA(fetchImpl, cfg).catch((e) => ({ raw: null, meta: null, err: String(e.message || e) })),
    loadB({ fetchImpl, now, config: cfg }).catch((e) => ({
      ok: false, instrument: "XAUUSD", err: String(e.message || e), trend: 0, ratingOk: false, rating: null, ts: null,
    })),
    loadC({ fetchImpl, now, config: cfg }).catch(() => ({ dir: 0, mode: "normal", items: [], ok: false, err: "宏观不可用" })),
    loadFx({ fetchImpl, config: cfg }).catch(() => ({ ok: false, rate: cfg.fxFallback, fallback: true, err: "汇率不可用" })),
  ]);

  const errs = [];
  if (aRes.err) errs.push(aRes.err);
  if (B.err) errs.push(B.err);
  if (C.err) errs.push(C.err);
  if (fx.err) errs.push(fx.err);

  /* 国际金 → 国内金折算：唯一允许的换算点，且只用于仓位市值与溢价率 */
  const priceCnyGram = B.ok ? usdOzToCnyGram(B.priceUsdOz, fx.rate) : null;

  const A = aRes.raw ? normalizeA(aRes.raw, { priceCnyGram, now }) : degraded(aRes.err || "老应用数据不可读");

  /* 国内参考价：取最近一笔成交价（老应用不提供独立国内实时盘口） */
  const refTrade = [...(A.todayActions || [])].sort((x, y) => y.time - x.time)[0];
  const domesticRef = refTrade ? refTrade.priceCny : null;

  const premium =
    domesticRef != null && priceCnyGram ? ((domesticRef - priceCnyGram) / priceCnyGram) * 100 : null;
  const pState = premiumState(new Date(now));

  /* 僵尸数据须在印证前判定：超 15 分钟的外部数据直接废弃方向结论 */
  const staleB = isStale(B.ts, now, cfg.staleMinutes * 60 * 1000);

  /* 时间维度对齐（规范 §3）：
     B1 外部日线评级 → bRating；B2 外部盘中异动 → intradayPct。
     B2 只在「实时现价可用」时启用：源回退到快照时，现价并非盘中真实异动，
     此时不得据此判定反抽（避免用日内噪声冒充盘中急拉）。 */
  const intradayPct = B.ok && B.spotSource === "gold-api" ? B.dayPct : null;
  const decision = decide({
    aSign: A.trend ? A.trend.sign : 0,
    bRating: B.ratingOk && B.rating ? B.rating.score : null,
    cDir: C.dir || 0,
    vixSpike: C.mode === "risk_off",
    bMissing: !B.ratingOk,
    stale: B.ok ? staleB : false,
    intradayPct,
    surgePct: cfg.intradaySurgePct,
  });

  const risk = assess({
    A,
    priceCnyGram,
    macro: C,
    stale: B.ok ? staleB : false,
    divergence: decision.scenario === "divergence",
  });

  const grid = assessGrid({ A, atrUsdOz: B.atr14, fx: fx.rate, priceUsdOz: B.priceUsdOz });
  const rebal = rebalance({ A, spreadPct: cfg.rebalanceSpreadPct, priceCnyGram });
  const disc = discipline({ A, decision });

  const dataAt = A.updatedAt || null;
  const syncAt = aRes.meta && aRes.meta.syncedAt ? Date.parse(aRes.meta.syncedAt) : null;
  /* 数据管道新鲜度以「云端同步时间」为准（Actions 每 15 分钟落盘）；
     meta 缺失时退回源数据 updatedAt，给 1 小时容忍（持仓是用户手动记账，天然不会频繁变动）。 */
  const staleA = syncAt != null
    ? isStale(syncAt, now, cfg.staleMinutes * 60 * 1000)
    : isStale(dataAt, now, 60 * 60 * 1000);

  return {
    ok: true,
    now,
    cfg,
    A, B, C, fx,
    priceCnyGram,
    domesticRef,
    premium: {
      value: premium != null ? +premium.toFixed(2) : null,
      frozen: pState.frozen,
      reason: pState.reason,
      ref: domesticRef,
      intl: priceCnyGram,
    },
    decision,
    risk,
    grid,
    rebal,
    disc,
    meta: {
      dataAt,
      syncAt,
      dataAgeMin: ageMinutes(dataAt, now),
      syncAgeMin: ageMinutes(syncAt, now),
      staleA,
      staleB,
      degraded: !A.ok || !B.ok,
      aOk: A.ok,
      bOk: B.ok,
      cOk: Boolean(C.ok),
      fxFallback: Boolean(fx.fallback),
      errs,
      fx: fx.rate,
      ozToGram: OZ_TO_GRAM,
    },
  };
}
