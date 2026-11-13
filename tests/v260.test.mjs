/**
 * v2.6.0 用例：金价 15 秒实时通道
 *
 * 用户反馈：「10 分钟够用吗？金价单独换成免费的 15 秒的源」
 *
 * 实测事实（2026-11-13 23:12 GMT+8）：
 *   1) 快照链是 10 分钟一档（GitHub Actions 自调度），对 10Y/DXY/VIX 足够，
 *      但黄金 10 分钟内可以走 5~20 美元，用户对比行情软件会觉得「卡住不动」。
 *   2) 腾讯 `qt.gtimg.cn/q=hf_XAU` 返回 `access-control-allow-origin: *`，
 *      浏览器可直连；12 秒采样三次里有两次价格变化 → 刷新 ≤15 秒，够用。
 *   3) 字段与新浪 hf_XAU 同源（同一交易日 高 3922.99 / 低 3872.91 / 昨收 3877.43 完全一致），
 *      换过来源也不会出现口径漂移（这正是 v2.5.2 用户抱怨「差太多」的根因）。
 *
 * 用例分组：
 *   P 系  解析：腾讯/新浪两种前缀，字段映射与 +08:00 时区
 *   F 系  抓取：GBK 解码、非 200 抛错、超时中断
 *   L 系  优先级：实时 tick 覆盖 10 分钟快照，过旧则不覆盖
 *   V 系  视图：实时/降级文案与红涨绿跌
 *   K 系  调度：15 秒间隔、隐藏页不拉、停止后不再拉、失败计数
 *   G 系  结构守卫：版本号、节点、配置、无反向依赖
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseSpotText,
  fetchSpot,
  createSpotTicker,
  spotTickView,
  setLatestSpot,
  getLatestSpot,
  resetLatestSpot,
  SPOT_INTERVAL_MS,
  SPOT_URL,
  SPOT_FRESH_MS,
} from "../src/realtime.js";
import { loadB } from "../src/sourceB.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(ROOT, p), "utf8");

/* 真实响应样本（2026-11-13 23:12 GMT+8 抓取，原样保留） */
const TENCENT_RAW =
  'v_hf_XAU="3893.54,0.42,3893.54,3893.89,3922.99,3872.91,23:12:00,3877.43,3877.21,0,0,0,2026-11-13,伦敦金（现货黄金）";';
const SINA_RAW =
  'var hq_str_hf_XAU="3882.48,3877.430,3882.48,3882.83,3922.99,3872.91,21:53:00,3877.43,3877.21,0,0,0,2026-11-13,伦敦金（现货黄金）";';

/** 造一个 GBK 响应：数值段 ASCII，名称段 GBK 字节（伦敦金 = c2d7b6d8bdf0） */
function gbkResponse(head, tail, status = 200) {
  const buf = Buffer.concat([
    Buffer.from(head, "latin1"),
    Buffer.from("c2d7b6d8bdf0", "hex"), // 伦敦金
    Buffer.from(tail, "latin1"),
  ]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "text/html; charset=GBK" },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString("latin1"),
    json: async () => JSON.parse(buf.toString("latin1")),
  };
}

/* ───────────────── P 解析 ───────────────── */

test("P1 腾讯格式：价格/高/低/昨收/今开/时刻全部就位", () => {
  const q = parseSpotText(TENCENT_RAW);
  assert.ok(q, "腾讯样本必须能解析");
  assert.equal(q.price, 3893.54);
  assert.equal(q.high, 3922.99);
  assert.equal(q.low, 3872.91);
  assert.equal(q.prevClose, 3877.43);
  assert.equal(q.open, 3877.21);
  /* 源时间是北京时间，必须显式带 +08:00，否则前端 Date.parse 会按本地时区误判年龄 */
  assert.equal(q.at, "2026-11-13T23:12:00+08:00");
  assert.equal(q.source, "tencent:hf_XAU");
});

test("P2 新浪格式同样可解析（换源不换口径，解析器同一套）", () => {
  const q = parseSpotText(SINA_RAW);
  assert.ok(q);
  assert.equal(q.price, 3882.48);
  assert.equal(q.prevClose, 3877.43);
  assert.equal(q.at, "2026-11-13T21:53:00+08:00");
  assert.equal(q.source, "sina:hf_XAU");
});

test("P3 脏数据一律返回 null，绝不返回半截对象", () => {
  assert.equal(parseSpotText(""), null);
  assert.equal(parseSpotText('v_hf_XAU="";'), null);
  assert.equal(parseSpotText(null), null);
  /* 价格 0 */
  assert.equal(parseSpotText(TENCENT_RAW.replace("3893.54,", "0,")), null);
  /* 日期格式非法 */
  assert.equal(parseSpotText(TENCENT_RAW.replace("2026-11-13", "2026/11/13")), null);
  /* 时间格式非法 */
  assert.equal(parseSpotText(TENCENT_RAW.replace("23:12:00", "23:12")), null);
  /* 字段截断 */
  assert.equal(parseSpotText('v_hf_XAU="3893.54,0.42,3893.54,3893.89,3922.99";'), null);
});

