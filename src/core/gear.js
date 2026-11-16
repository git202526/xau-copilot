/**
 * 档位引擎 —— 老应用 XAU Desk 的「建仓阶梯」口径移植
 *
 * 为什么要有这个文件（v2.7.0）：
 *   旧实现把档距写死成「区间均分」= H×(终止−起始)/100/(n−1)，
 *   而老应用有 3 种档距方式（α×ATR / 目标均价反解 / 区间均分）+ 终止跌幅夹取。
 *   实测同一份 cfg（α 1.16、ATR14 90.51）：老应用档距 105、第 5 档 3618.59，
 *   旧实现档距 190.7、第 5 档 3275.9 —— 差 343 美元，用户一眼看出「不准」。
 *
 * 口径来源（逐函数对照老应用源码，不自行发明）：
 *   p1     = H × (1 − startDrop/100)                  ← 第 1 档锚在起始跌幅
 *   d      = α×ATR14 | (p1 − 目标)/frontCenter(w,k) | (终止−起始)/100×H/(n−1)
 *   capD   = (终止−起始)/100×H/(n−1)                  ← 只压不拉，越界才夹
 *   预算   = TOTAL − 未标记档位持仓                     ← 已标档的持仓由该档 bought 自然扣
 *   计划   = 预算 × w_i/Σw，再按配额下沉挪动跌破档的待补
 *   已补   = gearMarks[i].g − gearMarks[i].sold（净持仓）
 *
 * 与老应用的两处**有意**偏差（都写在注释里，不是漏做）：
 *   1) 配额下沉的「滞回」状态需要跨帧记忆；本应用每次重算无状态，
 *      统一按「现价 ≤ 档位价×0.99 即失效」判定。只在 0.3%~1% 的临界带里差一档，方向不受影响。
 *   2) 目标反解失败（目标高于第 1 档 / 无剩余仓位 / 重心为 0）时，老应用把档距置 0 并报错；
 *      本应用改为回退 α 排档并在卡面上标「目标不可达」，避免整列档位价重叠成一个数。
 *
 * 单位：档位价一律 $/oz（与老应用一致）；克重一律克；折算人民币只用 priceCnyGram。
 */

/** 与老应用同值：31.1035（不是 31.1034768）。差 7e-7 会让逐档价在第 6 档漂 0.01，对不齐就白改 */
export const OZ_PER_G = 31.1035;

const ALPHA_MIN = 0.6;
const ALPHA_MAX = 3.5;
const ALPHA_DEF = 1;
const START_DROP_DEF = 13;
const START_DROP_MIN = 5;
const START_DROP_MAX = 40;
const END_DROP_DEF = 25;
const END_DROP_MIN = 8;
const END_DROP_MAX = 60;
const REALLOC_MAXDROP_DEF = 3;
const DEAD_GAP = 0.01;
const GEAR_MIN = 6;
const GEAR_MAX = 10;

/* 分档权重模板（老应用同表）：切档数时不至于给出一个塌掉的分布 */
const W_TEMPLATE = {
  6: [8, 12, 24, 36, 12, 8],
  7: [6, 9, 14, 20, 21, 17, 13],
  8: [5, 7, 11, 16, 20, 18, 14, 9],
  9: [4, 6, 10, 14, 17, 18, 15, 10, 6],
  10: [4, 5, 8, 11, 14, 16, 17, 13, 8, 4],
};

