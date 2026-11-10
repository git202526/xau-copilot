/**
 * v2.3.0 · 纯外部技术面决策（用户指令：不要内外部双印证，只搜集外部实时行情指标做出判断）
 *
 * 范围经用户确认：「只改 M2 决策卡」，其余 6 卡完全不动；指标「1 和 2 都做」=
 *   现有外部数据（现价 / MA20偏离 / ATR14 / 日内涨跌 / DXY·10Y·VIX / 综合评级）
 *   + 新增技术指标（RSI14 / MACD / 布林带 / 多周期均线排列）
 * 指标一律「服务端算、写快照、前端只读」，严禁前端拉 K 线自造轮子。
 *
 * 本文件为纯函数 + 源码契约测试（不碰 DOM），任何环境可跑。
 * 红灯阶段：新模块尚不存在 → tryImport 返回 null → 断言干净失败（非加载期崩溃）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const P = (p) => new URL(p, ROOT);
const read = (p) => readFile(P(p), "utf8");

/** 动态加载：模块不存在时返回 null，让每条测试独立、干净地变红 */
async function tryImport(p) {
  try {
    return await import(P(p).href);
  } catch {
    return null;
  }
}

/* ── 构造确定性的日线样本 ──
 * 注意：不能整段用「严格等差」序列测 MACD 柱方向 —— 等差序列趋势加速度为 0，
 * EMA12−EMA26 收敛为常数，信号线追平后 hist 必然为 0（数学性质，非 bug）。
 * 因此样本采用真实行情形态：前 35 根横盘微噪，后 25 根带加速度的趋势段。
 * 另设 mkLinear() 专门锁住「无加速度 → hist≈0」这一性质，防止实现被误改。 */
const mkBars = (dir) =>
  Array.from({ length: 60 }, (_, i) => {
    const c = i < 35 ? 4000 + (i % 2 === 0 ? 2 : -2) : 4000 + (i - 34) * (dir > 0 ? 12 : -12);
    return { d: `bar-${i}`, o: c - 3, h: c + 5, l: c - 6, c };
  });
const mkLinear = () =>
  Array.from({ length: 60 }, (_, i) => {
    const c = 4000 + i * 8;
    return { d: `bar-${i}`, o: c - 3, h: c + 5, l: c - 6, c };
  });

/** 全多头的外部源 */
const bullB = () => ({
  ok: true,
  instrument: "XAUUSD",
  priceUsdOz: 4200,
  ma20UsdOz: 4100,
  devPct: 2.44,
  dayPct: 1.2,
  trend: 1,
  atr14: 42,
  spotSource: "gold-api",
  stale: false,
  ratingOk: true,
  rating: { score: 82, label: "Strong Buy" },
  indicators: {
    ok: true,
    rsi14: 62,
    macd: { line: 12.3, signal: 8.1, hist: 4.2, cross: "golden" },
    boll: { mid: 4100, upper: 4260, lower: 3940, pctB: 0.78, bandwidth: 7.8 },
    ma: { ma5: 4180, ma10: 4140, ma20: 4100, ma50: 4020 },
    align: "bull",
    price: 4200,
  },
});

/** 全空头的外部源 */
const bearB = () => ({
  ok: true,
  instrument: "XAUUSD",
  priceUsdOz: 3980,
  ma20UsdOz: 4100,
  devPct: -2.93,
  dayPct: -1.4,
  trend: -1,
  atr14: 45,
  spotSource: "gold-api",
  stale: false,
  ratingOk: true,
  rating: { score: 18, label: "Strong Sell" },
  indicators: {
    ok: true,
    rsi14: 34,
    macd: { line: -14.2, signal: -9.0, hist: -5.2, cross: "death" },
    boll: { mid: 4100, upper: 4260, lower: 3940, pctB: 0.13, bandwidth: 7.8 },
    ma: { ma5: 3990, ma10: 4040, ma20: 4100, ma50: 4180 },
    align: "bear",
    price: 3980,
  },
});

const calmC = () => ({ ok: true, dir: 0, mode: "normal", label: "中性", items: [] });

/* ═══════════ A 组：服务端指标计算 computeIndicators ═══════════ */

