/**
 * sync-xau.mjs —— 把 XAUUSD（伦敦金现）行情快照落到 data/xauusd.json
 *
 * 日线：新浪财经全球期货日线（XAU，服务端直连，无 CORS 限制）
 * 现价：新浪 hq.sinajs.cn `hf_XAU`（伦敦金现货黄金）
 *
 * 为什么现价也用新浪（v2.5.2 起）：
 *   旧实现现价取自 gold-api.com，实测同时刻比新浪高 3.2~8.6 美元且跳动，
 *   快照里还出现过 3909 而当时新浪约 3880，用户对比行情软件判定「差太多」。
 *   用户的老应用 XAU Desk 用的正是 `hf_XAU`，同源同口径才对得上。
 *
 * 为什么不在浏览器里直接抓新浪：`hq.sinajs.cn` 不返回 CORS 头，前端无法跨域读取；
 * 因此由本脚本在服务端抓取后落盘，前端只读快照（随同步链每 10 分钟刷新）。
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { computeRating } from "../src/core/rating.js";
import { computeIndicators } from "../src/core/indicators.js";

const SINA_KLINE =
  "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/xauSync=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=XAU";
const SINA_SPOT = "https://hq.sinajs.cn/list=hf_XAU";
const OUT = "data/xauusd.json";
const ROUT = "data/rating.json";
const KEEP = 60;

const UA = {
  "User-Agent": "Mozilla/5.0 (compatible; xau-copilot-sync/1.1)",
  Referer: "https://finance.sina.com.cn/",
};

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * 解析新浪外盘实时行情。
 * 样本：var hq_str_hf_XAU="3882.48,3877.430,3882.48,3882.83,3922.99,3872.91,21:53:00,3877.43,3877.21,0,0,0,2026-11-13,伦敦金（现货黄金）";
 * 字段：0 现价 1 买价 2 卖价 3 均价 4 最高 5 最低 6 时间 7 昨收 8 今开 12 日期 13 名称
 * @returns {{price:number,prevClose:number|null,open:number|null,high:number|null,low:number|null,at:string,date:string,time:string,source:string}|null}
 */
export function parseSinaQuote(text) {
  const m = String(text || "").match(/="([^"]*)"/);
  if (!m || !m[1].trim()) return null;
  const f = m[1].split(",");
  if (f.length < 13) return null;

  const price = positive(f[0]);
  const date = String(f[12] || "").trim();
  const time = String(f[6] || "").trim();
  if (price == null || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;

  return {
    price,
    prevClose: positive(f[7]),
    open: positive(f[8]),
    high: positive(f[4]),
    low: positive(f[5]),
    /* 新浪的时间与日期均为北京时间，显式带 +08:00，前端 Date.parse 不会误判 */
    at: `${date}T${time}+08:00`,
    date,
    time,
    source: "sina:hf_XAU",
  };
}

export function parseSinaKline(text) {
  const m = String(text).match(/=\((\[[\s\S]*\])\)/);
  if (!m) throw new Error("新浪返回格式异常");
  const arr = JSON.parse(m[1]);
  if (!Array.isArray(arr) || arr.length < 30) throw new Error(`日线不足（${arr.length}）`);
  return arr
    .map((r) => ({ d: r.date, o: +r.open, h: +r.high, l: +r.low, c: +r.close }))
    .filter((b) => [b.o, b.h, b.l, b.c].every((x) => Number.isFinite(x) && x > 0));
}

/** 新浪返回 GBK，名称字段需正确解码；解码失败不影响数值解析 */
async function fetchGbk(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

async function main() {
  let bars;
  try {
    bars = parseSinaKline(await fetchGbk(SINA_KLINE));
  } catch (e) {
    console.error(`[xau] 日线抓取失败：${e.message}`);
    process.exit(1); // 交由工作流保留上一份快照，绝不写空文件
  }
  const tail = bars.slice(-KEEP);

  /* 现价：抓不到就退回最后一根日线收盘，并明确标注来源，不冒充实时 */
  let quote;
  try {
    const q = parseSinaQuote(await fetchGbk(SINA_SPOT));
    if (!q) throw new Error("解析为空");
    quote = q;
  } catch (e) {
    console.warn(`[xau] 实时现价不可用，回退日线收盘：${e.message}`);
    const last = tail[tail.length - 1];
    quote = {
      price: last.c, prevClose: null, open: null, high: null, low: null,
      at: new Date().toISOString(), date: last.d, time: "", source: "sina:kline-close",
    };
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

  /* 技术指标一律在服务端预算（RSI14 / MACD / 布林带 / 多周期均线排列），
     前端 sourceB.js 只读 indicators，绝不拉 K 线自己算 —— 严守「严禁前端造轮子」红线。 */
  const indicators = computeIndicators(closed);

  const doc = {
    symbol: "XAUUSD",
    provider: "sina:XAU",
    bars: tail,
    spot: quote.price,          // 兼容旧字段
    spotSource: quote.source,
    spotAt: quote.at,
    quote,                       // v2.5.2：现价 + 今开/昨收/最高/最低 + 时刻
    asOf: new Date().toISOString(),
    indicators,
    note: "日线为伦敦金现（XAU），最后一根为当日未收盘 K；quote 为新浪 hf_XAU 实时快照；indicators 由服务端预算，前端只读",
  };

  const next = JSON.stringify(doc, null, 2) + "\n";
  const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

  /* 日线与现价任一变化都要落盘：现价现在由快照承载，跳过就等于前端看到旧价 */
  const { barsSame, quoteSame } = (() => {
    try {
      const p = JSON.parse(prev || "{}");
      return {
        barsSame: JSON.stringify(p.bars) === JSON.stringify(doc.bars),
        quoteSame:
          Number(p.spot) === Number(doc.spot) &&
          String(p.spotAt || "") === String(doc.spotAt) &&
          p.indicators != null && p.indicators.ok === true,
      };
    } catch {
      return { barsSame: false, quoteSame: false };
    }
  })();
  const sameBars = barsSame && quoteSame;

  /* 评级独立写盘：评分变了也要更新，避免「日线没动但评级漂移」时前端读到旧分 */
  const rPrev = existsSync(ROUT) ? readFileSync(ROUT, "utf8") : "";
  const ratingSame = (() => {
    try {
      const p = JSON.parse(rPrev || "{}");
      return p.score === ratingDoc.score && p.label === ratingDoc.label && p.lastBar === ratingDoc.lastBar;
    } catch {
      return false;
    }
  })();
  if (!ratingSame) {
    writeFileSync(ROUT, JSON.stringify(ratingDoc, null, 2) + "\n");
    console.log(`[xau] 评级写入 ${ratingDoc.score} / ${ratingDoc.label}（买${ratingDoc.buy} 卖${ratingDoc.sell}）`);
  }

  if (sameBars) {
    console.log("[xau] 日线与现价均无变化，跳过写入");
    return;
  }
  writeFileSync(OUT, next);
  console.log(
    `[xau] 写入 ${tail.length} 根日线｜现价 ${quote.price}（${quote.source}）` +
      ` 今开 ${quote.open ?? "--"} 高 ${quote.high ?? "--"} 低 ${quote.low ?? "--"} 昨收 ${quote.prevClose ?? "--"}`,
  );
}

/* 仅当被直接执行时才跑主流程；被测试 import 时只暴露纯函数，不触网 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
