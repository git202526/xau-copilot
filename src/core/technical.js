/**
 * 纯外部技术面判断引擎（v2.3.0）
 *
 * 用户指令：「不要内外部双印证了，只搜集外部实时行情指标做出判断」。
 * 本引擎只消费 Source B（XAUUSD 外部行情 + 服务端预算指标）与 Source C（宏观），
 * 完全不读取老应用（Source A）的任何数据，也不接受内部趋势符号。
 *
 * 与 confidence.js 的双印证引擎彻底解耦：
 *   - 老引擎 decide() 继续服务 M0 / M6 / 风控 / FOMO（本次范围「只改 M2」，不动它们）
 *   - 本引擎 decideTechnical() 只服务 M2，产出 s.technical
 *
 * 指标维度（全部来自外部）：
 *   现价 / MA20 偏离 / 日内涨跌 / ATR14 / RSI14 / MACD 柱与交叉 /
 *   布林 %B / 多周期均线排列 / 外部综合评级 / DXY·10Y·VIX 宏观
 *
 * 优先级（单向，从高到低）：
 *   源异常/僵尸/指标缺失 → VIX 避险 → 加权投票 → 中轴
 *
 * 输出场景：tech_bull / tech_bear / tech_neutral / risk_off / degraded
 */

import { ratingZh } from "./labels.js";

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const r2 = (v) => (v == null ? null : +Number(v).toFixed(2));

/** 阈值兜底（可被 cfg 覆盖，配置集中于 config.js 的 tech* 键） */
const DEF = {
  bullScore: 60,          // 加权多头得分 ≥ 此值 → 偏多
  bearScore: 40,          // ≤ 此值 → 偏空
  rsiHigh: 70, rsiLow: 30,
  pctBHigh: 0.8, pctBLow: 0.2,
};

/** 把 config.js 的 tech* 命名映射到内部 DEF 键；也兼容直接传 DEF 键（测试用） */
function resolveThresholds(cfg = {}) {
  const c = cfg || {};
  const pick = (internal, external) => {
    const v = n(c[external] != null ? c[external] : c[internal]);
    return v == null ? DEF[internal] : v;
  };
  return {
    bullScore: pick("bullScore", "techBullScore"),
    bearScore: pick("bearScore", "techBearScore"),
    rsiHigh: pick("rsiHigh", "techRsiHigh"),
    rsiLow: pick("rsiLow", "techRsiLow"),
    pctBHigh: pick("pctBHigh", "techPctBHigh"),
    pctBLow: pick("pctBLow", "techPctBLow"),
  };
}

/** 单指标方向：把原始值映射为 -1 / 0 / +1，异常一律归 0（防呆） */
function sign(v) {
  const x = n(v);
  if (x == null || x === 0) return 0;
  return x > 0 ? 1 : -1;
}

/**
 * 构造外部指标清单（供 M2 网格展示 + 加权投票）
 * 每项：{ key, label, value(展示文本), dir(-1|0|1), note, weight }
 * v2.3.1 配色语义分层：kind=change（纯数值涨跌）用红涨绿跌；
 *   kind=judge（方向判断）用红绿以外的中性色；kind=neutral 不着色。
 */
