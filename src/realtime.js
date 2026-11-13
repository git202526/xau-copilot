/**
 * 金价 15 秒实时通道（v2.6.0）
 *
 * 为什么单独拉一条通道：
 *   10 分钟快照链对 10Y / DXY / VIX 够用（它们本身是分钟级更新的慢变量），
 *   但黄金在 10 分钟里可以走 5~20 美元。用户拿它对比行情软件，只会得出「卡住不动」。
 *
 * 为什么用腾讯 `qt.gtimg.cn`：
 *   1) 返回 `access-control-allow-origin: *`，浏览器可直连，不需要自建转发代理；
 *   2) 与新浪 `hf_XAU` 同源同口径（同一交易日 高 3922.99 / 低 3872.91 / 昨收 3877.43
 *      与新浪快照逐字段一致），换通道不会重演 v2.5.2「金价差太多」的口径漂移；
 *   3) 实测 12 秒采样三次有两次价格变化 → 刷新快于 15 秒，值得按 15 秒轮询。
 *   注：新浪 `hq.sinajs.cn` 无 CORS 头（返回 403），只能服务端抓，做不到秒级。
 *
 * 职责边界（铁律：单向依赖）：
 * 本模块只做「抓取 + 解析 + 节拍 + 最近一笔缓存」，不认识 DOM、不认识 state。
 *   渲染由 render.js 的 renderSpotTick 负责，装配由 main.js 调度。
 *   唯一被下游读取的出口是 getLatestSpot()。
 */
import { CONFIG } from "./config.js";

export const SPOT_URL = CONFIG.xauSpotUrl || "https://qt.gtimg.cn/q=hf_XAU";
export const SPOT_INTERVAL_MS = 15_000;
/** tick 有效期：超过即视为僵尸数据，不得覆盖 10 分钟快照 */
export const SPOT_FRESH_MS = 120_000;
const SPOT_TIMEOUT_MS = 5_000;

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * 解析外盘现货行情。腾讯与新浪是同一套 `hf_` 字段布局，只是变量名前缀不同。
 * 样本（腾讯）：v_hf_XAU="3893.54,0.42,3893.54,3893.89,3922.99,3872.91,23:12:00,3877.43,3877.21,0,0,0,2026-11-13,伦敦金（现货黄金）";
 * 样本（新浪）：var hq_str_hf_XAU="3882.48,3877.430,3882.48,3882.83,3922.99,3872.91,21:53:00,3877.43,3877.21,0,0,0,2026-11-13,伦敦金（现货黄金）";
 * 字段：0 现价 4 最高 5 最低 6 时间 7 昨收 8 今开 12 日期 13 名称
 * 注意：腾讯的 1/3 位语义与新浪不同（腾讯放涨跌幅），故一律不读 1/3 位，只用两边一致的 0/4/5/6/7/8/12。
 * @returns {{price:number,prevClose:number|null,open:number|null,high:number|null,low:number|null,at:string,date:string,time:string,source:string,name:string,recvAt:number|null}|null}
 */
export function parseSpotText(text, recvAt = null) {
  const raw = String(text == null ? "" : text);
  const m = raw.match(/="([^"]*)"/);
  if (!m || !m[1].trim()) return null;
  const f = m[1].split(",");
  if (f.length < 13) return null;

  const price = positive(f[0]);
  const date = String(f[12] || "").trim();
  const time = String(f[6] || "").trim();
  if (price == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return null;

  return {
    price,
    prevClose: positive(f[7]),
    open: positive(f[8]),
    high: positive(f[4]),
    low: positive(f[5]),
    /* 两个源的时间均为北京时间，显式带 +08:00，前端 Date.parse 不会按本地时区误判年龄 */
    at: `${date}T${time}+08:00`,
    date,
    time,
    source: /^\s*v_hf_/.test(raw) ? "tencent:hf_XAU" : "sina:hf_XAU",
    name: String(f[13] || "").trim(),
    recvAt,
  };
}

/**
 * 抓一笔现价。GBK 必须显式解码：`Response.text()` 恒按 UTF-8 解，中文名会乱码。
 * 超时强制 abort，避免一次挂死把 15 秒节拍拖垮。
 */
export async function fetchSpot(opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    url = SPOT_URL,
    timeoutMs = SPOT_TIMEOUT_MS,
    now = Date.now,
  } = opts;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${url}?_=${now()}`, {
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "?"}`);
    const buf = await res.arrayBuffer();
    let text;
    try {
      text = new TextDecoder("gbk").decode(buf);
    } catch {
      text = new TextDecoder().decode(buf);
    }
    const q = parseSpotText(text, now());
    if (!q) throw new Error("解析为空");
    return q;
  } finally {
    clearTimeout(timer);
  }
}