test("A1 单调上升 60 根 → 多头排列 / RSI 超买 / MACD 柱为正 / 价格贴上轨", async () => {
  const m = await tryImport("src/core/indicators.js");
  assert.ok(m, "src/core/indicators.js 尚未实现（红灯）");
  assert.equal(typeof m.computeIndicators, "function", "缺少 computeIndicators 导出");
  const r = m.computeIndicators(mkBars(1));
  assert.equal(r.ok, true);
  assert.equal(r.align, "bull", "均线应为多头排列");
  assert.ok(r.rsi14 > 70, `RSI14 应超买，实际 ${r.rsi14}`);
  assert.ok(r.macd.hist > 0, `MACD 柱应为正，实际 ${r.macd.hist}`);
  assert.ok(r.boll.pctB > 0.8, `价格应靠近布林上轨，实际 %B=${r.boll.pctB}`);
  assert.ok(r.ma.ma5 > r.ma.ma50, "MA5 应高于 MA50");
});

test("A2 单调下降 60 根 → 空头排列 / RSI 超卖 / MACD 柱为负 / 价格贴下轨", async () => {
  const m = await tryImport("src/core/indicators.js");
  assert.ok(m, "src/core/indicators.js 尚未实现（红灯）");
  const r = m.computeIndicators(mkBars(-1));
  assert.equal(r.ok, true);
  assert.equal(r.align, "bear", "均线应为空头排列");
  assert.ok(r.rsi14 < 30, `RSI14 应超卖，实际 ${r.rsi14}`);
  assert.ok(r.macd.hist < 0, `MACD 柱应为负，实际 ${r.macd.hist}`);
  assert.ok(r.boll.pctB < 0.2, `价格应靠近布林下轨，实际 %B=${r.boll.pctB}`);
});

test("A3 异常边界 bars=null → 不抛异常，返回 ok:false", async () => {
  const m = await tryImport("src/core/indicators.js");
  assert.ok(m, "src/core/indicators.js 尚未实现（红灯）");
  let r;
  assert.doesNotThrow(() => { r = m.computeIndicators(null); });
  assert.equal(r.ok, false);
});

test("A4 异常边界 bars 仅 10 根（不足 26）→ 不抛异常，ok:false", async () => {
  const m = await tryImport("src/core/indicators.js");
  assert.ok(m, "src/core/indicators.js 尚未实现（红灯）");
  let r;
  assert.doesNotThrow(() => { r = m.computeIndicators(mkBars(1).slice(0, 10)); });
  assert.equal(r.ok, false, "样本不足必须显式降级");
});

test("A5 异常边界 closes 混入 null / NaN / 字符串 → 过滤后不泄漏 NaN", async () => {
  const m = await tryImport("src/core/indicators.js");
  assert.ok(m, "src/core/indicators.js 尚未实现（红灯）");
  const bars = mkBars(1);
  bars[10].c = null;
  bars[11].c = NaN;
  bars[12].c = "4400";
  let r;
  assert.doesNotThrow(() => { r = m.computeIndicators(bars); });
  assert.equal(r.ok, true, "脏数据清洗后仍应可用");
  for (const v of [r.rsi14, r.macd && r.macd.hist, r.boll && r.boll.pctB, r.ma && r.ma.ma20]) {
    assert.ok(v == null || Number.isFinite(v), `指标不得泄漏 NaN/Infinity：${v}`);
  }
});

test("A6 数学性质守卫：严格等差（零加速度）序列 MACD 柱必须趋近 0", async () => {
  const m = await tryImport("src/core/indicators.js");
  assert.ok(m, "src/core/indicators.js 尚未实现（红灯）");
  const r = m.computeIndicators(mkLinear());
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.macd.hist) < 0.5, `零加速度序列 hist 应趋近 0，实际 ${r.macd.hist}`);
  assert.equal(r.align, "bull", "但均线排列仍应识别为多头");
});

/* ═══════════ B 组：纯外部判断引擎 decideTechnical ═══════════ */

test("B1 全多外部指标 → tech_bull / dir=1 / 不含内部数据依赖", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  assert.equal(typeof m.decideTechnical, "function", "缺少 decideTechnical 导出");
  const t = m.decideTechnical({ B: bullB(), C: calmC(), stale: false, cfg: {} });
  assert.equal(t.scenario, "tech_bull");
  assert.equal(t.dir, 1);
  assert.ok(t.score > 55, `多头得分应偏高，实际 ${t.score}`);
});

test("B2 全空外部指标 → tech_bear / dir=-1", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const t = m.decideTechnical({ B: bearB(), C: calmC(), stale: false, cfg: {} });
  assert.equal(t.scenario, "tech_bear");
  assert.equal(t.dir, -1);
  assert.ok(t.score < 45, `空头得分应偏低，实际 ${t.score}`);
});

