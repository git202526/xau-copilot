/**
 * 网格效率与熔断
 *
 * 判定（优先级从高到低）：
 *   1) 内部趋势「单边下跌」→ 熔断，暂停自动买入
 *   2) ATR14 < 档距 × 0.7    → 效率下降，触发频率低
 *   3) 其余                   → 正常
 *
 * 单位：内部档距以 $/oz 给出，展示时统一折成 元/克（不混单位）。
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const OZ = 31.1034768;

export function assessGrid({ A, atrUsdOz, fx, priceUsdOz }) {
  const plan = (A && A.plan) || {};
  const spacingUsd = n(plan.baseSpacing);
  const atr = n(atrUsdOz);
  const rate = n(fx);

  const toCny = (v) => (v != null && rate > 0 ? (v / OZ) * rate : null);
  const spacingCny = toCny(spacingUsd);
  const atrCny = toCny(atr);

  const ratio = spacingUsd > 0 && atr != null ? atr / spacingUsd : null;
  const trendText = (A && A.trend && A.trend.text) || "";

  let state = "ok";
  let tone = "gray";
  let title = "网格正常";
  let text = "";

  if (/单边下跌|单边下行/.test(trendText)) {
    state = "fuse";
    tone = "red";
    title = "熔断警告";
    text = "内部结构判定为单边下跌，继续按网格自动买入等于持续接飞刀。建议暂停后续自动买入，等结构转为震荡再恢复。";
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
    levels: plan.levels || [],
    gearCount: plan.gearCount || null,
    highBase: plan.highBase || null,
    startDrop: plan.startDrop || null,
    endDrop: plan.endDrop || null,
    fuse: state === "fuse",
  };
}
