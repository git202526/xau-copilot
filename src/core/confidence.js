/**
 * 多维印证与置信度引擎 · 时间维度对齐（规范 §3，最高优先级）
 *
 * 三个符号 + 一个盘中维度：
 *   aSign       ← 内部日线趋势（S.feed[type=dir] 的「日线」，视为昨日日线收盘基准）
 *   bRating     ← 外部日线评级 B1（基于日线的技术评级 0–100：≥55 多 / ≤45 空 / 中间中性）
 *   intradayPct ← 外部盘中异动 B2（实时现价相对昨收涨跌 %，与日线基准不同维度）
 *   cDir        ← 宏观方向（DXY 与 10Y 同向时给出 ±1）
 *
 * 决策优先级（严格单向，从高到低）：
 *   degraded(stale / bMissing) → risk_off(vixSpike) → divergence(日线冲突)
 *   → intraday_rebound(日线共振 + 盘中反向急拉) → resonance(强共振) → neutral
 *
 * ⚠️ 时间维度对齐的关键：
 *   「真背离」只由【日线 vs 日线】比较得出（aSign vs bRating），盘中价格不参与。
 *   「盘中反抽」只在【日线已共振】的前提下，叠加一个反方向的盘中异动，
 *   它是诱空/诱多预警（黄字），不是绝对警报，也绝不判成 divergence。
 *
 * 输出场景：resonance_short / resonance_long / divergence /
 *          intraday_rebound / neutral / risk_off / degraded
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** 盘中「强」异动阈值（%）：绝对值低于该值视为日内噪声，不触发反抽 */
export const INTRADAY_SURGE_PCT = 1.0;

/** 盘中异动方向：越过阈值才返回 ±1，落在死区内或数据缺失一律归 0（防呆） */
export function intradaySurge(intradayPct, thresholdPct = INTRADAY_SURGE_PCT) {
  const p = n(intradayPct);
  const th = Number(thresholdPct) > 0 ? Number(thresholdPct) : INTRADAY_SURGE_PCT;
  if (p == null || Math.abs(p) < th) return 0;
  return p > 0 ? 1 : -1;
}

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

export function decide({
  aSign = 0,
  bRating = null,
  cDir = 0,
  vixSpike = false,
  bMissing = false,
  stale = false,
  intradayPct = null,
  surgePct = INTRADAY_SURGE_PCT,
} = {}) {
  const a = Number(aSign) || 0;
  const b = ratingSign(bRating);
  const c = Number(cDir) || 0;
  const surge = intradaySurge(intradayPct, surgePct);

  /* 僵尸数据优先级最高：超过 15 分钟未更新的外部数据不允许参与印证 */
  if (stale) {
    return {
      scenario: "degraded", conf: "degraded", tone: "gray",
      headline: "僵尸数据，印证作废",
      text: "外部数据超过 15 分钟未更新，已判定为僵尸数据，本次多源印证废弃。不输出任何方向结论，请刷新后重试。",
      aSign: a, bSign: b, cDir: c, intraday: null,
    };
  }

  if (bMissing) {
    return {
      scenario: "degraded", conf: "degraded", tone: "gray",
      headline: "外部校验失败，置信度降级",
      text: "外部技术评级不可用，本卡片结论作废。仅内部单源存在，不足以支撑任何开仓判断。",
      aSign: a, bSign: null, cDir: c, intraday: null,
    };
  }

  if (vixSpike) {
    return {
      scenario: "risk_off", conf: "low", tone: "violet",
      headline: "避险模式",
      text: "VIX 单日暴涨逾 20%，市场进入恐慌定价。此时方向判断容易失效，先降杠杆、留子弹，不追涨不抄底。",
      aSign: a, bSign: b, cDir: c, intraday: null,
    };
  }

  // 真背离（日线 vs 日线冲突）：优先级高于盘中反抽。
  // 即使盘中大涨/大跌，只要日线级别打架，仍是绝对警报，暂停交易。
  if (a !== 0 && b !== 0 && a !== b) {
    const aTxt = a < 0 ? "空头" : "多头";
    const bTxt = b < 0 ? "空头" : "多头";
    return {
      scenario: "divergence", conf: "low", tone: "amber",
      headline: "多源背离",
      text: `内部${aTxt}、外部${bTxt}，两套独立信号打架。假突破概率高，暂停建仓，等一方证伪再动。`,
      detail: `内部 ${a < 0 ? "↓ 空头" : "↑ 多头"} × 外部 ${b < 0 ? "↓ 空头" : "↑ 多头"}`,
      aSign: a, bSign: b, cDir: c, intraday: null,
    };
  }

  // 盘中假背离（反抽预警）：日线已共振，但盘中现价反向急拉。
  // surge 与共振方向相反（surge === -a）才成立；同向只是顺势，不算反抽。
  // 该场景不触发绝对警报、不进 FOMO 锁，仅黄字提示防范诱空/诱多。
  if (a !== 0 && a === b && surge !== 0 && surge === -a) {
    const short = a < 0;
    const p = n(intradayPct);
    const pctTxt = `${p > 0 ? "+" : ""}${Number(p).toFixed(2)}%`;
    return {
      scenario: "intraday_rebound", conf: "low", tone: "amber",
      headline: short ? "盘中强反抽" : "盘中急回踩",
      text: short
        ? `⚠️ 盘中强反抽，防范日线假突破，切忌盲目追空！内部日线与外部日线评级同为偏空，但盘中现价急拉 ${pctTxt}，属时间维度错配的诱空反抽，非方向反转，不触发绝对警报。`
        : `⚠️ 盘中急回踩，防范日线假突破，切忌盲目追多！内部日线与外部日线评级同为偏多，但盘中现价急跌 ${pctTxt}，属时间维度错配的诱多回踩，非方向反转，不触发绝对警报。`,
      detail: `日线共振${short ? "偏空" : "偏多"} · 盘中异动 ${pctTxt}`,
      aSign: a, bSign: b, cDir: c,
      intraday: { surge, pct: p },
    };
  }

  // 内外共振（强共振）：顺势，宏观同向时升为高置信
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
      aSign: a, bSign: b, cDir: c, intraday: null,
    };
  }

  return {
    scenario: "neutral", conf: "low", tone: "gray",
    headline: "区间中轴",
    text: "内部与外部均未给出明确方向，处于震荡中轴。多看少动，等信号收敛。",
    aSign: a, bSign: b, cDir: c, intraday: null,
  };
}

export const BADGE = {
  high: { text: "高", cls: "b-high" },
  medium: { text: "中", cls: "b-mid" },
  low: { text: "低", cls: "b-low" },
  degraded: { text: "降级", cls: "b-deg" },
};
