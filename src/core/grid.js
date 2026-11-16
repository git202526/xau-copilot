/**
 * 网格效率与熔断
 *
 * 判定（优先级从高到低）：
 *   1) 外部技术面偏空（techDir<0）→ 熔断，暂停自动买入
 *   2) ATR14 < 档距 × 0.7        → 效率下降，触发频率低
 *   3) 其余                       → 正常
 *
 * v2.7.0：档距不再自己算。旧实现把档距写死成「区间均分」，
 *   与老应用的 α×ATR / 目标反解两种口径对不上（实测同一份 cfg 差 85 美元/档，
 *   第 5 档 3275.9 vs 3618.59），现统一取 core/gear.js 算出的 d（与老应用逐档对齐），
 *   本文件只做判定与透传。
 * 单位：档距以 $/oz 给出，展示时统一折成 元/克（不混单位）。
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const OZ = 31.1034768;

export function assessGrid({ A, gear = null, atrUsdOz, fx, priceUsdOz, techDir = 0 }) {
  const plan = (A && A.plan) || {};
  /* 档距口径：优先 gear（老应用同口径）；无 gear 时回退历史字段，仅为老调用方兼容 */
  const spacingUsd = gear && gear.d != null ? n(gear.d) : n(plan.baseSpacing);
  const levels = (gear && gear.levels && gear.levels.length ? gear.levels : plan.levels) || [];
  const atr = n(atrUsdOz);
  const rate = n(fx);

  const toCny = (v) => (v != null && rate > 0 ? (v / OZ) * rate : null);
  const spacingCny = toCny(spacingUsd);
  const atrCny = toCny(atr);

  const ratio = spacingUsd > 0 && atr != null ? atr / spacingUsd : null;

  let state = "ok";
  let tone = "gray";
  let title = "网格正常";
  let text = "";

  if (techDir < 0) {
    state = "fuse";
    tone = "amber";
    title = "熔断警告";
    text = "外部技术面偏空，继续按网格自动买入等于持续接飞刀。建议暂停后续自动买入，等技术面转为中性再恢复。";
  } else if (ratio != null && ratio < 0.7) {
    state = "low";
    tone = "amber";
    title = "效率下降";
    text = `外部 ATR14 仅 ${atrCny != null ? atrCny.toFixed(2) : "--"} 元/克，低于档距 ${spacingCny != null ? spacingCny.toFixed(2) : "--"} 的 70%。价格波动撑不满一格，触发频率会明显下降，建议缩小档距或观望。`;
  } else if (ratio != null) {
    state = "ok";
    tone = "gray";
    title = "网格正常";
    text = `ATR14 为档距的 ${(ratio * 100).toFixed(0)}%，波动足以覆盖单档，自动网格可正常运转。`;
  } else {
    state = "unknown";
    tone = "gray";
    title = "网格数据不全";
    text = "缺少档距或 ATR，无法评估网格效率。";
  }

  return {
    ok: ratio != null,
    state,
    tone,
    title,
    text,
    ratio,
    ratioPct: ratio != null ? +(ratio * 100).toFixed(0) : null,
    spacingUsd,
    spacingCny: spacingCny != null ? +spacingCny.toFixed(2) : null,
    atrUsd: atr,
    atrCny: atrCny != null ? +atrCny.toFixed(2) : null,
    levels,
    gearCount: (gear && gear.n) || plan.gearCount || null,
    highBase: (gear && gear.highBase) || plan.highBase || null,
    startDrop: (gear && gear.startDrop) || plan.startDrop || null,
    endDrop: (gear && gear.endDrop) || plan.endDrop || null,
    /* 口径与档位执行事实（v2.7.0）：卡面要能解释「这个档距怎么来的」 */
    mode: gear ? gear.mode : null,
    modeLabel: gear ? gear.modeLabel : null,
    alpha: gear ? gear.alpha : null,
    spanSrc: gear ? gear.spanSrc : null,
    atrBase: gear ? gear.atrBase : null,
    clamped: Boolean(gear && gear.clamped),
    capD: gear ? gear.capD : null,
    budget: gear ? gear.budget : null,
    unmarked: gear ? gear.unmarked : null,
    nextIdx: gear ? gear.nextIdx : null,
    sumPlan: gear ? gear.sumPlan : null,
    sumPending: gear ? gear.sumPending : null,
    realloc: gear ? gear.realloc : null,
    target: gear ? gear.target : null,
    targetEff: gear ? gear.targetEff : null,
    openIdx: -1,
    fuse: state === "fuse",
  };
}
