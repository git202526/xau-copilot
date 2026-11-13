/**
 * 装配层：把四个源拉齐 → 跑引擎 → 产出一个只读 state
 * 渲染层只消费 state，不再做任何判断。
 */
import { CONFIG } from "./config.js";
import { loadB } from "./sourceB.js";
import { loadC, loadFx, usdOzToCnyGram, OZ_TO_GRAM } from "./sourceC.js";
import { normalizeA, degraded } from "./core/normalize.js";
import { decideTechnical } from "./core/technical.js";
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

  /* 僵尸数据须在判断前判定：超新鲜度阈值的外部数据直接废弃方向结论 */
  const staleB = isStale(B.ts, now, cfg.staleMinutes * 60 * 1000);

  /* 唯一判断源：只吃外部实时行情指标（B 行情 + 服务端预算指标 + C 宏观），
     完全不读取老应用 Source A 的任何趋势字段，从架构上杜绝内部/外部双印证。 */
  const technical = decideTechnical({
    B,
    C,
    stale: B.ok ? staleB : false,
    cfg,
  });

  /* 下游模块统一接收外部方向 technical.dir；账户事实数据（浮亏/均价/资金/档距）仍来自 A */
  const risk = assess({
    A,
    priceCnyGram,
    macro: C,
    stale: B.ok ? staleB : false,
    techDir: technical.dir,
  });

  const grid = assessGrid({ A, atrUsdOz: B.atr14, fx: fx.rate, priceUsdOz: B.priceUsdOz, techDir: technical.dir });
  const rebal = rebalance({ A, spreadPct: cfg.rebalanceSpreadPct, priceCnyGram });
  const disc = discipline({ A, techDir: technical.dir, technical });

  const dataAt = A.updatedAt || null;
  /* 新鲜度以「最近一次成功轮询」为准（meta.checkedAt）；
     旧快照没有 checkedAt 时回退到 syncedAt（内容变更时刻），保证向后兼容。 */
  const syncAt = aRes.meta
    ? Date.parse(aRes.meta.checkedAt || aRes.meta.syncedAt || 0) || null
    : null;
  /* 数据管道新鲜度以「云端同步时间」为准（Actions 定时落盘）；
     GitHub 免费仓库的 scheduled workflow 实际间隔常达数小时，账户快照用独立宽松阈值，
     避免把正常的调度延迟误报成「数据陈旧」。行情（B）仍用 15 分钟严格阈值。 */
  const staleA = syncAt != null
    ? isStale(syncAt, now, (cfg.accountStaleMinutes || 360) * 60 * 1000)
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
    technical,
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
