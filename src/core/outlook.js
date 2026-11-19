/**
 * 展望引擎（v2.9.0）：把「一句结论」拆成 定调 → 分层依据 → 关键位 → 波动区间 → 情景 → 失效条件
 *
 * 用户反馈：「首页结论不够丰富，没有层次，没有趋势判断和预测。技术面分析也过于简陋。」
 *
 * 三条硬纪律：
 *   1) 只聚合、不重算方向。每一票都来自 technical.signals 的 dir × weight，
 *      得分门槛直接取 ladder / technical 的阈值 —— 与 v2.7.0「一个数只能有一个来源」同一条纪律。
 *   2) 预测只给区间与情景概率，不给点估计。σ1 取 20 日收盘对数收益的总体标准差，
 *      多周期按 √n 扩张；收盘不足时用 σ ≈ ATR × √(π/8) 换算并标注来源。
 *   3) 概率是模型值。页面必须写明「非保证」，不许写成「必到 / 目标价」。
 *
 * 依据（调研）：ChartGuru 的 XAU/USD 工作流是 regime → key levels → momentum → invalidation；
 * 机构研究稿普遍用「区间 + 情景」代替单点预测；ATR→σ 用 √(π/8)，因为正态下 E[range] ≈ σ√(8/π)。
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const r2 = (v) => (v == null ? null : +Number(v).toFixed(2));
const OZ = 31.1034768;

/** ATR（真实波幅，日均）→ 日收益率标准差的近似换算系数 */
export const ATR_TO_SIGMA = Math.sqrt(Math.PI / 8);   // ≈ 0.6267
export const HORIZON = 5;                             // 交易日

/* ── 分层归类：键 → 层。信号自带 layer 时以自带为准（technical.js 是唯一来源） ── */
export const LAYERS = [
  { key: "trend", label: "趋势" },
  { key: "momentum", label: "动能" },
  { key: "band", label: "通道" },
  { key: "ext", label: "外部" },
];
const KEY_LAYER = {
  ma20: "trend", align: "trend",
  day: "momentum", rsi: "momentum", macd: "momentum",
  boll: "band",
  rating: "ext", macro: "ext",
};

/* ── 正态分布：erf 用 A&S 7.1.26，精度 ~1.5e-7，足够把概率算到 0.1% ── */
function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
}
function normCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** 20 日对数收益的总体标准差；不足或恒定时回退 ATR，再不行返回 none */
export function sigmaOf(closes, atr, price) {
  const arr = (Array.isArray(closes) ? closes : []).map(n).filter((v) => v != null && v > 0);
  if (arr.length >= 21) {
    const rets = [];
    for (let i = arr.length - 20; i < arr.length; i++) rets.push(Math.log(arr[i] / arr[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varr = rets.reduce((a, x) => a + (x - mean) ** 2, 0) / rets.length;   // 总体，不除 n−1
    const sd = Math.sqrt(varr);
    if (Number.isFinite(sd) && sd > 0) return { sd1: sd, src: "realized", samples: rets.length };
  }
  if (atr > 0 && price > 0) return { sd1: (atr * ATR_TO_SIGMA) / price, src: "atr", samples: 0 };
  return { sd1: null, src: "none", samples: 0 };
}

/** 关键位候选：均线 / 布林 / 20 日高低。顺序即去重优先级（同价位留先出现的） */
function levelCandidates(B, price) {
  const ind = B.indicators || {};
  const ma = ind.ma || {};
  const boll = ind.boll || {};
  const closes = (Array.isArray(B.closes) ? B.closes : []).map(n).filter((v) => v != null);
  const win = closes.slice(-20);
  const hi = win.length ? Math.max(...win) : null;
  const lo = win.length ? Math.min(...win) : null;
  const raw = [
    ["MA5", ma.ma5], ["MA10", ma.ma10], ["MA20", ma.ma20], ["MA50", ma.ma50],
    ["布林上轨", boll.upper], ["布林下轨", boll.lower],
    ["20 日高", hi], ["20 日低", lo],
  ];
  return raw
    .map(([label, v]) => ({ label, priceUsd: n(v) }))
    .filter((x) => x.priceUsd != null && x.priceUsd > 0 && price > 0)
    /* 贴线（±0.05%）的位不算关键位：它等于现价，没有距离可言 */
    .filter((x) => Math.abs(x.priceUsd / price - 1) > 0.0005);
}

/** 去重：同一价位（0.15% 内）只留最靠前的一条，避免「MA50 与布林下轨」重复占两个坑 */
function dedupe(list, tolPct = 0.15) {
  const out = [];
  for (const x of list) {
    if (out.some((y) => Math.abs(y.priceUsd / x.priceUsd - 1) * 100 < tolPct)) continue;
    out.push(x);
  }
  return out;
}

function buildLevels(B, price, fxRate) {
  const toCny = (v) => (fxRate > 0 ? +((v / OZ) * fxRate).toFixed(2) : null);
  const list = dedupe(levelCandidates(B, price));
  const decorate = (x, kind) => ({
    kind,
    label: x.label,
    priceUsd: +x.priceUsd.toFixed(2),
    priceCny: toCny(x.priceUsd),
    distPct: r2((x.priceUsd / price - 1) * 100),
  });
  /* 先按「原始距离」挑最近的 2 条，再排序输出，避免远位把近位挤掉 */
  const near = (arr) => arr.sort((a, b) => Math.abs(a.priceUsd / price - 1) - Math.abs(b.priceUsd / price - 1)).slice(0, 2);
  const res = near(list.filter((x) => x.priceUsd > price)).map((x) => decorate(x, "res"));
  const sup = near(list.filter((x) => x.priceUsd < price)).map((x) => decorate(x, "sup"));
  return [
    ...res.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct)),
    ...sup.sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct)),
  ];
}