const num = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const pos = (v) => {
  const x = num(v);
  return x != null && x > 0 ? x : null;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function gearTemplate(n) {
  return (W_TEMPLATE[n] || W_TEMPLATE[6]).slice();
}

/** 权重归一化：长度不符 / 有负数 / 合计为 0 一律静默回模板（老应用同规则） */
export function normW(arr, n) {
  const tpl = gearTemplate(n);
  if (!Array.isArray(arr) || arr.length !== n) return tpl;
  let sum = 0;
  const out = [];
  for (const v of arr) {
    const x = num(v);
    if (x == null || x < 0) return tpl;
    out.push(x);
    sum += x;
  }
  return sum > 0 ? out : tpl;
}

/** 重心 ī = Σw_i·i / Σw_i（i 从 0 起） */
function wCenter(w) {
  let s = 0;
  let a = 0;
  w.forEach((v, i) => {
    s += v;
    a += v * i;
  });
  return s > 0 && a / s > 1e-9 ? a / s : null;
}

/** 前 1..k 档的权重重心：目标反解要的是「前 k 档买完的均价」，不是某一档单档价 */
export function frontCenter(w, k) {
  const kk = Math.max(1, Math.floor(num(k) || 1));
  let s = 0;
  let a = 0;
  for (let i = 0; i < Math.min(kk, w.length); i++) {
    s += w[i];
    a += w[i] * i;
  }
  if (!(s > 0)) return 0;
  return a / s;
}

function startDropOf(cfg) {
  const v = num(cfg.startDrop);
  return v != null ? clamp(v, START_DROP_MIN, START_DROP_MAX) : START_DROP_DEF;
}

function endDropOf(cfg, start) {
  const v = num(cfg.endDrop);
  const e = v != null ? clamp(v, END_DROP_MIN, END_DROP_MAX) : END_DROP_DEF;
  return e > start ? e : Math.min(END_DROP_MAX, start + 1);
}

function gearCountOf(cfg) {
  const v = Math.round(num(cfg.gearCount) || GEAR_MIN);
  return clamp(v, GEAR_MIN, GEAR_MAX);
}

/** 已补克重：只有 gearMarks 是唯一口径（老应用 P20 单模式合一） */
function boughtOf(cfg, i) {
  const m = (cfg.gearMarks || {})[String(i)];
  if (!m) return 0;
  return Math.max(0, (num(m.g) || 0) - (num(m.sold) || 0));
}

/**
 * 配额下沉：跌破的档买不到，把它的待补额度挪给同角色、未失效、未买满的档。
 * 三条硬规则与老应用一致：只挪待补、同角色内互挪、无接收方则整组撤销。
 */
export function reallocPlan(base, ctx) {
  const { price, levels, n, cfg = {}, bought } = ctx;
  const re = cfg.realloc || {};
  const eff = base.slice();
  const info = { on: re.on === true, pool: 0, from: [], to: [] };
  const px = pos(price);
  if (!info.on || px == null || !levels.length) return { eff, info };

  const ratio = clamp(num(re.ratio) ?? 1, 0.1, 1);
  const mode = re.mode === "prop" ? "prop" : "near";
  const maxDrop = clamp(num(re.maxDrop) ?? REALLOC_MAXDROP_DEF, 0.5, 20);
  const swing = Array.isArray(cfg.swingGears) ? cfg.swingGears.map(Number) : [];

  const dead = [];
  for (let i = 0; i < n; i++) {
    const p = num(levels[i].priceUsd);
    if (!(p > 0)) continue;
    if (px <= p * (1 - DEAD_GAP)) dead.push(i);
  }
  if (!dead.length) return { eff, info };

  const roles = [[], []];
  for (let i = 0; i < n; i++) roles[swing.includes(i + 1) ? 1 : 0].push(i);

  for (const idxs of roles) {
    if (idxs.length < 2) continue;                 // 单档角色没有互挪空间
    let pool = 0;
    const donors = [];
    for (const i of idxs) {
      if (!dead.includes(i)) continue;
      const give = Math.max(0, base[i] - bought(i + 1)) * ratio;
      if (give > 0.05) {
        pool += give;
        donors.push(i);
      }
    }
    if (!(pool > 0.05)) continue;

    const recv = idxs.filter((i) => !dead.includes(i) && base[i] - bought(i + 1) > 0.05);
    if (!recv.length) continue;                    // 该角色没有接收方 → 宁可不动

    for (const i of donors) eff[i] = Math.max(0, eff[i] - Math.max(0, base[i] - bought(i + 1)) * ratio);

    /* 就近：全给最接近现价的接收方；落点太深（低于现价超过 maxDrop）退化为等比 */
    const t = recv[0];
    const drop = (num(levels[t].priceUsd) / px - 1) * 100;
    if (mode === "near" && !(drop < -maxDrop)) {
      eff[t] += pool;
      info.to.push({ i: t + 1, g: pool });
    } else {
      const wsum = recv.reduce((a, i) => a + base[i], 0);
      if (wsum > 0) {
        for (const i of recv) {
          const add = (pool * base[i]) / wsum;
          eff[i] += add;
          info.to.push({ i: i + 1, g: add });
        }
      } else {
        eff[t] += pool;
        info.to.push({ i: t + 1, g: pool });
      }
    }
    info.pool += pool;
    for (const i of donors) info.from.push({ i: i + 1, g: Math.max(0, base[i] - bought(i + 1)) * ratio });
  }
  return { eff, info };
}

const MODE_LABEL = { alpha: "α×ATR", target: "目标反解", range: "区间均分" };

/**
 * 主入口：老应用 cfg + 账户事实 → 完整档位表（价 / 计划 / 已补 / 待补 / 是否下一档）
 */
export function buildGearPlan({
  cfg = {},
  unmarkedGrams = 0,
  heldGrams = null,
  avgCostCny = null,
  priceUsd = null,
  atrUsd = null,
  fx = null,
} = {}) {
  const n = gearCountOf(cfg);
  const H = pos(cfg.H_BASE);
  const startDrop = startDropOf(cfg);
  const endDrop = endDropOf(cfg, startDrop);
  const dMode = cfg.spanMode === "alpha" || cfg.spanMode === "range" ? cfg.spanMode : "target";
  const alphaCfg = num(cfg.alpha) ?? ALPHA_DEF;
  const alpha = clamp(alphaCfg, ALPHA_MIN, ALPHA_MAX);
  const px = pos(priceUsd);
  const rate = pos(fx);

  const empty = {
    ok: false, n, highBase: H, startDrop, endDrop, p1: null,
    mode: dMode, modeLabel: MODE_LABEL[dMode], spanSrc: "none", alpha,
    atrUsd: num(atrUsd), d: null, d0: null, capD: null, clamped: false, atrBase: null,
    target: num(cfg.avgTarget), targetEff: null, frontC: null, hint: "no-high",
    budget: null, unmarked: num(unmarkedGrams) || 0, weights: [], basePlan: [], plan: [], levels: [],
    nextIdx: null, sumPlan: null, sumPending: null, boughtSum: null, filledCount: 0,
    realloc: { on: cfg.realloc && cfg.realloc.on === true, pool: 0, from: [], to: [] },
    priceCny: px != null && rate != null ? (px / OZ_PER_G) * rate : null,
  };
  if (H == null || n < 2) return empty;

  const p1 = H * (1 - startDrop / 100);
  const weights = normW(cfg.wPct, n);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const atr = pos(atrUsd);

  /* ── 档距：三口径 + 终止跌幅夹取 ── */
  let d0 = null;
  let spanSrc = "none";
  let hint = "";
  let targetEff = null;
  let frontC = null;
  const target = pos(cfg.avgTarget);

  if (dMode === "range") {
    d0 = ((endDrop - startDrop) / 100) * H / (n - 1);
    spanSrc = "range";
  } else if (dMode === "alpha" || target == null) {
    const base = atr != null ? atr : 0.01 * H;
    d0 = alpha * base;
    spanSrc = atr != null ? "atr" : "fallback";
  } else {
    /* 目标反解：先把「已持仓」折成 T_eff，再除以「前 1..k 档」的权重重心 */
    let T = target;
    const held = num(heldGrams);
    const avgCny = pos(avgCostCny);
    const W = pos(cfg.TOTAL) || 100;
    if (!cfg.noCap && held != null && held > 0.01 && avgCny != null && rate != null) {
      const avgUsd = (avgCny * OZ_PER_G) / rate;
      const rest = W - held;
      if (rest > 0.01) T = (T * W - avgUsd * held) / rest;
      else {
        T = null;
        hint = "full";
      }
    }
    targetEff = T;
    const kRaw = Math.round(num(cfg.avgAnchor) || 0);
    const k = kRaw >= 2 && kRaw <= n ? kRaw : 0;
    const c = k > 0 ? frontCenter(weights, k) : wCenter(weights);
    frontC = c;
    if (T == null || c == null || c <= 0) {
      hint = hint || "no-target";
    } else if (!(T > 0)) {
      hint = "done";
    } else if (T > p1) {
      hint = "above-p1";
    } else {
      d0 = (p1 - T) / c;
      spanSrc = "target";
    }
    /* 目标不可达 / 重心调不动 → 回退 α 排档（本应用有意的降级，见文件头第 2 条） */
    if (d0 == null || !(d0 > 0)) {
      const base = atr != null ? atr : 0.01 * H;
      d0 = alpha * base;
      spanSrc = "target-fallback";
    }
  }

  const capD = ((endDrop - startDrop) / 100) * H / (n - 1);
  const clamped = d0 - capD > 0.005;
  const d = clamped ? capD : d0;

  const levels = [];
  for (let i = 0; i < n; i++) {
    const raw = p1 - i * d;
    const price = Math.round(raw * 100) / 100;
    levels.push({
      i: i + 1,
      priceUsd: price,
      dropPct: +(((1 - price / H) * 100).toFixed(2)),
      weightPct: weights[i],
      planGrams: 0,
      boughtGrams: 0,
      pendingGrams: 0,
      overGrams: 0,
      belowPrice: px != null ? price <= px : false,
      isNext: false,
      distPct: px != null ? +(((price / px - 1) * 100).toFixed(2)) : null,
      priceCny: rate != null ? +((price / OZ_PER_G) * rate).toFixed(2) : null,
      amountUsd: null,
      amountCny: null,
    });
  }

  /* ── 计划克重：可分配预算 × 权重，再按配额下沉挪动 ── */
  const TOTAL = pos(cfg.TOTAL) || 0;
  const unmarked = Math.max(0, num(unmarkedGrams) || 0);
  const budget = TOTAL > 0 ? (cfg.noCap ? TOTAL : Math.max(0, TOTAL - unmarked)) : 0;
  const basePlan = weights.map((w) => (wSum > 0 ? (budget * w) / wSum : 0));
  const { eff, info } = reallocPlan(basePlan, {
    price: px,
    levels,
    n,
    cfg,
    bought: (i) => boughtOf(cfg, i),
  });

  let sumPlan = 0;
  let sumPending = 0;
  let boughtSum = 0;
  let filledCount = 0;
  let nextIdx = null;

  levels.forEach((lv, i) => {
    const planG = +eff[i].toFixed(4);
    const boughtG = +boughtOf(cfg, lv.i).toFixed(4);
    const pending = Math.max(0, +(planG - boughtG).toFixed(4));
    const over = Math.max(0, +(boughtG - planG).toFixed(4));
    lv.planGrams = planG;
    lv.boughtGrams = boughtG;
    lv.pendingGrams = pending;
    lv.overGrams = over;
    lv.amountUsd = +(planG / OZ_PER_G * lv.priceUsd).toFixed(0);
    lv.amountCny = rate != null ? +(planG * (lv.priceUsd / OZ_PER_G) * rate).toFixed(0) : null;
    sumPlan += planG;
    sumPending += pending;
    boughtSum += boughtG;
    if (planG > 0 && pending <= 0.05) filledCount += 1;
    if (nextIdx == null && lv.belowPrice && pending > 0.05) nextIdx = lv.i;
  });
  if (nextIdx != null) levels[nextIdx - 1].isNext = true;

  return {
    ok: true,
    n,
    highBase: H,
    startDrop,
    endDrop,
    p1: +p1.toFixed(2),
    mode: dMode,
    modeLabel: MODE_LABEL[dMode],
    spanSrc,
    alpha,
    atrUsd: atr != null ? +atr.toFixed(2) : null,
    d: +d.toFixed(2),
    d0: d0 != null ? +d0.toFixed(2) : null,
    capD: +capD.toFixed(2),
    clamped,
    atrBase: spanSrc === "fallback" ? +(0.01 * H).toFixed(2) : atr != null ? +atr.toFixed(2) : null,
    target,
    targetEff: targetEff != null ? +targetEff.toFixed(1) : null,
    frontC: frontC != null ? +frontC.toFixed(2) : null,
    hint,
    budget: +budget.toFixed(4),
    unmarked: +unmarked.toFixed(4),
    weights,
    basePlan,
    plan: eff,
    levels,
    nextIdx,
    sumPlan: +sumPlan.toFixed(4),
    sumPending: +sumPending.toFixed(4),
    boughtSum: +boughtSum.toFixed(4),
    filledCount,
    realloc: info,
    priceCny: empty.priceCny,
  };
}