test("B3 去双印证守卫：不接收 aSign，输出不含「内部/共振/背离/印证/反抽/多源」", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const fn = m.decideTechnical.toString();
  assert.doesNotMatch(fn, /\baSign\b/, "纯外部引擎不得出现内部趋势符号 aSign");
  assert.doesNotMatch(fn, /resonance|divergence|intraday_rebound/, "不得残留双印证场景");
  const t = m.decideTechnical({ B: bullB(), C: calmC(), stale: false, cfg: {} });
  const all = `${t.headline}|${t.text}|${t.detail}|${JSON.stringify(t.signals)}`;
  assert.doesNotMatch(all, /内部|共振|背离|印证|反抽|多源/, "对外文案不得残留双印证概念");
});

test("B4 异常边界 indicators=null（指标缺失）→ degraded，不输出方向结论", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const B = bullB(); B.indicators = null;
  const t = m.decideTechnical({ B, C: calmC(), stale: false, cfg: {} });
  assert.equal(t.scenario, "degraded");
  assert.equal(t.dir, 0, "降级时严禁给出方向");
});

test("B5 异常边界 stale=true（外部僵尸）→ degraded，方向作废", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const t = m.decideTechnical({ B: bullB(), C: calmC(), stale: true, cfg: {} });
  assert.equal(t.scenario, "degraded");
  assert.equal(t.dir, 0);
});

test("B6 异常边界 VIX 暴涨（C.mode=risk_off）→ 避险模式，技术面失效", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const C = calmC(); C.mode = "risk_off";
  const t = m.decideTechnical({ B: bullB(), C, stale: false, cfg: {} });
  assert.equal(t.scenario, "risk_off");
  assert.equal(t.dir, 0);
});

test("B7 异常边界 B.ok=false（外部行情源全挂）→ degraded 不白屏", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const t = m.decideTechnical({ B: { ok: false }, C: calmC(), stale: false, cfg: {} });
  assert.equal(t.scenario, "degraded");
  assert.equal(t.dir, 0);
  assert.ok(t.headline && t.text, "降级也必须给出可读文案，绝不白屏");
});

test("B8 评级缺失但指标齐全 → 仍能判断（不硬依赖第三方评级）", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const B = bullB(); B.ratingOk = false; B.rating = null;
  const t = m.decideTechnical({ B, C: calmC(), stale: false, cfg: {} });
  assert.equal(t.scenario, "tech_bull");
  assert.notEqual(t.scenario, "degraded", "评级非必需项，指标齐全即可判断");
});

test("B9 signals 至少覆盖 7 项外部指标（供 M2 网格展示）", async () => {
  const m = await tryImport("src/core/technical.js");
  assert.ok(m, "src/core/technical.js 尚未实现（红灯）");
  const t = m.decideTechnical({ B: bullB(), C: calmC(), stale: false, cfg: {} });
  assert.ok(Array.isArray(t.signals), "signals 应为数组");
  assert.ok(t.signals.length >= 7, `指标项不足：${t.signals.length}`);
  for (const s of t.signals) {
    assert.ok(s.key && s.label && s.value !== undefined, "每个指标项须含 key/label/value");
  }
});

/* ═══════════ C 组：契约守卫（服务端算 / 前端只读 / 只改 M2）═══════════ */

