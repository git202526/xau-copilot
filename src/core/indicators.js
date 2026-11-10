/**
 * 服务端技术指标计算（RSI14 / MACD / 布林带 / 多周期均线排列）
 *
 * 定位：与 rating.js 一样，这是「服务端预计算」模块，由
 *   scripts/sync-xau.mjs（线上 Actions）与 scripts/recompute-indicators.mjs（离线回填）
 * 调用，结果写进 data/xauusd.json 的 indicators 字段。
 * 前端 sourceB.js 只读结果，绝不拉 K 线自己算 —— 严守「严禁前端造轮子」红线。
 *
 * 输入 bars: [{d|date, o|open, h|high, l|low, c|close}]，按时间升序
 * 输出 { ok, rsi14, macd, boll, ma, align, price }
 * 计算口径与 src/core/rating.js 保持一致（简单平均 RSI、EMA12/26/9 MACD）。
 */

const num = (v) => (v == null || v === "" ? NaN : Number(v));
const finite = (v) => Number.isFinite(v);
const round = (v, d = 2) => (v == null || !finite(v) ? null : +Number(v).toFixed(d));

/** 清洗收盘价：null / NaN / 非数字字符串剔除，数字字符串转数值 */
function cleanCloses(bars) {
  if (!Array.isArray(bars)) return [];
  const out = [];
  for (const b of bars) {
    if (!b || typeof b !== "object") continue;
    const c = num(b.c ?? b.close);
    if (finite(c) && c > 0) out.push(c);
  }
  return out;
}

function sma(arr, p) {
  if (arr.length < p) return null;
  return arr.slice(-p).reduce((a, b) => a + b, 0) / p;
}

function ema(arr, p) {
  if (arr.length < p) return null;
  const k = 2 / (p + 1);
  let v = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < arr.length; i++) v = arr[i] * k + v * (1 - k);
  return v;
}

/** RSI14：最近 p 根涨跌的简单平均（与 rating.js 同口径） */
function rsi(closes, p = 14) {
  if (closes.length < p + 1) return null;
  let gain = 0, loss = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / p / (loss / p);
  return 100 - 100 / (1 + rs);
}

/** MACD：构造 line 序列 → 9 期 EMA 得 signal → 柱与金叉/死叉 */
function macd(closes) {
  const lineSeq = [];
  for (let i = 26; i <= closes.length; i++) {
    const a = ema(closes.slice(0, i), 12);
    const b = ema(closes.slice(0, i), 26);
    if (a != null && b != null) lineSeq.push(a - b);
  }
  if (lineSeq.length < 2) return null;
  const line = lineSeq[lineSeq.length - 1];
  const signal = lineSeq.length >= 9 ? ema(lineSeq, 9) : lineSeq[0];
  if (signal == null) return null;
  const hist = line - signal;
  const sigPrev = lineSeq.length >= 10 ? ema(lineSeq.slice(0, -1), 9) : null;
  const prevHist = sigPrev == null ? null : lineSeq[lineSeq.length - 2] - sigPrev;
  let cross = "none";
  if (prevHist != null) {
    if (hist > 0 && prevHist <= 0) cross = "golden";
    else if (hist < 0 && prevHist >= 0) cross = "death";
  }
  return { line: round(line, 2), signal: round(signal, 2), hist: round(hist, 2), cross };
}

/** 布林带：20 期 SMA ± 2 倍总体标准差；%B 为价格在带内的相对位置 */
function bollinger(closes, p = 20) {
  if (closes.length < p) return null;
  const w = closes.slice(-p);
  const mid = w.reduce((a, b) => a + b, 0) / p;
  const variance = w.reduce((a, b) => a + (b - mid) ** 2, 0) / p;
  const sd = Math.sqrt(variance);
  const upper = mid + 2 * sd;
  const lower = mid - 2 * sd;
  const price = closes[closes.length - 1];
  const width = upper - lower;
  const pctB = width > 0 ? (price - lower) / width : 0.5;
  return {
    mid: round(mid), upper: round(upper), lower: round(lower),
    pctB: round(pctB, 3), bandwidth: round(mid > 0 ? (width / mid) * 100 : null),
  };
}

/** 多周期均线排列：MA5 > MA10 > MA20 > MA50 → 多头；反之空头；否则纠缠 */
function alignment(ma) {
  if (!ma || [ma.ma5, ma.ma10, ma.ma20, ma.ma50].some((v) => v == null)) return null;
  if (ma.ma5 > ma.ma10 && ma.ma10 > ma.ma20 && ma.ma20 > ma.ma50) return "bull";
  if (ma.ma5 < ma.ma10 && ma.ma10 < ma.ma20 && ma.ma20 < ma.ma50) return "bear";
  return "mixed";
}

const EMPTY = {
  ok: false, rsi14: null, macd: null, boll: null, ma: null, align: null, price: null, err: null,
};

/**
 * 计算全部技术指标。任何异常都降级为 ok:false，绝不抛异常、绝不泄漏 NaN。
 * 需要至少 26 根有效收盘价（MACD EMA26 的前置条件）。
 */
export function computeIndicators(bars) {
  const closes = cleanCloses(bars);
  if (closes.length < 26) {
    return { ...EMPTY, err: `有效收盘价不足 26 根（${closes.length}）` };
  }
  const price = closes[closes.length - 1];
  const ma = {
    ma5: round(sma(closes, 5)), ma10: round(sma(closes, 10)),
    ma20: round(sma(closes, 20)), ma50: round(sma(closes, 50)),
  };
  const rsi14 = round(rsi(closes));
  const macdDoc = macd(closes);
  const boll = bollinger(closes);
  const align = alignment(ma);

  const ok = [rsi14, macdDoc, boll, ma.ma20, align].every((v) => v != null);
  /* 二次防呆：任何有限性异常一律打回降级，避免脏数据把 NaN 带到前端 */
  const values = [rsi14, ma.ma5, ma.ma10, ma.ma20, ma.ma50,
    macdDoc && macdDoc.line, macdDoc && macdDoc.signal, macdDoc && macdDoc.hist,
    boll && boll.mid, boll && boll.upper, boll && boll.lower, boll && boll.pctB];
  const clean = values.every((v) => v == null || finite(v));
  if (!ok || !clean) {
    return { ...EMPTY, err: "指标计算出现不可用值，已降级" };
  }
  return {
    ok: true, rsi14, macd: macdDoc, boll, ma, align,
    price: round(price), err: null,
    at: new Date().toISOString(),
  };
}

export { cleanCloses, sma, ema, rsi, macd, bollinger, alignment };