function buildLayers(signals) {
  const acc = Object.fromEntries(LAYERS.map((l) => [l.key, { bull: 0, bear: 0, voted: 0, total: 0 }]));
  for (const s of Array.isArray(signals) ? signals : []) {
    const key = s && s.layer ? s.layer : KEY_LAYER[s && s.key];
    const slot = acc[key];
    if (!slot) continue;
    const w = n(s.weight) || 0;
    const d = n(s.dir) || 0;
    slot.total += Math.abs(w);
    if (!w || !d) continue;
    slot.voted += 1;
    if (d > 0) slot.bull += w; else slot.bear += w;
  }
  return LAYERS.map(({ key, label }) => {
    const v = acc[key];
    const bull = +v.bull.toFixed(2);
    const bear = +v.bear.toFixed(2);
    const net = +((bull - bear).toFixed(2));
    const state = net > 0.05 ? "bull" : net < -0.05 ? "bear" : "flat";
    return {
      key, label, bull, bear, voted: v.voted, net, state,
      stateText: state === "bull" ? "偏多" : state === "bear" ? "偏空" : v.voted ? "分歧" : "无票",
    };
  });
}

/** 趋势：短线看 3 日动量与 MA5/MA10 关系，中线看 MA20 斜率与均线排列 */
function buildTrend(B, price) {
  const ind = B.indicators || {};
  const ma = ind.ma || {};
  const closes = (Array.isArray(B.closes) ? B.closes : []).map(n).filter((v) => v != null);
  const maSeries = (Array.isArray(B.maSeries) ? B.maSeries : []).map(n).filter((v) => v != null);

  const m3 = closes.length >= 4 ? (price / closes[closes.length - 4] - 1) * 100 : null;
  const slope20 = maSeries.length >= 6 ? (maSeries[maSeries.length - 1] / maSeries[maSeries.length - 6] - 1) * 100 : null;

  const shortVotes = [
    m3 == null ? 0 : m3 > 0.3 ? 1 : m3 < -0.3 ? -1 : 0,
    n(ma.ma5) != null && n(ma.ma10) != null ? (ma.ma5 > ma.ma10 ? 1 : ma.ma5 < ma.ma10 ? -1 : 0) : 0,
  ];
  const midVotes = [
    slope20 == null ? 0 : slope20 > 0.2 ? 1 : slope20 < -0.2 ? -1 : 0,
    ind.align === "bull" ? 1 : ind.align === "bear" ? -1 : 0,
  ];
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const dirOf = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const s = sum(shortVotes);
  const m = sum(midVotes);

  return [
    {
      key: "short",
      h: "1–3 日",
      dir: dirOf(s),
      text: s > 0 ? "短线偏强" : s < 0 ? "短线偏弱" : "短线胶着",
      basis: m3 == null ? "3 日动量不可测" : `3 日 ${m3 > 0 ? "+" : ""}${m3.toFixed(2)}% · ${ma.ma5 != null && ma.ma10 != null ? (ma.ma5 > ma.ma10 ? "MA5 在 MA10 上" : "MA5 在 MA10 下") : "均线缺失"}`,
    },
    {
      key: "mid",
      h: "1–4 周",
      dir: dirOf(m),
      text: m > 0 ? "中线偏强" : m < 0 ? "中线偏弱" : "中线走平",
      basis: `${slope20 == null ? "MA20 斜率不可测" : `MA20 斜率 ${slope20 > 0 ? "+" : ""}${slope20.toFixed(2)}%`} · ${ind.align === "bull" ? "多头排列" : ind.align === "bear" ? "空头排列" : "排列纠缠"}`,
    },
  ];
}

