/**
 * v2.5.2 用例：行情口径与宏观时效
 *
 * 用户反馈两件事：
 *   1) 「金价获取和别的行情软件差太多」——前端直连 gold-api，实测同时刻比新浪伦敦金高 3.2~8.6 美元，
 *      且快照里出现过 3909（当时新浪约 3880），属口径不稳。用户的老应用 XAU Desk 用的是新浪 hf_XAU。
 *   2) 「10Y 和美元指数截止 11.11，今天 13 号了还不更新」——宏观主源是 FRED DGS10（日频 T+1、
 *      11-11 美国退伍军人节休市）与 CBOE 收盘 CSV，天然滞后；前端也不显示数据时刻。
 *
 * 修法：
 *   Q 系  金价改新浪 hf_XAU（服务端抓、写快照、前端只读），彻底不再用 gold-api。
 *   M 系  宏观主源改 CNBC 实时（US10Y / .DXY / .VIX），FRED/CBOE/er-api 降为回退。
 *   T 系  宏观卡片显示数据时刻与「x 分钟前」，让时效可见。
 *   R 系  回退链与降级不可删：CNBC 挂 → FRED/CBOE/er-api 顶上，仍失败 → 沿用旧值并标记。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(ROOT, p), "utf8");

/* 真实响应样本（2026-11-13 21:53 GMT+8 抓取，原样保留用于回归） */
const SINA_RAW =
  'var hq_str_hf_XAU="3882.48,3877.430,3882.48,3882.83,3922.99,3872.91,21:53:00,3877.43,3877.21,0,0,0,2026-11-13,伦敦金（现货黄金）";';

const CNBC_RAW = {
  QuickQuoteResult: {
    QuickQuote: [
      {
        symbol: "US10Y", last: "5.141", change: "0.038", change_pct: "0.7447",
        previous_day_closing: "5.103", last_time: "2026-11-13T08:54:18.000-0500",
        realTime: "true", name: "U.S. 10 Year Treasury",
      },
      {
        symbol: ".DXY", last: "103.193", change_pct: "0.02",
        previous_day_closing: "103.173", last_time: "2026-11-13T08:56:42.000-0500",
        realTime: "true", name: "ICE U.S. Dollar Index",
      },
      {
        symbol: ".VIX", last: "17.99", change_pct: "-3.797",
        previous_day_closing: "18.70", last_time: "2026-11-13T08:56:31.000-0500",
        realTime: "true", name: "CBOE Volatility Index",
      },
    ],
  },
};

/* ───────────── Q 金价口径 ───────────── */

test("Q1 现价主源改为新浪 hf_XAU，不再以 gold-api 为主", async () => {
  const src = await read("scripts/sync-xau.mjs");
  assert.match(src, /hq\.sinajs\.cn/, "应改抓新浪实时行情");
  assert.match(src, /hf_XAU/, "标的必须是伦敦金现 hf_XAU");
  assert.doesNotMatch(
    src,
    /const SPOT = "https:\/\/api\.gold-api\.com/,
    "gold-api 不得再作为现价主源",
  );
});

test("Q2 parseSinaQuote 正确解析伦敦金现字段", async () => {
  const { parseSinaQuote } = await import("../scripts/sync-xau.mjs");
  const q = parseSinaQuote(SINA_RAW);
  assert.ok(q, "应解析成功");
  assert.equal(q.price, 3882.48, "现价取第 1 字段");
  assert.equal(q.prevClose, 3877.43, "昨收取第 8 字段");
  assert.equal(q.open, 3877.21, "今开取第 9 字段");
  assert.equal(q.high, 3922.99, "最高取第 5 字段");
  assert.equal(q.low, 3872.91, "最低取第 6 字段");
  assert.equal(q.source, "sina:hf_XAU", "来源必须写明");
  assert.match(q.at, /^2026-11-13T21:53:00\+08:00$/, "时间戳需带东八区偏移");
});

test("Q3 parseSinaQuote 对空/异常响应返回 null（不抛错）", async () => {
  const { parseSinaQuote } = await import("../scripts/sync-xau.mjs");
  assert.equal(parseSinaQuote('var hq_str_hf_XAU="";'), null, "空串应返回 null");
  assert.equal(parseSinaQuote("garbage"), null, "非预期格式应返回 null");
  assert.equal(parseSinaQuote('var hq_str_hf_XAU="1,2,3";'), null, "字段不足应返回 null");
});

test("Q4 快照写入 quote 对象（现价/昨收/开/高/低/时刻）", async () => {
  const src = await read("scripts/sync-xau.mjs");
  assert.match(src, /\bquote,|\bquote:/, "doc 需挂载 quote 对象");
  assert.match(src, /spotAt:\s*quote\.at/, "顶层 spotAt 必须与 quote 时刻一致");
  assert.match(src, /spotSource:\s*quote\.source/, "来源需透出，前端据此标注口径");
  for (const k of ["price", "prevClose", "open", "high", "low"]) {
    assert.match(src, new RegExp(`${k}:`), `quote 缺少字段 ${k}`);
  }
});

test("Q5 现价变化也要落盘（不能因日线未变就跳过）", async () => {
  const src = await read("scripts/sync-xau.mjs");
  assert.match(src, /quoteSame/, "需单独判断 quote 是否变化");
  assert.match(src, /barsSame\s*&&\s*quoteSame/, "两者都未变才允许跳过写入");
});