/* ───────────────── F 抓取 ───────────────── */

test("F1 GBK 响应能正确解码出价格与中文名", async () => {
  const fetchImpl = async () => gbkResponse('v_hf_XAU="3891.51,0.36,3891.51,3891.86,3922.99,3872.91,23:13:00,3877.43,3877.21,0,0,0,2026-11-13,', '";');
  const q = await fetchSpot({ fetchImpl, now: () => 1763046789000 });
  assert.equal(q.price, 3891.51);
  assert.equal(q.name, "伦敦金");
  assert.equal(q.recvAt, 1763046789000);
});

test("F2 非 200 必须抛错（交给调度器累计失败，不静默当成功）", async () => {
  const fetchImpl = async () => gbkResponse("", "", 503);
  await assert.rejects(() => fetchSpot({ fetchImpl }), /HTTP 503/);
});

test("F3 请求挂死必须被超时中断，不能把 15 秒节拍拖死", async () => {
  let aborted = false;
  const hanging = (url, opts) =>
    new Promise((_, rej) => {
      opts.signal?.addEventListener("abort", () => {
        aborted = true;
        rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  await assert.rejects(() => fetchSpot({ fetchImpl: hanging, timeoutMs: 40 }));
  assert.equal(aborted, true, "必须真的 abort 掉底层请求");
});

test("F4 请求 URL 指向腾讯 hf_XAU 且带防缓存时间戳", async () => {
  let seen = "";
  const fetchImpl = async (url) => {
    seen = String(url);
    return gbkResponse('v_hf_XAU="3891.51,0.36,3891.51,3891.86,3922.99,3872.91,23:13:00,3877.43,3877.21,0,0,0,2026-11-13,', '";');
  };
  await fetchSpot({ fetchImpl, now: () => 1763046789000 });
  assert.ok(seen.startsWith(SPOT_URL), `实际请求：${seen}`);
  assert.match(seen, /[?&]_=\d+/, "必须加 _=时间戳，防 CDN 缓存旧价");
});

/* ───────────────── L 优先级 ───────────────── */

/** 40 根已收盘日线：日期从 2026-09-01 起，刻意避开「今天」以免被 dropUnclosed 剔掉 */
function bars40() {
  return Array.from({ length: 40 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10);
    const c = 3700 + i * 2;
    return { d, o: c - 3, h: c + 12, l: c - 12, c };
  });
}

function snapWith(price, atIso) {
  return {
    symbol: "XAUUSD",
    bars: bars40(),
    spot: price,
    spotAt: atIso,
    quote: { price, prevClose: 3877.43, open: 3877.21, high: 3922.99, low: 3872.91, at: atIso, source: "sina:hf_XAU" },
    asOf: atIso,
    indicators: { ok: true, rsi14: 55, macd: 1.2, boll: { up: 3900, mid: 3850, low: 3800 }, pctB: 0.6, ma: { ma5: 3880, ma10: 3870, ma20: 3860, ma50: 3840 } },
  };
}

const NOW = Date.parse("2026-11-13T23:20:00+08:00");

test("L1 实时 tick 比快照新 → 用 tick 价，来源标 tencent", async () => {
  resetLatestSpot();
  setLatestSpot({ price: 3899.99, prevClose: 3877.43, open: 3877.21, high: 3925.0, low: 3872.91, at: "2026-11-13T23:19:30+08:00", recvAt: NOW - 30_000, source: "tencent:hf_XAU" });
  const fetchImpl = async (url) => {
    if (String(url).includes("xauusd.json")) {
      return { ok: true, status: 200, json: async () => snapWith(3880.0, "2026-11-13T23:10:00+08:00") };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, score: 62, label: "buy" }) };
  };
  const B = await loadB({ fetchImpl, now: NOW, config: {} });
  assert.equal(B.priceUsdOz, 3899.99);
  assert.equal(B.spotSource, "tencent:hf_XAU");
  assert.equal(B.quote.high, 3925);
  resetLatestSpot();
});

test("L2 tick 过旧（超 2 分钟）不得覆盖快照，避免长期挂后台回来看到僵尸价", async () => {
  resetLatestSpot();
  setLatestSpot({ price: 3999.0, prevClose: 3877.43, open: null, high: null, low: null, at: "2026-11-13T22:00:00+08:00", recvAt: NOW - SPOT_FRESH_MS - 60_000, source: "tencent:hf_XAU" });
  const fetchImpl = async (url) => {
    if (String(url).includes("xauusd.json")) {
      return { ok: true, status: 200, json: async () => snapWith(3880.0, "2026-11-13T23:10:00+08:00") };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, score: 62, label: "buy" }) };
  };
  const B = await loadB({ fetchImpl, now: NOW, config: {} });
  assert.equal(B.priceUsdOz, 3880);
  assert.equal(B.spotSource, "sina:hf_XAU");
  resetLatestSpot();
});

