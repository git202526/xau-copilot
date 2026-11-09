/**
 * 多维印证与置信度引擎
 *
 * 输入三个符号：
 *   aSign  ← 内部日线趋势（S.feed[type=dir] 的「日线」）
 *   bRating← 外部技术评级 0–100（≥55 多 / ≤45 空 / 中间中性）
 *   cDir   ← 宏观方向（DXY 与 10Y 同向时给出 ±1）
 *
 * 输出场景：resonance / divergence / neutral / risk_off / degraded
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function ratingSign(rating) {
  const r = n(rating);
  if (r == null) return 0;
  if (r >= 55) return 1;
  if (r <= 45) return -1;
  return 0;
}

export function ratingLabel(rating) {
  const r = n(rating);
  if (r == null) return "未评级";
  if (r >= 75) return "Strong Buy";
  if (r >= 55) return "Buy";
  if (r > 45) return "Neutral";
  if (r > 25) return "Sell";
  return "Strong Sell";
}

export function decide({ aSign = 0, bRating = null, cDir = 0, vixSpike = false, bMissing = false, stale = false } = {}) {
  const a = Number(aSign) || 0;
  const b = ratingSign(bRating);
  const c = Number(cDir) || 0;

  /* 僵尸数据优先级最高：超过 15 分钟未更新的外部数据不允许参与印证 */
  if (stale) {
    return {
      scenario: "degraded", conf: "degraded", tone: "gray",
      headline: "僵尸数据，印证作废",
      text: "外部数据超过 15 分钟未更新，已判定为僵尸数据，本次多源印证废弃。不输出任何方向结论，请刷新后重试。",
      aSign: a, bSign: b, cDir: c,
    };
  }

  if (bMissing) {
    return {
      scenario: "degraded", conf: "degraded", tone: "gray",
      headline: "外部校验失败，置信度降级",
      text: "外部技术评级不可用，本卡片结论作废。仅内部单源存在，不足以支撑任何开仓判断。",
      aSign: a, bSign: null, cDir: c,
    };
  }

  if (vixSpike) {
    return {
      scenario: "risk_off", conf: "low", tone: "violet",
      headline: "避险模式",
      text: "VIX 单日暴涨逾 20%，市场进入恐慌定价。此时方向判断容易失效，先降杠杆、留子弹，不追涨不抄底。",
      aSign: a, bSign: b, cDir: c,
    };
  }

  // 内外背离（最需要干预的场景）
  if (a !== 0 && b !== 0 && a !== b) {
    const aTxt = a < 0 ? "空头" : "多头";
    const bTxt = b < 0 ? "空头" : "多头";
    return {
      scenario: "divergence", conf: "low", tone: "amber",
      headline: "多源背离",
      text: `内部${aTxt}、外部${bTxt}，两套独立信号打架。假突破概率高，暂停建仓，等一方证伪再动。`,
      detail: `内部 ${a < 0 ? "↓ 空头" : "↑ 多头"} × 外部 ${b < 0 ? "↓ 空头" : "↑ 多头"}`,
      aSign: a, bSign: b, cDir: c,
    };
  }

  // 内外共振
  if (a !== 0 && a === b) {
    const short = a < 0;
    const macroAgree = c !== 0 && c === a;
    return {
      scenario: short ? "resonance_short" : "resonance_long",
      conf: macroAgree ? "high" : "medium",
      tone: short ? "red" : "green",
      headline: short ? "强共振做空" : "强共振做多",
      text: short
        ? "内部通道向下 + 外部评级偏空，方向一致。按计划减仓，不接飞刀。"
        : "内部通道向上 + 外部评级偏多，方向一致。可按计划分批建仓，不追高。",
      detail: macroAgree ? "内外共振 · 宏观同向" : "内外共振 · 宏观未跟随",
      aSign: a, bSign: b, cDir: c,
    };
  }

  return {
    scenario: "neutral", conf: "low", tone: "gray",
    headline: "区间中轴",
    text: "内部与外部均未给出明确方向，处于震荡中轴。多看少动，等信号收敛。",
    aSign: a, bSign: b, cDir: c,
  };
}

export const BADGE = {
  high: { text: "高", cls: "b-high" },
  medium: { text: "中", cls: "b-mid" },
  low: { text: "低", cls: "b-low" },
  degraded: { text: "降级", cls: "b-deg" },
};
