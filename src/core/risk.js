/**
 * 实战风控与账户体检
 * - 真实浮亏强制暴露（优先 S 派生值，绝不静默归零）
 * - 预算额度防线（剩余额度 < 1.5 倍下一档 → 琥珀告警；额度为预算克重派生估算，非账户余额）
 * - 反人性锁（外部技术面偏空 + 今日买入 → FOMO 拦截）
 *
 * v2.3.0：判断源统一为外部方向 techDir，账户事实数据仍来自 Source A。
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const money = (v) =>
  v == null || !Number.isFinite(Number(v))
    ? "--"
    : Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const wan = (v) =>
  v == null || !Number.isFinite(Number(v)) ? "--" : (Number(v) / 10000).toFixed(2);

export function assess(input = {}) {
  const { A, priceCnyGram, macro, stale = false, techDir = 0, pnlOverride = null } = input;
  const price = n(priceCnyGram);
  const pos = (A && A.position) || {};
  const grams = n(pos.grams);
  const avgCost = n(pos.avgCost);
  const plan = (A && A.plan) || {};

  /* 数据可信度 */
  const trusted = !stale;
  const notice = stale ? "源数据超过新鲜度阈值，判定为僵尸数据，本次判断作废（账户事实数据仍展示）。" : "";

  /* 真实浮亏：优先外部覆盖值，其次派生，最后才是「数据缺失」 */
  let pnl = null;
  if (pnlOverride != null && Number.isFinite(Number(pnlOverride))) pnl = Number(pnlOverride);
  else if (grams != null && avgCost != null && price > 0) pnl = (price - avgCost) * grams;

  const pnlText = pnl == null ? "数据缺失" : `${pnl < 0 ? "" : "+"}${money(pnl)} 元`;
  const pnlTone = pnl == null ? "gray" : pnl < 0 ? "green" : pnl > 0 ? "red" : "gray";
  const pnlPct =
    pnl != null && avgCost > 0 && grams > 0 && price > 0
      ? ((price - avgCost) / avgCost) * 100
      : null;

  /* 压力测试：现价再跌 5% */
  const stressDrop = 0.05;
  const target = price > 0 ? price * (1 - stressDrop) : null;
  const stressLoss = grams != null && target != null ? grams * (price - target) : null;

  /* 预算额度：TOTAL 预算克重派生的估算值，老应用 Source A 无资金/余额字段 */
  const ratio = n(plan.ratio);
  const depleted = ratio != null && ratio < 1.5;
  const depletedText =
    ratio == null
      ? "计划数据不可得，无法评估补仓能力"
      : depleted
        ? `预算额度不足（估算）：剩余额度仅够 ${ratio.toFixed(2)} 档，不足 1.5 倍安全垫`
        : `预算额度充足（估算）：剩余额度可覆盖 ${Math.floor(ratio)} 档`;
  const depletedTone = ratio == null ? "gray" : depleted ? "amber" : "gray";

  /* 反人性锁：外部技术面偏空（techDir<0）仍逆势买入 → 10 秒拦截 */
  const buys = ((A && A.todayActions) || []).filter((x) => x.type === "BUY");
  const fomoLock = techDir < 0 && buys.length > 0;
  const fomoText = fomoLock
    ? `纪律扣分：外部技术面偏空仍逆势买入 ${buys.reduce((s, x) => s + x.gram, 0).toFixed(2)} 克，这是在接飞刀。`
    : "";
  const fomoCountdown = fomoLock ? 10 : 0;

  return {
    trusted,
    notice,
    pnl,
    pnlText,
    pnlTone,
    pnlPct,
    price,
    avgCost,
    grams,
    marketValue: grams != null && price > 0 ? grams * price : null,
    stressDrop,
    target,
    stressLoss,
    stressText: stressLoss == null ? "数据缺失" : `-${wan(stressLoss)} 万`,
    remainingGrams: n(plan.remainingGrams),
    remainingFunds: n(plan.remainingFunds),
    nextBuyAmount: n(plan.nextBuyAmount),
    ratio,
    depleted,
    depletedText,
    depletedTone,
    fomoLock,
    fomoText,
    fomoCountdown,
    macro: macro || null,
  };
}