test("L3 无 tick 时行为与 v2.5.3 完全一致（纯快照）", async () => {
  resetLatestSpot();
  assert.equal(getLatestSpot(), null);
  const fetchImpl = async (url) => {
    if (String(url).includes("xauusd.json")) {
      return { ok: true, status: 200, json: async () => snapWith(3880.0, "2026-11-13T23:10:00+08:00") };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, score: 62, label: "buy" }) };
  };
  const B = await loadB({ fetchImpl, now: NOW, config: {} });
  assert.equal(B.priceUsdOz, 3880);
  assert.equal(B.stale, false);
});

/* ───────────────── V 视图 ───────────────── */

const stateOf = (spotSource, price, prevClose) => ({
  now: NOW,
  B: { ok: true, priceUsdOz: price, spotSource, quote: { prevClose, at: "2026-11-13T23:19:30+08:00" }, ts: NOW - 30_000 },
  meta: {},
});

test("V1 实时模式：涨用红、跌用绿，时效行显示本次更新时刻", () => {
  const up = spotTickView(stateOf("tencent:hf_XAU", 3900, 3877.43));
  assert.equal(up.live, true);
  assert.equal(up.chgTone, "up");
  assert.match(up.chgText, /^\+0\.58%$/);
  assert.match(up.atText, /^实时/);
  /* 必须带一个会变的时刻：只写「0 秒前」会一直卡在 0，看不出在刷新 */
  assert.match(up.atText, /\d{2}:\d{2}:\d{2}/);

  const down = spotTickView(stateOf("tencent:hf_XAU", 3850, 3877.43));
  assert.equal(down.chgTone, "dn");
  assert.match(down.chgText, /^-0\.71%$/);
});

test("V4 实时通道连续 3 个节拍没回来，必须明说停顿，不许继续显示「实时」", () => {
  const s = stateOf("tencent:hf_XAU", 3900, 3877.43);
  s.B.ts = NOW - 50_000; // 3 个 15 秒节拍都空了
  const v = spotTickView(s);
  assert.match(v.atText, /停顿|未更新/);
});

test("V5 首屏不等 15 秒：整页刷新完成后要立刻补一拍", async () => {
  const src = await read("src/main.js");
  const refresh = src.slice(src.indexOf("async function refreshAll"), src.indexOf("/* ── 渲染后的副作用"));
  assert.match(refresh, /ui\.spot\?\.tick\(\)/, "refreshAll 成功后必须补一拍，否则首屏要等 15 秒才有实时价");
});

test("V2 快照模式：明确标「快照」，不冒充实时", () => {
  const v = spotTickView(stateOf("sina:hf_XAU", 3880, 3877.43));
  assert.equal(v.live, false);
  assert.match(v.atText, /快照/);
});

test("V6 涨跌幅四舍五入到 0 时，不许显示「-0.00%」", () => {
  const v = spotTickView(stateOf("tencent:hf_XAU", 3877.27, 3877.43)); // -0.0041%
  assert.equal(v.chgText, "0.00%");
  assert.equal(v.chgTone, "flat");
});

test("V3 缺昨收时不硬算涨跌幅，返回 --", () => {
  const v = spotTickView({ now: NOW, B: { ok: true, priceUsdOz: 3880, spotSource: "tencent:hf_XAU", quote: { prevClose: null }, ts: NOW }, meta: {} });
  assert.equal(v.chgText, "--");
  assert.equal(v.chgTone, "flat");
});

/* ───────────────── K 调度 ───────────────── */

const okQuote = { price: 3891.51, prevClose: 3877.43, open: 3877.21, high: 3922.99, low: 3872.91, at: "2026-11-13T23:13:00+08:00", recvAt: NOW, source: "tencent:hf_XAU" };

test("K1 默认节拍就是 15 秒（不是 10 分钟）", () => {
  assert.equal(SPOT_INTERVAL_MS, 15_000);
  assert.ok(SPOT_FRESH_MS >= 60_000, "新鲜度窗口至少 1 分钟，容得下一次抖动");
});

