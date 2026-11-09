/**
 * 技术指标综合评级（TradingView 同口径加权投票）
 *
 * 定位：这是「服务端预计算」模块，由 GitHub Actions 在 scripts/sync-xau.mjs 里调用，
 * 结果落盘为 data/rating.json，前端只读、不参与任何指标计算 —— 严格遵守
 * 「严禁前端拉 K 线自己算评级」的红线。
 *
 * 输入 bars: [{d|date, o|open, h|high, l|low, c|close}]，按时间升序
 * 输出 {score 0–100, label, buy, sell, neutral, detail}
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

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

function macd(closes) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  if (e12 == null || e26 == null) return null;
  const line = e12 - e26;
  // 近似信号线：用近期 MACD 序列
  const seq = [];
  for (let i = 26; i <= closes.length; i++) {
    const a = ema(closes.slice(0, i), 12), b = ema(closes.slice(0, i), 26);
    if (a != null && b != null) seq.push(a - b);
  }
  const sig = seq.length >= 9 ? ema(seq, 9) : null;
  return { line, signal: sig, hist: sig == null ? null : line - sig };
}

function stochastic(bars, p = 14) {
  if (bars.length < p) return null;
  const w = bars.slice(-p);
  const hh = Math.max(...w.map((b) => num(b.h ?? b.high)));
  const ll = Math.min(...w.map((b) => num(b.l ?? b.low)));
  const c = num(w[w.length - 1].c ?? w[w.length - 1].close);
  if (!(hh > ll)) return null;
  return ((c - ll) / (hh - ll)) * 100;
}

function cci(bars, p = 20) {
  if (bars.length < p) return null;
  const tp = bars.slice(-p).map((b) => (num(b.h ?? b.high) + num(b.l ?? b.low) + num(b.c ?? b.close)) / 3);
  const ma = tp.reduce((a, b) => a + b, 0) / p;
  const md = tp.reduce((a, b) => a + Math.abs(b - ma), 0) / p;
  if (!md) return null;
  return (tp[tp.length - 1] - ma) / (0.015 * md);
}

function williams(bars, p = 14) {
  const s = stochastic(bars, p);
  return s == null ? null : s - 100;
}

export function computeRating(bars) {
  const list = (Array.isArray(bars) ? bars : []).filter((b) => Number.isFinite(num(b.c ?? b.close)));
  if (list.length < 30) {
    return { ok: false, score: null, label: "样本不足", buy: 0, sell: 0, neutral: 0, detail: [], err: "不足 30 根日线" };
  }
  const closes = list.map((b) => num(b.c ?? b.close));
  const price = closes[closes.length - 1];

  const votes = [];
  const push = (name, val, bullWhen) => {
    if (val == null) return;
    const bull = bullWhen(val);
    votes.push({ name, value: +Number(val).toFixed(2), dir: bull === null ? 0 : bull ? 1 : -1 });
  };

  push("MA5", sma(closes, 5), (v) => (price > v ? 1 : price < v ? 0 : null));
  push("MA10", sma(closes, 10), (v) => (price > v ? 1 : price < v ? 0 : null));
  push("MA20", sma(closes, 20), (v) => (price > v ? 1 : price < v ? 0 : null));
  push("MA50", sma(closes, 50), (v) => (price > v ? 1 : price < v ? 0 : null));
  push("RSI14", rsi(closes), (v) => (v > 50 ? 1 : v < 50 ? 0 : null));

  const m = macd(closes);
  if (m && m.hist != null) push("MACD", m.hist, (v) => (v > 0 ? 1 : v < 0 ? 0 : null));

  push("Stoch", stochastic(list), (v) => (v > 50 ? 1 : v < 50 ? 0 : null));
  push("CCI20", cci(list), (v) => (v > 0 ? 1 : v < 0 ? 0 : null));

  const w = williams(list);
  if (w != null) push("W%R", w, (v) => (v > -50 ? 1 : v < -50 ? 0 : null));

  const bull = votes.filter((v) => v.dir === 1).length;
  const bear = votes.filter((v) => v.dir === -1).length;
  const neutral = votes.filter((v) => v.dir === 0).length;
  const total = bull + bear;
  const score = total ? Math.round((bull / total) * 100) : 50;

  const label =
    score >= 75 ? "Strong Buy" : score >= 55 ? "Buy" : score > 45 ? "Neutral" : score > 25 ? "Sell" : "Strong Sell";

  return { ok: true, score, label, buy: bull, sell: bear, neutral, price: +price.toFixed(2), detail: votes, err: null };
}

export function atr(bars, p = 14) {
  const list = (Array.isArray(bars) ? bars : []).filter((b) => Number.isFinite(num(b.c ?? b.close)));
  if (list.length < p + 1) return null;
  const trs = [];
  for (let i = 1; i < list.length; i++) {
    const h = num(list[i].h ?? list[i].high);
    const l = num(list[i].l ?? list[i].low);
    const pc = num(list[i - 1].c ?? list[i - 1].close);
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.slice(-p).reduce((a, b) => a + b, 0) / p;
}