function regimeOf(B, price, sigma) {
  const ind = B.indicators || {};
  const dev = n(B.devPct);
  const align = ind.align;
  let trend = "range";
  if (align === "bull" && dev != null && dev > 0) trend = "up";
  else if (align === "bear" && dev != null && dev < 0) trend = "down";
  else if (dev != null && dev > 3) trend = "up";
  else if (dev != null && dev < -3) trend = "down";

  const atr = n(B.atr14);
  const atrPct = atr > 0 && price > 0 ? (atr / price) * 100 : sigma != null ? sigma * 100 : null;
  const vol = atrPct == null ? "unknown" : atrPct < 1.2 ? "low" : atrPct > 2.4 ? "high" : "normal";

  const tLabel = { up: "上行趋势", down: "下行趋势", range: "区间震荡" }[trend];
  const vLabel = { low: "低波动", normal: "常态波动", high: "高波动", unknown: "波动未知" }[vol];
  return { trend, vol, atrPct: r2(atrPct), label: `${tLabel} · ${vLabel}`, text: tLabel, volText: vLabel };
}

/**
 * @param {{B?:object, technical?:object, ladder?:object, cfg?:object, now?:number, fxRate?:number}} arg
 */
export function buildOutlook({ B, technical, ladder, cfg = {}, now, fxRate } = {}) {
  const b = B || {};
  const t = technical || {};
  const price = n(b.priceUsdOz);
  const ind = b.indicators;

  const degrade = (reason) => ({
    ok: false,
    reason,
    priceUsd: price,
    priceCny: null,
    regime: null,
    layers: [],
    trend: [],
    levels: [],
    range: null,
    scenarios: [],
    invalidate: [],
    stance: { key: "none", text: reason },
    horizon: HORIZON,
    at: now || null,
  });

  /* 三条前置：任一不满足就不出结论。宁可少说，不可乱说。 */
  if (!b.ok || price == null || !(price > 0)) return degrade("外部行情不可用，本次不出趋势与区间结论");
  if (b.stale === true || t.scenario === "degraded") return degrade("行情已过期或指标降级，区间与情景不予输出");
  if (!ind || ind.ok !== true) return degrade("服务端技术指标快照缺失，无法计算波动区间");

  const { sd1, src, samples } = sigmaOf(b.closes, n(b.atr14), price);
  const layers = buildLayers(t.signals);
  const trend = buildTrend(b, price);
  const levels = buildLevels(b, price, n(fxRate) || 0);
  const regime = regimeOf(b, price, sd1);

  /* ── 波动区间：对数正态，σn = σ1 × √n ── */
  let range = null;
  if (sd1 != null) {
    const s5 = sd1 * Math.sqrt(HORIZON);
    /* 区间上下沿保留原始浮点：四舍五入到分会让断言与下游复算差 1e-4，
       展示层自己按 num() 收口即可。 */
    /* 带宽按 horizon 取 σ：1 日用 σ1，5 日用 σ1√5（不要用一个固定倍数糊两层） */
    const band = (k, horizon) => {
      const sd = sd1 * Math.sqrt(horizon);
      return { lo: price * Math.exp(-k * sd), hi: price * Math.exp(k * sd) };
    };
    range = {
      src,
      samples,
      horizon: HORIZON,
      sigma1Pct: sd1 * 100,
      sigma5Pct: s5 * 100,
      d1: band(1, 1),
      d5: band(1, HORIZON),
      d5w: band(2, HORIZON),
    };
  } else {
    range = { src: "none", samples: 0, horizon: HORIZON, sigma1Pct: null, sigma5Pct: null, d1: null, d5: null, d5w: null };
  }

  /* ── 三情景：以得分为方向漂移，按 5 日 σ 切三段 ──
     d ∈ [−0.5, 0.5] 表示中位落点相对现价偏移多少个 σ5；
     阈值固定在 ±0.5σ5（不含漂移），所以「低分 → 下探概率高」是单调的。 */
  const score = n(t.score);
  const d = score == null ? 0 : Math.max(-0.5, Math.min(0.5, (score - 50) / 100));
  const half = 0.5;
  const scenarios = [];
  if (range.d5) {
    const s5 = (range.sigma5Pct || 0) / 100;
    const pDown = normCdf(-half - d);
    const pUp = normCdf(-half + d);          // = 1 − Φ(half − d)，对称写法保证 d=0 时与 pDown 全等
    const pMid = 1 - pDown - pUp;
    const px = (k) => price * Math.exp(d * s5 + k * s5);
    const thrLo = price * Math.exp(-half * s5);
    const thrHi = price * Math.exp(half * s5);
    const cny = (v) => (n(fxRate) > 0 ? +((v / OZ) * fxRate).toFixed(2) : null);
    const fx0 = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    scenarios.push(
      { key: "down", label: "下探", prob: pDown, probPct: Math.round(pDown * 100), targetUsd: px(-1), targetCny: cny(px(-1)), cond: `5 日内收在 ${fx0(thrLo)} 下方` },
      { key: "mid", label: "横盘", prob: pMid, probPct: Math.round(pMid * 100), targetUsd: px(0), targetCny: cny(px(0)), cond: `${fx0(thrLo)} – ${fx0(thrHi)} 之间` },
      { key: "up", label: "反抽", prob: pUp, probPct: Math.round(pUp * 100), targetUsd: px(1), targetCny: cny(px(1)), cond: `5 日内站上 ${fx0(thrHi)}` },
    );
  }

  /* ── 失效条件：门槛必须与 M4 的 41 / 59 同源，否则两处会各说各话 ── */
  const th = (ladder && ladder.thresholds) || null;
  const neutralLo = th ? th.neutralLo : (n(cfg.techBearScore) ?? 40) + 1;
  const neutralHi = th ? th.neutralHi : (n(cfg.techBullScore) ?? 60) - 1;
  const ma5 = n((ind.ma || {}).ma5);
  const bear = t.dir < 0;
  const res = levels.find((l) => l.kind === "res");
  const sup = levels.find((l) => l.kind === "sup");
  const gate = bear ? neutralLo : neutralHi;

  const invalidate = [];
  if (score != null) {
    invalidate.push({
      text: bear
        ? `加权得分回到 ${neutralLo} 以上（当前 ${score}，差 ${Math.max(0, neutralLo - score)} 分）`
        : `加权得分回到 ${neutralHi} 以下（当前 ${score}，超 ${Math.max(0, score - neutralHi)} 分）`,
      met: bear ? score >= neutralLo : score <= neutralHi,
    });
  }
  /* 第一道线优先用 MA5：它是「短线转势」最容易被认的参照。
     MA5 已在现价错误一侧时（比如暴跌后价格仍未收复），回落到最近的阻力/支撑位。 */
  if (bear && ma5 != null && ma5 > price) {
    invalidate.push({ text: `日收盘站上 MA5 ${ma5.toFixed(2)}（${(ma5 / price - 1 > 0 ? "+" : "")}${((ma5 / price - 1) * 100).toFixed(2)}%）`, met: false });
  } else if (!bear && ma5 != null && ma5 < price) {
    invalidate.push({ text: `日收盘跌破 MA5 ${ma5.toFixed(2)}（${((ma5 / price - 1) * 100).toFixed(2)}%）`, met: false });
  } else if (bear && res) {
    invalidate.push({ text: `日收盘站上 ${res.label} ${res.priceUsd.toFixed(2)}（+${res.distPct.toFixed(2)}%）`, met: price > res.priceUsd });
  } else if (!bear && sup) {
    invalidate.push({ text: `日收盘跌破 ${sup.label} ${sup.priceUsd.toFixed(2)}（${sup.distPct.toFixed(2)}%）`, met: price < sup.priceUsd });
  }
  const hist = n(((ind.macd || {}).hist));
  if (hist != null) {
    invalidate.push({
      text: bear ? `MACD 柱由负转正（当前 ${hist.toFixed(2)}）` : `MACD 柱由正转负（当前 ${hist.toFixed(2)}）`,
      met: bear ? hist > 0 : hist < 0,
    });
  }

  /* ── 一句话行动 ── */
  const stance = (() => {
    if (t.scenario === "risk_off") return { key: "risk_off", text: "避险拦截生效：不追涨不抄底，先降杠杆" };
    if (bear) return { key: "bear", text: `暂停新增，等得分回到 ${neutralLo} 以上再谈恢复` };
    if (t.dir > 0) return { key: "bull", text: "可按档位分批参与，不追高" };
    return { key: "flat", text: `区间中轴，按原计划小步走，不猜方向` };
  })();

  return {
    ok: true,
    reason: "",
    priceUsd: price,
    priceCny: n(fxRate) > 0 ? +((price / OZ) * fxRate).toFixed(2) : null,
    score,
    dir: n(t.dir) || 0,
    regime,
    layers,
    trend,
    levels,
    range,
    scenarios,
    invalidate,
    stance,
    gate,
    horizon: HORIZON,
    at: now || null,
  };
}