test("Q6 前端不直连聚合报价（gold-api 已弃用，v2.6.0 改腾讯 hf_XAU 同口径）", async () => {
  const cfg = await read("src/config.js");
  assert.doesNotMatch(cfg, /api\.gold-api\.com/, "配置里不得残留 gold-api");
  /* v2.6.0 需求变更：金价要 15 秒级，快照 10 分钟一档不够；
     换成的源必须与新浪 hf_XAU 同口径（否则重演「金价差太多」）。 */
  assert.match(cfg, /qt\.gtimg\.cn\/q=hf_XAU/, "必须指向腾讯 hf_XAU 同口径源");
});

test("Q7 快照价的时间锚点取 quote.at", async () => {
  const src = await read("src/sourceB.js");
  assert.match(src, /quote\.at|snap\.quote/, "需读取快照 quote");
  assert.match(src, /spotSource\s*=\s*"snapshot-sina"|"sina:hf_XAU"/, "来源标记需区分新浪快照");
});

/* ───────────── M 宏观时效 ───────────── */

test("M1 宏观主源改 CNBC 实时，FRED/CBOE 降为回退", async () => {
  const src = await read("scripts/sync-macro.mjs");
  assert.match(src, /quote\.cnbc\.com/, "应接入 CNBC 实时报价");
  assert.match(src, /US10Y/, "10Y 用 US10Y");
  assert.match(src, /\.DXY/, "美元指数用 .DXY");
  assert.match(src, /\.VIX/, "VIX 用 .VIX");
  assert.match(src, /fredgraph\.csv|DGS10/, "FRED 必须保留为回退");
});

test("M2 parseCnbc 正确解析三标的（现价/前收/时刻）", async () => {
  const { parseCnbc } = await import("../scripts/sync-macro.mjs");
  const p = parseCnbc(CNBC_RAW);
  assert.equal(p.tnx.cur, 5.141);
  assert.equal(p.tnx.prev, 5.103);
  assert.equal(p.dxy.cur, 103.193);
  assert.equal(p.dxy.prev, 103.173);
  assert.equal(p.vix.cur, 17.99);
  assert.equal(p.vix.prev, 18.7);
  assert.match(p.tnx.at, /2026-11-13T08:54:18-05:00/, "时刻需保留原始时区");
});

test("M3 parseCnbc 缺项时返回 null 而非造数", async () => {
  const { parseCnbc } = await import("../scripts/sync-macro.mjs");
  const p = parseCnbc({ QuickQuoteResult: { QuickQuote: [{ symbol: "US10Y", last: "5.1", previous_day_closing: "5.0", last_time: "2026-11-13T08:00:00.000-0500" }] } });
  assert.ok(p.tnx, "有的项正常返回");
  assert.equal(p.dxy, null, "缺的项必须是 null，不能拿别的值顶替");
  assert.equal(p.vix, null);
});

test("M4 宏观快照写入 times（每项数据时刻）", async () => {
  const src = await read("scripts/sync-macro.mjs");
  assert.match(src, /times:\s*\{/, "需写 times 对象");
  assert.match(src, /times\.(dxy|tnx|vix)|times\[/, "逐项写入时刻");
});

test("M5 sourceC 把 times 透出给渲染层", async () => {
  const src = await read("src/sourceC.js");
  assert.match(src, /times/, "loadC 需透出 times");
  assert.match(src, /macro\.times\s*=/, "应挂到 macro 对象上");
});

/* ───────────── T 时效可见 ───────────── */

test("T1 宏观卡片显示数据时刻与距今多久", async () => {
  const src = await read("src/render.js");
  assert.match(src, /class="macro-at/, "需渲染数据时刻节点");
  assert.match(src, /esc\(macroAt\)/, "时刻文案需真正插入 DOM");
  assert.match(src, /ageText\(/, "需给出人话化的距今时长");
});

test("T2 数据过期（>60 分钟）时要显式标注", async () => {
  const src = await read("src/render.js");
  assert.match(src, /macroLate/, "需计算宏观数据是否滞后");
  assert.match(src, /源滞后/, "超阈值需显式写「源滞后」，而不是假装实时");
});

/* ───────────── R 回退与降级 ───────────── */

test("R1 宏观回退链完整：CNBC → FRED/CBOE → 沿用旧值", async () => {
  const src = await read("scripts/sync-macro.mjs");
  assert.match(src, /errs\.push/, "失败必须记录原因");
  assert.match(src, /沿用上次|prevDoc/, "全失败时沿用旧值，不让整块变灰");
});

test("R2 金价抓取失败时保留上一份快照，不清空", async () => {
  const src = await read("scripts/sync-xau.mjs");
  assert.match(src, /process\.exit\(1\)|throw/, "失败需明确退出，由工作流保留旧文件");
  assert.doesNotMatch(src, /writeFileSync\(OUT,\s*JSON\.stringify\(\{\s*symbol:\s*"XAUUSD",\s*bars:\s*\[\]/, "不得写入空数组覆盖");
});

test("R3 前端拿不到 quote 时回退 snap.spot（旧快照兼容）", async () => {
  const src = await read("src/sourceB.js");
  assert.match(src, /snap\.quote|snap\.spot/, "需兼容旧快照的 spot 字段");
});