test("C1 sourceB.js 不得 import 指标计算模块（前端严禁造轮子），只透出 snap.indicators", async () => {
  const s = await read("src/sourceB.js");
  assert.doesNotMatch(s, /from\s+["'].*core\/indicators\.js/, "前端不得引入指标计算模块");
  assert.match(s, /snap\.indicators|indicators:/, "sourceB 应只读透出快照里的 indicators");
});

test("C2 app.js 装配 s.technical 并把 B / C / stale 喂给 decideTechnical", async () => {
  const s = await read("src/app.js");
  assert.match(s, /decideTechnical/, "装配层未引入纯外部引擎");
  assert.match(s, /technical/, "state 未挂 technical");
});

test("C3 renderDecision 只读 s.technical，M2 段不得残留「内部结构/共振/背离/多源」", async () => {
  const s = await read("src/render.js");
  const start = s.indexOf("export function renderDecision");
  const end = s.indexOf("export function renderAccount");
  assert.ok(start > 0 && end > start, "未找到 M2 渲染函数边界");
  const seg = s.slice(start, end);
  assert.match(seg, /s\.technical/, "M2 必须消费 s.technical");
  assert.doesNotMatch(seg, /s\.decision/, "M2 不得再消费双印证 decision");
  assert.doesNotMatch(seg, /内部结构|共振|背离|多源/, "M2 不得残留双印证字样");
});

test("C4 全局同步：render.js 全文不得再消费 s.decision（所有卡片统一外部判断源）", async () => {
  const s = await read("src/render.js");
  assert.doesNotMatch(s, /s\.decision/, "仍有卡片消费双印证结论 decision");
  assert.match(s, /s\.technical/, "渲染层未接入纯外部判断 s.technical");
});

test("C5 快照 data/xauusd.json 含 indicators（rsi14 / macd / boll / ma / align）", async () => {
  const j = JSON.parse(await read("data/xauusd.json"));
  assert.ok(j.indicators && j.indicators.ok === true, "快照缺少服务端预算指标");
  for (const k of ["rsi14", "macd", "boll", "ma", "align"]) {
    assert.ok(j.indicators[k] != null, `indicators 缺少 ${k}`);
  }
});

test("C6 sync-xau.mjs 引入 computeIndicators 并把结果写入快照", async () => {
  const s = await read("scripts/sync-xau.mjs");
  assert.match(s, /computeIndicators/, "同步脚本未引入指标计算");
  assert.match(s, /indicators:/, "同步脚本未把 indicators 写入 doc");
});

/* ═══════════ D 组：全局零双印证（运行时链路 + 静态文案）═══════════ */

/* 允许保留的历史夹具：confidence.js / 旧 evidence 文档 / 测试文件本身。
   但凡参与运行时渲染与判断的文件，一律不得残留双印证概念。 */
const BANNED = /共振|背离|印证作废|印证决策|多源|内部结构|内部日线|A×B×C|趋势偏空|盘中强反抽/;
const RUNTIME_FILES = [
  "src/app.js", "src/render.js", "src/main.js",
  "src/core/grid.js", "src/core/discipline.js", "src/core/risk.js",
  "index.html",
];

test("D1 运行时链路与静态文案全局清除双印证字样", async () => {
  const hits = [];
  for (const f of RUNTIME_FILES) {
    const s = await read(f);
    s.split("\n").forEach((line, i) => {
      if (BANNED.test(line)) hits.push(`${f}:${i + 1} ${line.trim().slice(0, 70)}`);
    });
  }
  assert.deepEqual(hits, [], `仍残留双印证字样：\n${hits.join("\n")}`);
});

test("D2 app.js 不再 import / 调用双印证引擎 decide", async () => {
  const s = await read("src/app.js");
  assert.doesNotMatch(s, /import\s*\{[^}]*\bdecide\b[^}]*\}\s*from\s*["']\.\/core\/confidence\.js/, "装配层仍在引入 decide");
  assert.doesNotMatch(s, /\bdecide\s*\(\s*\{/, "装配层仍在调用 decide({...})");
  assert.match(s, /decideTechnical/, "装配层未引入纯外部引擎");
});

test("D3 各下游判断模块改吃外部方向，不再依赖 A.trend / divergence", async () => {
  for (const f of ["src/core/grid.js", "src/core/discipline.js", "src/core/risk.js"]) {
    const s = await read(f);
    assert.doesNotMatch(s, /A\.trend|divergence/, `${f} 仍依赖内部趋势或背离入参`);
  }
});

test("D4 异常边界：main.js 的 Webhook / FOMO 不再引用 s.decision", async () => {
  const s = await read("src/main.js");
  assert.doesNotMatch(s, /s\.decision/, "副作用层仍消费双印证结论");
  assert.match(s, /s\.technical/, "副作用层未接入纯外部判断");
});

test("D5 M1 雷达不得再展示「内部日线」，改为外部技术面", async () => {
  const s = await read("src/render.js");
  assert.doesNotMatch(s, /内部日线|A\.trend/, "M1 仍在读内部趋势");
});

test("D6 静态骨架屏与页脚文案同步更新（不残留「多源共振决策」）", async () => {
  const h = await read("index.html");
  assert.doesNotMatch(h, /多源共振决策|多源印证决策|内部结构 A × 外部评级 B/, "静态文案未同步");
  const m = await read("src/main.js");
  assert.doesNotMatch(m, /共振决策/, "骨架屏标题未同步");
});

/* ═══════════ E 组：端到端装配解耦 + 账户事实保留 ═══════════ */

const ENOW = Date.parse("2026-11-10T08:00:00+08:00");
const eBars = () => Array.from({ length: 60 }, (_, i) => ({
  d: `2026-09-${String(i + 1).padStart(2, "0")}`, c: 4000 + i * 3, h: 4012 + i * 3, l: 3988 + i * 3,
}));

/** 五源 mock：live/meta/xauusd/rating/macro/gold-api/er-api */
function eMock({ aTrend = "下行", bDown = false } = {}) {
  const bars = eBars();
  return (u) => {
    const s = String(u);
    let j = null;
    if (s.includes("live.json")) j = {
      TOTAL: 330, H_BASE: 4696, GRAMS: 327.8848, COST: 318708, gearCount: 9,
      startDrop: 15, endDrop: 34.3, wPct: [4, 6, 10, 14, 17, 18, 15, 10, 6], noCap: true,
      updatedAt: ENOW - 1e5,
      accounts: [{ id: "a0", name: "建行" }, { id: "a1", name: "民生" }],
      buys: [{ id: "b1", gram: 327.8848, priceCny: 972.01, time: "2026-11-01T00:00:00Z", acct: "a0" }],
      sells: [], feed: [{ t: ENOW - 1e5, type: "dir", detail: `周线 ${aTrend} · 日线 ${aTrend} · 置信 61` }],
    };
    else if (s.includes("meta.json")) j = { syncedAt: new Date(ENOW - 1e5).toISOString() };
    else if (s.includes("xauusd.json")) j = {
      bars, spot: 4190, spotAt: new Date(ENOW - 1e4).toISOString(), asOf: new Date(ENOW - 1e4).toISOString(),
      indicators: bDown ? null : {
        ok: true, rsi14: 61, macd: { line: 10, signal: 6, hist: 4, cross: "golden" },
        boll: { mid: 4100, upper: 4250, lower: 3950, pctB: 0.75, bandwidth: 7.3 },
        ma: { ma5: 4170, ma10: 4140, ma20: 4100, ma50: 4020 }, align: "bull", price: 4190,
      },
    };
    else if (s.includes("rating.json")) j = { ok: true, score: 80, label: "Strong Buy" };
    else if (s.includes("macro.json")) j = { ok: true, dxy: 102, dxyPrev: 102.5, tnx: 4.8, tnxPrev: 4.9, vix: 17, vixPrev: 17.2 };
    else if (s.includes("gold-api")) j = { price: 4190 };
    else if (s.includes("er-api")) j = { rates: { CNY: 6.68 } };
    return Promise.resolve({ ok: j != null, status: j != null ? 200 : 404, json: async () => j });
  };
}

async function eBuild(opts) {
  const { buildState } = await import("../src/app.js");
  const { withTTL } = await import("../src/core/sanitize.js");
  withTTL._s?.clear();
  const st = await buildState({ fetchImpl: eMock(opts), now: ENOW });
  withTTL._s?.clear();
  return st;
}

test("E1 端到端解耦：内部趋势由「下行」翻成「上行」，外部判断结论完全不变", async () => {
  const down = await eBuild({ aTrend: "下行" });
  const up = await eBuild({ aTrend: "上行" });
  assert.ok(down.technical && up.technical, "state 缺少 technical");
  assert.equal(down.technical.scenario, up.technical.scenario, "scenario 不应受内部趋势影响");
  assert.equal(down.technical.dir, up.technical.dir, "dir 不应受内部趋势影响");
  assert.equal(down.technical.score, up.technical.score, "score 不应受内部趋势影响");
  assert.deepEqual(down.technical.signals, up.technical.signals, "指标清单不应受内部趋势影响");
});

test("E2 账户事实数据完整保留（真实浮亏 / 均价 / 克重 / 资金）", async () => {
  const s = await eBuild();
  assert.ok(s.A && s.A.position, "账户持仓对象丢失");
  assert.ok(s.risk && typeof s.risk.pnl === "number", "真实浮亏丢失");
  assert.ok(s.rebal && s.grid, "再平衡 / 网格事实数据丢失");
  assert.ok(s.meta, "同步元信息丢失");
});

test("E3 异常边界：服务端指标缺失 → technical 降级且不白屏，账户卡仍渲染事实数据", async () => {
  const s = await eBuild({ bDown: true });
  assert.equal(s.technical.scenario, "degraded", "指标缺失必须降级");
  assert.equal(s.technical.dir, 0, "降级不得给方向");
  assert.ok(s.A && s.A.position && s.risk, "降级时账户事实数据仍须保留");
});