test("K2 页面隐藏时不发起请求（省流量、避免无意义轮询）", async () => {
  let calls = 0;
  const t = createSpotTicker({ fetchImpl: async () => { calls++; return gbkResponse('v_hf_XAU="3891.51,0.36,3891.51,3891.86,3922.99,3872.91,23:13:00,3877.43,3877.21,0,0,0,2026-11-13,', '";'); }, isHidden: () => true, now: () => NOW });
  await t.tick();
  assert.equal(calls, 0);
});

test("K3 成功走 onQuote 并写入 latest；失败累加计数走 onError", async () => {
  resetLatestSpot();
  const got = [];
  const errs = [];
  let mode = "ok";
  const t = createSpotTicker({
    fetchImpl: async () => {
      if (mode === "bad") return gbkResponse("", "", 500);
      return gbkResponse('v_hf_XAU="3891.51,0.36,3891.51,3891.86,3922.99,3872.91,23:13:00,3877.43,3877.21,0,0,0,2026-11-13,', '";');
    },
    now: () => NOW,
    onQuote: (q) => got.push(q),
    onError: (e, n) => errs.push(n),
  });
  await t.tick();
  assert.equal(got.length, 1);
  assert.equal(getLatestSpot().price, 3891.51);

  mode = "bad";
  await t.tick();
  await t.tick();
  assert.deepEqual(errs, [1, 2]);
  /* 失败不得清空 latest：断网时仍要显示最后一笔真实价，而不是退回 10 分钟前的快照 */
  assert.equal(getLatestSpot().price, 3891.51);
});

test("K4 stop 之后定时器与手动 tick 都停掉（防内存泄漏/后台偷跑）", async () => {
  let cleared = 0;
  let armed = null;
  const t = createSpotTicker({
    fetchImpl: async () => gbkResponse('v_hf_XAU="3891.51,0.36,3891.51,3891.86,3922.99,3872.91,23:13:00,3877.43,3877.21,0,0,0,2026-11-13,', '";'),
    now: () => NOW,
    setInt: (fn, ms) => { armed = { fn, ms }; return 7; },
    clearInt: () => { cleared++; },
  });
  t.start();
  assert.equal(armed.ms, 15_000);
  t.stop();
  assert.equal(cleared, 1);
  const r = await t.tick();
  assert.equal(r, null, "stop 后 tick 必须直接返回");
});

test("K5 重叠保护：上一轮没回来时不得并发再发一趟", async () => {
  let calls = 0;
  let release;
  const t = createSpotTicker({
    fetchImpl: () => {
      calls++;
      return new Promise((res) => { release = () => res(gbkResponse('v_hf_XAU="3891.51,0.36,3891.51,3891.86,3922.99,3872.91,23:13:00,3877.43,3877.21,0,0,0,2026-11-13,', '";')); });
    },
    now: () => NOW,
  });
  const p1 = t.tick();
  const p2 = t.tick();
  assert.equal(calls, 1, "第二次 tick 必须被 busy 挡住");
  release();
  await p1;
  await p2;
});

/* ───────────────── G 结构守卫 ───────────────── */

test("G1 版本号升到 2.6.0 且页面同步显示", async () => {
  const v = await read("src/version.js");
  assert.match(v, /2\.6\.0/);
  const html = await read("index.html");
  assert.match(html, /v2\.6\.0/);
});

test("G2 渲染层必须给实时价格留挂载点（找不到节点就白改）", async () => {
  const src = await read("src/render.js");
  assert.match(src, /id="spot-price"/, "大价格节点");
  assert.match(src, /id="spot-chg"/, "涨跌幅节点");
  assert.match(src, /id="spot-at"/, "时效节点");
  assert.match(src, /id="brief-spot"/, "晨报文本里的价格也要能单点更新");
  const css = await read("index.html");
  assert.match(css, /\.spot-at/, "时效行要有样式，否则挤在卡片里");
});

test("G3 配置指向腾讯 hf_XAU，且不再回退 gold-api", async () => {
  const cfg = await read("src/config.js");
  assert.match(cfg, /qt\.gtimg\.cn\/q=hf_XAU/);
  assert.doesNotMatch(cfg, /gold-api/);
  assert.equal(SPOT_URL, "https://qt.gtimg.cn/q=hf_XAU");
});

test("G4 反向依赖禁止：realtime 不得 import 渲染层或装配层（否则成环）", async () => {
  const src = await read("src/realtime.js");
  assert.doesNotMatch(src, /from\s+["'][.]{1,2}\/(render|app|main)(\.js)?["']/);
});

test("G5 sourceB 只读 latest tick，不自己发请求（抓取职责单点）", async () => {
  const src = await read("src/sourceB.js");
  assert.match(src, /getLatestSpot/);
  assert.doesNotMatch(src, /qt\.gtimg\.cn/, "抓取必须只在 realtime.js 里做");
});