function buildSignals(B, C, cfg) {
  const th = resolveThresholds(cfg);
  const K = B.indicators || {};
  const rsi14 = n(K.rsi14);
  const hist = K.macd ? n(K.macd.hist) : null;
  const pctB = K.boll ? n(K.boll.pctB) : null;
  const align = K.align || null;
  const ratingScore = B.ratingOk && B.rating ? n(B.rating.score) : null;
  const fx = (v, d = 2) => (v == null ? "--" : Number(v).toFixed(d));

  const list = [];
  /* kind 由指标语义决定，调用方无需改动：纯数值涨跌 / 方向判断 / 中性展示 */
  const CHANGE_KEYS = new Set(["ma20", "day", "macd"]);
  const NEUTRAL_KEYS = new Set(["price", "atr"]);
  const kindOf = (key) => NEUTRAL_KEYS.has(key) ? "neutral" : CHANGE_KEYS.has(key) ? "change" : "judge";
  const add = (key, label, value, dir, note, weight = 1) =>
    list.push({ key, label, value, dir, note: note || "", kind: kindOf(key), weight });

  /* 1 现价（$/oz）—— 中性展示位 */
  add("price", "伦敦金现 $/oz", B.priceUsdOz == null ? "--" : Number(B.priceUsdOz).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 0, B.spotSource === "gold-api" ? "实时现价" : "快照价", 0);

  /* 2 MA20 偏离 */
  add("ma20", "MA20 偏离", `${B.devPct == null ? "--" : (B.devPct > 0 ? "+" : "") + fx(B.devPct)}%`, sign(B.trend),
    B.ma20UsdOz == null ? "" : `MA20 ${Number(B.ma20UsdOz).toFixed(2)}`, 1.2);

  /* 3 日内涨跌 */
  add("day", "日内涨跌", `${B.dayPct == null ? "--" : (B.dayPct > 0 ? "+" : "") + fx(B.dayPct)}%`, sign(B.dayPct), "对昨收", 1);

  /* 4 ATR14 波动率（中性，仅展示） */
  add("atr", "ATR14 $/oz", B.atr14 == null ? "--" : fx(B.atr14, 1), 0, "日均波幅", 0);

  /* 5 RSI14 */
  let rsiDir = 0, rsiNote = "中性区";
  if (rsi14 != null) {
    if (rsi14 >= th.rsiHigh) { rsiDir = -1; rsiNote = "超买，防回撤"; }
    else if (rsi14 <= th.rsiLow) { rsiDir = 1; rsiNote = "超卖，待企稳"; }
    else { rsiDir = rsi14 > 50 ? 1 : -1; rsiNote = rsi14 > 50 ? "偏强" : "偏弱"; }
  }
  add("rsi", "RSI14", rsi14 == null ? "--" : fx(rsi14, 1), rsiDir, rsiNote, 1);

  /* 6 MACD 柱 + 交叉 */
  const cross = K.macd ? K.macd.cross : "none";
  add("macd", "MACD 柱", hist == null ? "--" : (hist > 0 ? "+" : "") + fx(hist),
    sign(hist), cross === "golden" ? "金叉" : cross === "death" ? "死叉" : "柱向", 1.2);

  /* 7 布林 %B */
  let bollDir = 0, bollNote = "带内中轴";
  if (pctB != null) {
    if (pctB >= th.pctBHigh) { bollDir = -1; bollNote = "触上轨"; }
    else if (pctB <= th.pctBLow) { bollDir = 1; bollNote = "触下轨"; }
    else { bollDir = pctB > 0.5 ? 1 : -1; bollNote = pctB > 0.5 ? "上半带" : "下半带"; }
  }
  add("boll", "布林 %B", pctB == null ? "--" : fx(pctB), bollDir, bollNote, 1);

  /* 8 多周期均线排列 */
  add("align", "均线排列", align === "bull" ? "多头排列" : align === "bear" ? "空头排列" : align === "mixed" ? "纠缠" : "--",
    align === "bull" ? 1 : align === "bear" ? -1 : 0, "MA5/10/20/50", 1.5);

  /* 9 外部综合评级（服务端预算，非必需项） */
  const ratingDir = ratingScore == null ? 0 : ratingScore >= 55 ? 1 : ratingScore <= 45 ? -1 : 0;
  add("rating", "技术评级", B.ratingOk && B.rating ? `${ratingZh(B.rating.label)} ${ratingScore}` : "未评级",
    ratingDir, "服务端预算", 1);

  /* 10 宏观 DXY / 10Y / VIX */
  const cDir = n(C && C.dir) || 0;
  add("macro", "宏观风向", cDir > 0 ? "顺风" : cDir < 0 ? "逆风" : "中性",
    cDir > 0 ? 1 : cDir < 0 ? -1 : 0, C && C.label ? C.label : "DXY·10Y·VIX", 0.8);

  return list;
}

function degraded(headline, text, signals) {
  return {
    scenario: "degraded", conf: "degraded", tone: "gray", dir: 0, score: null,
    headline, text, detail: "仅外部行情 · 不出方向", signals: signals || [],
  };
}

