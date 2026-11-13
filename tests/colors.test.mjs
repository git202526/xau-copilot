/**
 * v2.3.1 · 配色语义分层 + 数据口径修正（TDD 红灯）
 *
 * 用户指令：
 *  ①「浮亏不应该用红色，应该红涨绿跌」→ 红绿只表数值涨跌：涨/正/盈利=红，跌/负/亏损=绿
 *  ②「外部技术面偏多也不应用绿色」
 *  ③「偏多偏少其它判断应该用红绿以外的颜色」
 *     → 方向判断/状态类（偏多/偏空/评级/宏观/置信/熔断/额度/纪律/降级）
 *       禁用 red/green，改用 amber / violet / indigo / gray
 *  ④「我的 xau desk 应用没有剩余资金，数据从哪来的？」
 *     → 老应用 Source A 无资金字段；「可用资金」是预算克重派生量，须改口径并标注非账户余额
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assess } from "../src/core/risk.js";
import { decideTechnical, buildSignals, BADGE } from "../src/core/technical.js";
import { assessGrid } from "../src/core/grid.js";
import { discipline } from "../src/core/discipline.js";
import { calcPlan } from "../src/core/normalize.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(resolve(ROOT, p), "utf8");

/** 判断/状态类允许的中性色（红绿以外） */
const NEUTRAL = new Set(["amber", "violet", "indigo", "gray"]);
const isNeutral = (t) => NEUTRAL.has(t);

/* ─────────────── fixtures ─────────────── */
const mkB = (over = {}) => ({
  ok: true, priceUsdOz: 4100, spot: 4100, spotSource: "gold-api",
  dayPct: 1.2, devPct: 1.0, trend: 1, atr14: 30, ma20UsdOz: 4050,
  ratingOk: true, rating: { score: 65, label: "Buy" }, stale: false,
  indicators: {
    ok: true, rsi14: 60,
    macd: { line: 10, signal: 5, hist: 5, cross: "golden" },
    boll: { mid: 4050, upper: 4200, lower: 3900, pctB: 0.7, bandwidth: 7.4 },
    ma: { ma5: 4100, ma10: 4080, ma20: 4050, ma50: 4000 },
    align: "bull", price: 4100,
  },
  ...over,
});
const B_BEAR = mkB({
  dayPct: -1.2, devPct: -1.0, trend: -1,
  rating: { score: 35, label: "Sell" },
  indicators: {
    ok: true, rsi14: 40,
    macd: { line: -10, signal: -5, hist: -5, cross: "death" },
    boll: { mid: 4050, upper: 4200, lower: 3900, pctB: 0.3, bandwidth: 7.4 },
    ma: { ma5: 4000, ma10: 4020, ma20: 4050, ma50: 4100 },
    align: "bear", price: 4100,
  },
});
const C_BULL = { dir: 1, mode: "normal", label: "顺风", items: [] };
const C_BEAR = { dir: -1, mode: "normal", label: "逆风", items: [] };

const mkA = (over = {}) => ({
  position: { grams: 100, avgCost: 900 },
  plan: { ratio: 1.2, remainingFunds: 12, remainingGrams: 136, nextBuyAmount: 10, levels: [], ok: true },
  todayActions: [],
  ...over,
});

/** 提取某选择器对应的 CSS 规则体（静态守卫用） */
function cssBodies(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc + "\\s*\\{([^}]*)\\}", "g");
  const out = [];
  let m;
  while ((m = re.exec(css))) out.push(m[1]);
  return out;
}
const RED_GREEN = /var\(--red\)|var\(--green\)|255,\s*93,\s*82|63,\s*214,\s*140|#FF8A80|#6FE3AC|#FF5D52|#3FD68C/i;

/* ═══════════ A 组：红绿只表「数值涨跌」═══════════ */
test("A1 浮亏（跌/负）用绿，不得用红", () => {
  const r = assess({ A: mkA(), priceCnyGram: 880 });
  assert.ok(r.pnl < 0, "构造应为浮亏");
  assert.equal(r.pnlTone, "green", "浮亏属跌，按红涨绿跌应为绿");
});

