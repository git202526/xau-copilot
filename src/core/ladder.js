/**
 * 技术面三档成立条件（v2.8.0）
 *
 * 用户问题：「偏空出熔断 → 技术面转为中性的条件是什么？」
 * 熔断条只说「等转为中性再恢复」，没给门槛，用户无法自己判断什么时候能恢复。
 *
 * 本模块把 technical.js 的判定链拆成可以逐条打勾的条件，**不重算任何判定**：
 *   - 得分只取 technical.score（technical.js 四舍五入过的那个数）
 *   - 档位只认 technical.scenario（tech_bear / tech_neutral / tech_bull）
 *   - 阈值从 technical.js 的 resolveThresholds 取，不在这里另写一份 40 / 60
 *
 * 三档条件（每档三条，前两条是共用前置）：
 *   1 数据链正常：源可用 · 非僵尸 · 指标就绪   ← degraded 时 ✗
 *   2 无宏观避险拦截：VIX 单日 < +20%          ← risk_off 时 ✗
 *   3 得分落在本档区间
 *
 * 前置任一条 ✗ → 三档全部 ✗（technical.js 此时给 dir=0，不出方向）。
 */

import { resolveThresholds } from "./technical.js";

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const LABEL = { bear: "偏空", neutral: "中性", bull: "偏多" };
const SCENARIO_TIER = { tech_bear: "bear", tech_neutral: "neutral", tech_bull: "bull" };

/**
 * @param {object} technical  decideTechnical() 的返回值
 * @param {object} [cfg]      config.js（只用 tech* 阈值，保持与判定引擎同源）
 */
export function buildLadder(technical, cfg = {}) {
  const t = technical || {};
  const th = resolveThresholds(cfg);

  /* 阈值语义与 technical.js 完全一致：score ≥ bullScore 偏多、≤ bearScore 偏空，中间为中性 */
  const bearMax = th.bearScore;
  const bullMin = th.bullScore;
  const neutralLo = bearMax + 1;
  const neutralHi = bullMin - 1;
  const bandOk = neutralLo <= neutralHi;      // 阈值配错时中性带为空，不能静默

  const scenario = String(t.scenario || "");
  const score = n(t.score);
  const w = t.weights || {};
  const total = n(w.total) || 0;

  const dataOk = scenario !== "degraded";
  const riskOk = scenario !== "risk_off";
  const gate = dataOk && riskOk;
  const tier = gate ? SCENARIO_TIER[scenario] || null : null;

  /* ── 共用前置两条 ── */
  const dataCond = {
    id: "data",
    text: "数据链正常（源可用 · 未过期 · 指标就绪）",
    ok: dataOk,
    note: dataOk ? "" : "已降级，本轮不出方向",
  };
  const riskCond = {
    id: "risk",
    text: "无宏观避险拦截（VIX 单日 < +20%）",
    ok: riskOk,
    note: riskOk ? "" : "避险模式，方向判断暂停",
  };

  /* ── 第三条：得分区间 ── */
  const scoreText = {
    bear: `加权得分 ≤ ${bearMax}`,
    neutral: bandOk ? `加权得分 ${neutralLo} – ${neutralHi}` : "中性区间为空（阈值配置重叠）",
    bull: `加权得分 ≥ ${bullMin}`,
  };

  const scoreOk = (key) => {
    if (score == null) return false;
    if (key === "bear") return score <= bearMax;
    if (key === "neutral") return bandOk && score >= neutralLo && score <= neutralHi;
    return score >= bullMin;
  };

  const scoreNote = (key) => {
    if (score == null) return "本轮无得分";
    if (key === "bear") return score <= bearMax ? `当前 ${score}` : `当前 ${score}，需再降 ${score - bearMax} 分`;
    if (key === "neutral") {
      if (!bandOk) return "阈值重叠";
      if (score < neutralLo) return `当前 ${score}，差 ${neutralLo - score} 分`;
      if (score > neutralHi) return `当前 ${score}，超 ${score - neutralHi} 分`;
      return `当前 ${score}`;
    }
    return score >= bullMin ? `当前 ${score}` : `当前 ${score}，差 ${bullMin - score} 分`;
  };

  const tiers = ["bear", "neutral", "bull"].map((key) => ({
    key,
    label: LABEL[key],
    active: key === tier,
    conds: [
      { ...dataCond },
      { ...riskCond },
      { id: "score", text: scoreText[key], ok: scoreOk(key), note: scoreNote(key) },
    ],
  }));

  /* ── 转中性还差多少（正=要涨分，负=要跌分） ── */
  let delta = null;
  if (score != null && bandOk) {
    if (score < neutralLo) delta = neutralLo - score;
    else if (score > neutralHi) delta = neutralHi - score;
    else delta = 0;
  }
  const deltaDir = delta == null ? "none" : delta > 0 ? "up" : delta < 0 ? "down" : "none";
  /* 权重缺口：得分每 1 分 ≈ total/100 个权重单位（投票权重总和越大，单指标越难翻盘） */
  const weightsNeeded = delta == null || !(total > 0) ? null : +((Math.abs(delta) * total) / 100).toFixed(2);

  /* ── 一句话结论 ── */
  let summary;
  if (!dataOk) summary = "数据降级 · 本轮不出方向";
  else if (!riskOk) summary = "避险拦截 · 方向判断暂停";
  else if (tier && score != null) summary = `外部指标得分 ${score} / 100 → ${LABEL[tier]}成立`;
  else if (tier) summary = `${LABEL[tier]}成立`;
  else summary = score == null ? "无有效得分" : `外部指标得分 ${score} / 100`;

  /* 「个指标」比「个权重单位」好懂：RSI / 日内 / 评级 记 1，均线排列记 1.5，宏观记 0.8 */
  const wtxt = weightsNeeded != null ? `，≈ ${weightsNeeded} 个指标翻向（权重 1 计）` : "";

  /* ── 下一步动作提示 ── */
  let hint = "";
  if (!dataOk) hint = "数据恢复后重新判定，此时任何买入都缺少依据";
  else if (!riskOk) hint = "VIX 回落后再按得分判断，避险期不抢反弹";
  else if (delta === 0) hint = "已在中带：技术面中性，网格自动买入可恢复";
  else if (delta != null && delta > 0) hint = `转中性还差：需净 +${delta} 分${wtxt}由空翻多`;
  else if (delta != null && delta < 0) hint = `转中性还差：需净 ${delta} 分${wtxt}由多翻空`;
  else hint = "";

  return {
    ok: Boolean(tier),
    scenario: scenario || null,
    score,
    tier,
    delta,
    deltaDir,
    weightsNeeded,
    summary,
    hint,
    thresholds: { bearMax, neutralLo, neutralHi, bullMin },
    tiers,
  };
}