/**
 * 纯外部判断。签名刻意不含 aSign / Source A，从架构上杜绝双印证回流。
 * @param {{B?:object, C?:object, stale?:boolean, cfg?:object}} arg
 */
export function decideTechnical({ B = null, C = null, stale = false, cfg = {} } = {}) {
  const th = resolveThresholds(cfg);
  const Cx = C || {};

  /* 优先级 1：外部行情源不可用 → 降级，绝不白屏、绝不给方向 */
  if (!B || B.ok === false) {
    return degraded("外部行情不可用", "外部实时行情源读取失败，本次判断作废。请检查网络或稍后刷新，系统已保留页面其余数据。", []);
  }
  /* 优先级 2：僵尸数据 */
  if (stale || B.stale === true) {
    return degraded("源数据异常，降级处理", "外部行情超过新鲜度阈值，已判为僵尸数据。本次不出方向结论，刷新后再看。", []);
  }
  /* 优先级 3：服务端指标缺失（快照未回填 / 同步失败） */
  if (!B.indicators || B.indicators.ok !== true) {
    return degraded("外部指标缺失", "服务端技术指标快照尚未就绪，无法完成外部技术面判断。请等待数据同步后刷新，绝不凭单项价格臆断。", []);
  }

  const signals = buildSignals(B, Cx, cfg);

  /* 优先级 4：VIX 暴涨 → 宏观避险，技术面失效 */
  if (Cx.mode === "risk_off") {
    return {
      scenario: "risk_off", conf: "low", tone: "violet", dir: 0, score: null,
      headline: "避险模式",
      text: "VIX 单日暴涨逾 20%，外部宏观进入恐慌定价。技术面信号此时容易失效，先降杠杆、留子弹，不追涨不抄底。",
      detail: "宏观极值拦截优先于技术信号", signals,
    };
  }

  /* 加权投票：只统计 dir≠0 且 weight>0 的项 */
  let bull = 0, bear = 0, voted = 0;
  for (const s of signals) {
    if (!s.weight || s.dir === 0) continue;
    voted += 1;
    if (s.dir > 0) bull += s.weight; else bear += s.weight;
  }
  const total = bull + bear;
  const score = total > 0 ? Math.round((bull / total) * 100) : 50;
  const conf = voted >= 7 && Math.abs(score - 50) >= 30 ? "high" : voted >= 5 ? "medium" : "low";

  if (score >= th.bullScore) {
    return {
      scenario: "tech_bull", conf, tone: "amber", dir: 1, score,
      headline: "外部技术面偏多",
      text: `${bull.toFixed(1)} / ${total.toFixed(1)} 权重的外部指标同向偏多，价格站上均线、动能与评级一致。按计划分批参与，不追高。`,
      detail: `外部指标得分 ${score} / 100`, signals,
    };
  }
  if (score <= th.bearScore) {
    return {
      scenario: "tech_bear", conf, tone: "indigo", dir: -1, score,
      headline: "外部技术面偏空",
      text: `${bear.toFixed(1)} / ${total.toFixed(1)} 权重的外部指标同向偏空，均线压制、动能转弱。减少逆势补仓，等信号收敛。`,
      detail: `外部指标得分 ${score} / 100`, signals,
    };
  }
  return {
    scenario: "tech_neutral", conf: "low", tone: "gray", dir: 0, score,
    headline: "外部信号胶着",
    text: `外部指标多空各半（得分 ${score} / 100），未形成一致方向。区间中轴，多看少动，等信号收敛。`,
    detail: `外部指标得分 ${score} / 100`, signals,
  };
}

/** 置信度徽章（渲染层复用，与历史引擎取值一致） */
export const BADGE = {
  high: { text: "高", cls: "b-high" },
  medium: { text: "中", cls: "b-mid" },
  low: { text: "低", cls: "b-low" },
  degraded: { text: "降级", cls: "b-deg" },
};

export { DEF as TECHNICAL_THRESHOLDS, resolveThresholds, buildSignals, sign };