test("A2 浮盈（涨/正）用红，不得用绿", () => {
  const r = assess({ A: mkA(), priceCnyGram: 920 });
  assert.ok(r.pnl > 0, "构造应为浮盈");
  assert.equal(r.pnlTone, "red", "浮盈属涨，按红涨绿跌应为红");
});

test("A3 异常边界①：pnl 缺失 → gray，且不抛异常", () => {
  const r = assess({ A: mkA({ position: {} }), priceCnyGram: 880 });
  assert.equal(r.pnl, null);
  assert.equal(r.pnlTone, "gray");
});

test("A4 render.js 数值类严格红涨绿跌（收益率 / 压力测试 / 溢价）", async () => {
  const s = await read("src/render.js");
  assert.match(s, /pnlPct < 0 \? "var\(--green\)" : "var\(--red\)"/, "收益率：跌绿涨红");
  assert.match(s, /color:var\(--green\)">\$\{r\.stressLoss/, "再跌 5%（跌）应为绿");
  assert.match(s, /p\.value > 0 \? "var\(--red\)" : "var\(--green\)"/, "溢价正负属数值涨跌，保留红涨绿跌");
});

test("A5 index.html 保留数值类红绿，并新增 change / judge 分层类", async () => {
  const css = await read("index.html");
  assert.match(css, /\.pnl\.red\{color:var\(--red\)\}/, "数值类 pnl 红须保留");
  assert.match(css, /\.pnl\.green\{color:var\(--green\)\}/, "数值类 pnl 绿须保留");
  assert.match(css, /\.tech-grid \.tc \.v\.chg-up\{color:var\(--red\)\}/, "change 类涨红");
  assert.match(css, /\.tech-grid \.tc \.v\.chg-dn\{color:var\(--green\)\}/, "change 类跌绿");
  assert.match(css, /\.tech-grid \.tc \.v\.bull\{color:var\(--amber\)\}/, "判断类偏多用琥珀");
  assert.match(css, /\.tech-grid \.tc \.v\.bear\{color:var\(--indigo\)\}/, "判断类偏空用靛蓝");
});

test("A6 buildSignals 标注 kind：只有纯数值涨跌项才允许红绿", () => {
  const byKey = Object.fromEntries(buildSignals(mkB(), C_BULL, {}).map((s) => [s.key, s]));
  for (const k of ["day", "ma20", "macd"]) assert.equal(byKey[k].kind, "change", `${k} 应为数值涨跌项`);
  for (const k of ["rsi", "boll", "align", "rating", "macro"]) assert.equal(byKey[k].kind, "judge", `${k} 应为方向判断项`);
  assert.equal(byKey.price.kind, "neutral");
});

/* ═══════════ B 组：判断/状态类禁用红绿 ═══════════ */
test("B1 tech_bull「偏多」tone 不得用绿色", () => {
  const t = decideTechnical({ B: mkB(), C: C_BULL });
  assert.equal(t.scenario, "tech_bull");
  assert.ok(isNeutral(t.tone), `偏多 tone=${t.tone}，必须是红绿以外的颜色`);
  assert.notEqual(t.tone, "green", "用户明确：外部技术面偏多不应用绿色");
});

test("B2 tech_bear「偏空」tone 不得用红色", () => {
  const t = decideTechnical({ B: B_BEAR, C: C_BEAR });
  assert.equal(t.scenario, "tech_bear");
  assert.ok(isNeutral(t.tone), `偏空 tone=${t.tone}，必须是红绿以外的颜色`);
});

test("B3 异常边界②：降级 / 避险 / 指标缺失 / 中性 tone 全为中性", () => {
  const cases = [
    ["源不可用", decideTechnical({ B: null })],
    ["避险", decideTechnical({ B: mkB(), C: { mode: "risk_off" } })],
    ["指标缺失", decideTechnical({ B: mkB({ indicators: { ok: false } }), C: C_BULL })],
    ["中性", decideTechnical({ B: mkB({ dayPct: 0, devPct: 0, trend: 0 }), C: { dir: 0, mode: "normal" } })],
  ];
  for (const [k, t] of cases) assert.ok(isNeutral(t.tone), `${k} tone=${t.tone} 必须为中性`);
});

test("B4 置信徽章对应 CSS 规则禁用红绿", async () => {
  const css = await read("index.html");
  for (const k of ["high", "medium", "low", "degraded"]) {
    const sel = "." + BADGE[k].cls;
    const bodies = cssBodies(css, sel);
    assert.ok(bodies.length > 0, `${sel} 未定义`);
    for (const b of bodies) assert.doesNotMatch(b, RED_GREEN, `${sel} 仍是红/绿`);
  }
});

test("B5 额度枯竭告警 tone 禁用红绿", () => {
  const r = assess({ A: mkA(), priceCnyGram: 880 });
  assert.equal(r.depleted, true, "构造应为额度不足");
  assert.ok(isNeutral(r.depletedTone), `枯竭 tone=${r.depletedTone} 应为中性`);
});

test("B6 网格熔断 tone 禁用红绿", () => {
  const g = assessGrid({ A: mkA(), atrUsdOz: 30, fx: 6.68, priceUsdOz: 4100, techDir: -1 });
  assert.equal(g.fuse, true, "构造应触发熔断");
  assert.ok(isNeutral(g.tone), `熔断 tone=${g.tone} 应为中性`);
});

test("B7 纪律违规 tone 禁用红绿", () => {
  const d = discipline({
    A: mkA({ todayActions: [{ type: "BUY", gram: 10, priceCny: 900 }] }),
    techDir: -1,
  });
  assert.equal(d.state, "violation", "构造应为违规");
  assert.ok(isNeutral(d.tone), `违规 tone=${d.tone} 应为中性`);
});

test("B8 index.html 判断类 CSS 规则整体禁用红绿", async () => {
  const css = await read("index.html");
  const selectors = [
    ".sig.buy", ".sig.sell", ".b-high", ".b-mid",
    ".chip.bad", ".chip.ok", ".dot", ".dot.bad",
    ".pill .v.up", ".pill .v.dn", ".vs .side .v.up", ".vs .side .v.dn",
    ".card.fuse",
  ];
  const hits = [];
  for (const sel of selectors) {
    for (const b of cssBodies(css, sel)) if (RED_GREEN.test(b)) hits.push(sel);
  }
  assert.deepEqual([...new Set(hits)], [], "判断类仍用红绿：" + [...new Set(hits)].join(", "));
});

test("B9 render.js 不得残留判断类红绿与误导性资金文案", async () => {
  const s = await read("src/render.js");
  const banned = [
    [/可用资金/, "M3 仍展示老应用不存在的资金口径"],
    [/pnlPct < 0 \? "var\(--red\)"/, "收益率跌仍用红"],
    [/color:var\(--red\)">\$\{r\.stressLoss/, "再跌 5%（跌）仍用红"],
    [/data-tone="\$\{depleted \? "red"/, "M3 状态条仍用 red"],
    [/depletedTone === "red" \? "red"/, "M3 告警条仍映射 red/green"],
    [/barTone = fuse \? "red"/, "M4 状态条仍用 red"],
    [/alert-strip \$\{d\.state === "violation" \? "red" : "green"\}/, "M6 判断告警仍用红绿"],
    [/alert-strip \$\{fuse \? "red"/, "M4 熔断告警仍用红"],
  ];
  const hits = banned.filter(([re]) => re.test(s)).map(([, why]) => why);
  assert.deepEqual(hits, [], "仍残留：" + hits.join("；"));
});

test("B10 判断类 tone 赋值全局收敛（数值类 pnlTone 除外）", async () => {
  const patterns = [
    /tone:\s*"green"/, /tone:\s*"red"/,
    /tone\s*=\s*"red"/,
    /depletedTone\s*=\s*[^;]*"red"/,
    /tone:\s*adverse\s*\?\s*"red"/,
  ];
  const hits = [];
  for (const f of ["src/core/technical.js", "src/core/risk.js", "src/core/grid.js", "src/core/discipline.js"]) {
    const s = await read(f);
    for (const re of patterns) if (re.test(s)) hits.push(`${f} 命中 ${re}`);
  }
  assert.deepEqual(hits, [], "判断类 tone 仍写死红绿：" + hits.join("；"));
});

test("B11 异常边界⑥：BUY 流水缺 gram/priceCny 不得抛异常，且 tone 仍为中性", () => {
  let d;
  assert.doesNotThrow(() => {
    d = discipline({ A: mkA({ todayActions: [{ type: "BUY" }] }), techDir: -1 });
  }, "脏操作流水不得让纪律模块抛异常（绝不白屏）");
  assert.equal(d.state, "violation");
  assert.ok(isNeutral(d.tone), `脏数据下 tone=${d.tone} 仍须中性`);
  assert.match(d.items[0].text, /--/, "缺失字段应显示占位符而非崩溃");
});

/* ═══════════ C 组：数据口径（老应用无资金字段）═══════════ */
test("C1 数据来源事实：老应用快照顶层无资金/余额字段", async () => {
  const j = JSON.parse(await read("data/live.json"));
  const keys = Object.keys(j).filter((k) => /资金|余额|可用|cash|fund|balance|capital|reserve|remain/i.test(k));
  assert.deepEqual(keys, [], "老应用若新增资金字段，须重新审视口径并同步本用例");
});

test("C2 assess 暴露 remainingGrams（真实底层字段）并保留 remainingFunds 兼容", () => {
  const r = assess({ A: mkA(), priceCnyGram: 880 });
  assert.equal(r.remainingGrams, 136);
  assert.equal(r.remainingFunds, 12);
});

test("C3 risk.js 额度文案改预算口径，不得再宣称「资金枯竭」", async () => {
  const a = await read("src/core/risk.js");
  assert.doesNotMatch(a, /资金枯竭/, "不得把预算派生量称为真实资金");
  assert.match(a, /预算额度/, "须标明预算口径");
  assert.match(a, /估算/, "须标明估算");
});

test("C4 render.js M3 不再出现「可用资金」，并标注非账户余额", async () => {
  const s = await read("src/render.js");
  assert.doesNotMatch(s, /可用资金/);
  assert.match(s, /持仓上限/, "v2.4.0 口径：剩余可买按持仓上限估算");
  assert.match(s, /非账户余额/);
});

test("C5 异常边界③：ratio 缺失 → 不枯竭、中性色、文案含不可得", () => {
  const r = assess({ A: mkA({ plan: {} }), priceCnyGram: 880 });
  assert.equal(r.depleted, false);
  assert.equal(r.depletedTone, "gray");
  assert.match(r.depletedText, /不可得/);
});

/* ═══════════ D 组：异常边界与端到端 ═══════════ */
test("D1 异常边界④：脏数据 calcPlan 不抛异常且派生值为 null", () => {
  const raw = { TOTAL: 0, gearCount: 9, H_BASE: 4696, startDrop: 15, endDrop: 34.3, wPct: [4, 6, 10, 14, 17, 18, 15, 10, 6], noCap: true };
  assert.doesNotThrow(() => calcPlan(raw, 0, 0));
  assert.equal(calcPlan(raw, 0, 0).remainingFunds, null);
});

test("D2 异常边界⑤：全源失效 → 降级、中性、不出方向", () => {
  const t = decideTechnical({ B: null, C: null, stale: true });
  assert.equal(t.scenario, "degraded");
  assert.ok(isNeutral(t.tone));
  assert.equal(t.dir, 0);
});

test("D3 端到端：浮亏绿 + 偏多非绿 + 额度中性 可同时成立", () => {
  const r = assess({ A: mkA(), priceCnyGram: 880, techDir: 1 });
  const t = decideTechnical({ B: mkB(), C: C_BULL });
  assert.equal(r.pnlTone, "green");
  assert.ok(isNeutral(t.tone) && t.tone !== "green");
  assert.ok(isNeutral(r.depletedTone));
});

/* ═══════════ E 组：防止「一刀切」删除数值红绿 ═══════════ */
test("E1 CSS 注释不得再把「偏多/偏空判断」与「涨跌红绿」混用", async () => {
  const css = await read("index.html");
  assert.doesNotMatch(css, /偏多\/涨 红|偏空\/跌 绿|空头用绿（跌）|国内习惯：偏多/);
});

test("E2 M2 指标网格按 kind 分层：change 用 chg-*，judge 用 bull/bear", async () => {
  const s = await read("src/render.js");
  assert.match(s, /it\.kind === "change"/, "须按 kind 区分数值涨跌与方向判断");
  assert.match(s, /chg-up/, "数值涨跌须用 chg-up/chg-dn");
  assert.match(s, /"bear"/, "方向判断须用 bull/bear");
});