/* 最近一笔成功报价：整页刷新时由 sourceB 读取，避免价格在 15 秒 tick 与 60 秒整刷之间来回跳 */
let latest = null;

export function setLatestSpot(q) {
  if (q && positive(q.price) != null) latest = q;
}
export function getLatestSpot() {
  return latest;
}
export function resetLatestSpot() {
  latest = null;
}

/**
 * 定时器封装：注入式 setInt/clearInt 便于测试，真实运行时用全局定时器。
 * 失败不清空 latest —— 断网时仍要显示最后一笔真实价，而不是退回 10 分钟前的快照。
 */
export function createSpotTicker(opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    url = SPOT_URL,
    intervalMs = SPOT_INTERVAL_MS,
    timeoutMs = SPOT_TIMEOUT_MS,
    isHidden = () => false,
    onQuote = null,
    onError = null,
    now = Date.now,
    setInt = (fn, ms) => setInterval(fn, ms),
    clearInt = (id) => clearInterval(id),
  } = opts;

  let timer = null;
  let busy = false;
  let stopped = false;
  let fails = 0;

  async function tick() {
    if (stopped || busy) return null;
    if (isHidden()) return null;
    busy = true;
    try {
      const q = await fetchSpot({ fetchImpl, url, timeoutMs, now });
      fails = 0;
      setLatestSpot(q);
      if (typeof onQuote === "function") onQuote(q);
      return q;
    } catch (e) {
      fails += 1;
      if (typeof onError === "function") onError(e, fails);
      return null;
    } finally {
      busy = false;
    }
  }

  function start() {
    stopped = false;
    if (timer != null) return;
    timer = setInt(tick, intervalMs);
  }

  function stop() {
    stopped = true;
    if (timer != null) clearInt(timer);
    timer = null;
  }

  return {
    start,
    stop,
    tick,
    get fails() {
      return fails;
    },
  };
}

const fmt2 = (v) =>
  Number.isFinite(Number(v))
    ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "--";

/**
 * 视图计算（纯函数）：把 state 压成 4 个显示字段，render 层只负责赋值。
 * 涨跌一律用源给的昨收现算，不套用日线 dayPct —— 行情软件对比的就是这个数。
 */
export function spotTickView(s = {}) {
  const B = s.B || {};
  const now = Number(s.now) || Date.now();
  const price = Number(B.priceUsdOz);
  const live = String(B.spotSource || "").startsWith("tencent:");
  const prev = B.quote ? Number(B.quote.prevClose) : NaN;
  const hasBase = Number.isFinite(price) && Number.isFinite(prev) && prev > 0;
  const chg = hasBase ? ((price - prev) / prev) * 100 : null;

  const ts = Number(B.ts);
  const ageSec = Number.isFinite(ts) && ts > 0 ? Math.max(0, (now - ts) / 1000) : null;

  const hhmmss = (ms) => {
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return null;
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  /* 「x 秒前」这种相对时间在本页是无效表达：渲染时刻就是 tick 时刻，永远 0 秒。
     改显示本次更新时刻（每次 tick 都会变，肉眼能确认在跳），
     再对「3 个节拍没回来」单独判停顿，绝不假装还实时。 */
  let atText;
  if (!live) atText = "快照 · 10 分钟同步";
  else if (ageSec != null && ageSec > 45) atText = `实时停顿 · 已 ${Math.round(ageSec)} 秒未更新`;
  else {
    const t = Number.isFinite(ts) ? hhmmss(ts) : null;
    atText = t ? `实时 · ${t} 更新` : "实时";
  }

  /* 先按两位小数定值，再判方向：-0.004% 若直接 toFixed 会显示成「-0.00%」，
     既是假信号又难看。四舍五入到 0 就按平盘处理。 */
  const chg2 = chg == null ? null : Math.abs(chg) < 0.005 ? 0 : +chg.toFixed(2);

  return {
    live,
    priceText: fmt2(price),
    chgText: chg2 == null ? "--" : `${chg2 > 0 ? "+" : ""}${chg2.toFixed(2)}%`,
    chgTone: chg2 == null ? "flat" : chg2 > 0 ? "up" : chg2 < 0 ? "dn" : "flat",
    atText,
    ageSec,
  };
}
