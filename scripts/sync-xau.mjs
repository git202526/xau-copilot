/**
 * sync-xau.mjs —— 把 XAUUSD（伦敦金现）日线快照落到 data/xauusd.json
 * 数据来源：新浪财经全球期货日线（XAU，服务端直连，无 CORS 限制）
 * 现价：api.gold-api.com/price/XAU（与同花顺「伦敦金现」同品种，用于口径核对）
 *
 * 为什么不在浏览器里直接抓新浪：一次返回 5000+ 根、约 690KB，手机端不划算。
 * 这里由 Actions 剪成最近 60 根，前端只取 MA20 需要的部分；现价仍由前端实时拉。
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { computeRating } from "../src/core/rating.js";

const SINA =
  "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/xauSync=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=XAU";
const SPOT = "https://api.gold-api.com/price/XAU";
const OUT = "data/xauusd.json";
const KEEP = 60;

const UA = { "User-Agent": "Mozilla/5.0 (compatible; xau-copilot-sync/1.0)", Referer: "https://finance.sina.com.cn/" };

function parseSina(text) {
  const m = String(text).match(/=\((\[[\s\S]*\])\)/);
  if (!m) throw new Error("新浪返回格式异常");
  const arr = JSON.parse(m[1]);
  if (!Array.isArray(arr) || arr.length < 30) throw new Error(`日线不足（${arr.length}）`);
  return arr.map((r) => ({
    d: r.date,
    o: +r.open,
    h: +r.high,
    l: +r.low,
    c: +r.close,
  })).filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
}

const sinRes = await fetch(SINA, { headers: UA });
if (!sinRes.ok) {
  console.error(`[xau] 新浪日线 HTTP ${sinRes.status}`);
  process.exit(1);
}
const bars = parseSina(await sinRes.text());
const tail = bars.slice(-KEEP);

let spot = null;
let spotAt = null;
try {
  const r = await fetch(SPOT, { headers: UA });
  if (r.ok) {
    const j = await r.json();
    spot = Number(j.price) || null;
    spotAt = j.updatedAt || null;
  }
} catch (e) {
  console.warn("[xau] 现价源不可用，用最后一根日线收盘代替：" + e.message);
}
if (!spot) {
  spot = tail[tail.length - 1].c;
  spotAt = null;
}

/* 评级只在服务端计算：前端只读结果，绝不自己拉 K 线造指标 */
const closed = tail.filter((b) => b.d !== new Date().toISOString().slice(0, 10));
const rating = computeRating(closed);
const ratingDoc = {
  symbol: "XAUUSD",
  provider: "local:rating.js",
  method: "MA5/10/20/50 + RSI14 + MACD + Stoch + CCI + W%R 加权投票（TradingView 口径）",
  ok: rating.ok,
  score: rating.score,
  label: rating.label,
  buy: rating.buy,
  sell: rating.sell,
  neutral: rating.neutral,
  detail: rating.detail,
  lastBar: closed.length ? closed[closed.length - 1].d : null,
  at: new Date().toISOString(),
};

const doc = {
  symbol: "XAUUSD",
  provider: "sina:XAU",
  bars: tail,
  spot,
  spotSource: spotAt ? "gold-api" : "sina-close",
  spotAt,
  asOf: new Date().toISOString(),
  note: "日线为伦敦金现（XAU），最后一根为当日未收盘 K，前端计算 MA20 时会剔除",
};

const next = JSON.stringify(doc, null, 2) + "\n";
const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
// 只在「日线有变化」或「首次缺失现价」时提交：现价由前端实时拉，没必要每 15 分钟刷一次仓库
const sameBars = (() => {
  try {
    const p = JSON.parse(prev || "{}");
    return JSON.stringify(p.bars) === JSON.stringify(doc.bars) && Number(p.spot) > 0;
  } catch (_) {
    return false;
  }
})();

/* 评级独立写盘：评分变了也要更新，避免「日线没动但评级漂移」时前端读到旧分 */
const ROUT = "data/rating.json";
const rPrev = existsSync(ROUT) ? readFileSync(ROUT, "utf8") : "";
const ratingSame = (() => {
  try {
    const p = JSON.parse(rPrev || "{}");
    return p.score === ratingDoc.score && p.label === ratingDoc.label && p.lastBar === ratingDoc.lastBar;
  } catch (_) {
    return false;
  }
})();
if (!ratingSame) {
  writeFileSync(ROUT, JSON.stringify(ratingDoc, null, 2) + "\n");
  console.log(`[xau] 评级写入 ${ratingDoc.score} / ${ratingDoc.label}（买${ratingDoc.buy} 卖${ratingDoc.sell}）`);
}

if (sameBars) {
  console.log("[xau] 日线无变化，跳过写入");
  process.exit(0);
}
writeFileSync(OUT, next);
console.log(`[xau] 写入 ${tail.length} 根日线，现价 ${spot}（${doc.spotSource}）`);
