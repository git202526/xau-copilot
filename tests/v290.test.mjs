/**
 * v2.9.0 · 首页结论分层 + 趋势判断与情景预测；技术面加入因子贡献与位置尺
 *
 * 用户反馈：「首页结论不够丰富，没有层次，没有趋势判断和预测。技术面分析也过于简陋。」
 *
 * 设计依据（调研结论，写入 docs/data-freshness.md 第 11 章）：
 *   1) 机构研究稿不是「一句结论」，而是 定调 → 依据分层 → 关键位 → 情景 → 失效条件 五段式。
 *      ChartGuru 的 XAU/USD 工作流：regime → key levels → momentum → invalidation。
 *   2) 预测不做点估计，做「波动区间 + 情景概率」：σ1 取 20 日收盘对数收益的总体标准差，
 *      多周期按 √n 扩张；ATR 缺失时用 σ ≈ ATR × √(π/8) 换算（range→sigma 的标准近似）。
 *   3) 概率是模型值，不是统计保证 —— 页面必须标注，不许写成「必到」。
 *
 * 本文件锁定：
 *   O1–O3  降级 / 数据不足 / σ 双通道（realized 优先，ATR 兜底）
 *   O4–O7  区间 √n 扩张、三情景概率和为 1、方向随得分单调、落点价有序
 *   O8     分层聚合只读 signals 的 dir × weight，绝不重算方向（v2.7.0 同口径教训）
 *   O9–O10 关键位分类/排序/去重
 *   O11    失效条件随方向翻转，且门槛与 technical 阈值同源
 *   O12–O13 空输入与退化序列不崩、不泄漏 NaN
 *   R1–R6  首页分层渲染与技术面增强的 DOM 契约（内联 SVG、零外链、零 emoji）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildOutlook } from "../src/core/outlook.js";
import { buildLadder } from "../src/core/ladder.js";
import { renderBriefing, renderDecision } from "../src/render.js";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

/* ── 造一份「指标齐全」的 B ──
   closes 用 100/101 交替：对数收益恒为 ±ln(1.01)，20 日总体标准差恰为 ln(1.01)，
   与「样本标准差」差一个 √(20/19) 因子 —— 断言能一眼分辨用的是哪一种。 */
const ALT = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 100 : 101));
const SIGMA_ALT = Math.log(1.01);

function mkB(over = {}) {
  return {
    ok: true,
    priceUsdOz: 101,
    ma20UsdOz: 99.5,
    devPct: 1.51,
    atr14: 1.4,
    lastClose: 101,
    closes: ALT,
    maSeries: Array.from({ length: 30 }, (_, i) => 99.5 + i * 0.01),
    indicators: {
      ok: true,
      rsi14: 38,
      macd: { line: -1.2, signal: -0.8, hist: -0.4, cross: "death" },
      boll: { mid: 99.5, upper: 102, lower: 97, pctB: 0.44, bandwidth: 5.02 },
      ma: { ma5: 100.6, ma10: 100.2, ma20: 99.5, ma50: 98.1 },
      align: "mixed",
    },
    ...over,
  };
}

function mkt(over = {}) {
  return {
    scenario: "tech_bear",
    conf: "high",
    tone: "indigo",
    dir: -1,
    score: 13,
    headline: "外部技术面偏空",
    text: "",
    detail: "",
    weights: { bull: 1.0, bear: 6.6, total: 7.6, voted: 6 },
    signals: [
      { key: "price", label: "伦敦金现", value: "3,722.31", dir: 0, weight: 0, kind: "neutral" },
      { key: "ma20", label: "MA20 偏离", value: "-6.37%", dir: -1, weight: 1.2, kind: "change" },
      { key: "day", label: "日内涨跌", value: "-3.30%", dir: -1, weight: 1, kind: "change" },
      { key: "atr", label: "ATR14", value: "87.8", dir: 0, weight: 0, kind: "neutral" },
      { key: "rsi", label: "RSI14", value: "33.5", dir: -1, weight: 1, kind: "judge" },
      { key: "macd", label: "MACD 柱", value: "-19.28", dir: -1, weight: 1.2, kind: "change" },
      { key: "boll", label: "布林 %B", value: "-0.12", dir: 1, weight: 1, kind: "judge" },
      { key: "align", label: "均线排列", value: "空头排列", dir: -1, weight: 1.5, kind: "judge" },
      { key: "rating", label: "技术评级", value: "强烈卖出 0", dir: -1, weight: 1, kind: "judge" },
      { key: "macro", label: "宏观风向", value: "中性", dir: 0, weight: 0.8, kind: "judge" },
    ],
    ...over,
  };
}

const cfg = { techBullScore: 60, techBearScore: 40 };

function build(over = {}) {
  const B = over.B || mkB();
  const tech = over.technical || mkt();
  const ladder = over.ladder === null ? null : buildLadder(tech, cfg);
  return buildOutlook({ B, technical: tech, ladder, cfg, now: Date.UTC(2026, 10, 19, 13, 30), fxRate: 7.1 });
}

/* ───────────────── O1 降级：不给方向、不编区间 ───────────────── */
test("O1 行情不可用/指标缺失 → 明确降级，range 与 scenarios 不出数", () => {
  for (const B of [{ ok: false, priceUsdOz: null }, mkB({ indicators: null }), mkB({ stale: true })]) {
    const o = buildOutlook({ B, technical: mkt({ scenario: "degraded", dir: 0, score: null }), ladder: null, cfg });
    assert.equal(o.ok, false, "降级时 ok 必须为 false");
    assert.equal(o.range, null);
    assert.deepEqual(o.scenarios, []);
    assert.equal(o.levels.length, 0);
    assert.ok(o.reason && o.reason.length > 4, "降级必须给人话原因");
  }
});

/* ───────────────── O2 σ 取 20 日对数收益总体标准差 ───────────────── */
test("O2 σ 为总体标准差（不是样本标准差，不差 √(n/(n−1))）", () => {
  const o = build();
  assert.equal(o.range.src, "realized");
  assert.ok(Math.abs(o.range.sigma1Pct - SIGMA_ALT * 100) < 1e-4, `σ1=${o.range.sigma1Pct}，应为 ${(SIGMA_ALT * 100).toFixed(4)}`);
  assert.equal(o.range.samples, 20);
});

/* ───────────────── O3 closes 不足 → ATR × √(π/8) 兜底 ───────────────── */
test("O3 收盘序列不足 21 根时，用 ATR × √(π/8) 换算 σ 并标注来源", () => {
  const B = mkB({ closes: [99, 100, 101], priceUsdOz: 4000, atr14: 80, indicators: { ...mkB().indicators } });
  const o = build({ B });
  assert.equal(o.range.src, "atr");
  const want = ((80 * Math.sqrt(Math.PI / 8)) / 4000) * 100;
  assert.ok(Math.abs(o.range.sigma1Pct - want) < 1e-3, `σ1=${o.range.sigma1Pct}，应为 ${want.toFixed(3)}`);
});

/* ───────────────── O4 区间按 √n 扩张，且上下对称（对数空间） ───────────────── */
test("O4 5 日 1σ 区间 = 1 日 × √5，上下沿在对数空间对称", () => {
  const o = build();
  const r = o.range;
  assert.ok(Math.abs(r.sigma5Pct - r.sigma1Pct * Math.sqrt(5)) < 1e-6);
  const ratio1 = Math.log(r.d1.hi / r.d1.lo);
  assert.ok(Math.abs(ratio1 - (2 * r.sigma1Pct) / 100) < 1e-6, "1 日上下沿不对称");
  const ratio5 = Math.log(r.d5.hi / r.d5.lo);
  assert.ok(Math.abs(ratio5 - (2 * r.sigma5Pct) / 100) < 1e-6, "5 日上下沿不对称");
  assert.ok(r.d5.hi > r.d1.hi && r.d5.lo < r.d1.lo, "5 日区间必须比 1 日更宽");
});

/* ───────────────── O5 三情景概率和为 1，且各自落在 0–1 ───────────────── */
test("O5 三情景概率严格合计 100%", () => {
  for (const score of [0, 13, 50, 77, 100]) {
    const o = build({ technical: mkt({ score }) });
    const sum = o.scenarios.reduce((a, s) => a + s.prob, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `score=${score} 概率和=${sum}`);
    for (const s of o.scenarios) assert.ok(s.prob >= 0 && s.prob <= 1);
  }
});

/* ───────────────── O6 方向随得分单调 ───────────────── */
test("O6 得分越低，下探情景概率越高；上探反之", () => {
  const lo = build({ technical: mkt({ score: 10 }) });
  const mid = build({ technical: mkt({ score: 50 }) });
  const hi = build({ technical: mkt({ score: 90 }) });
  const p = (o, k) => o.scenarios.find((s) => s.key === k).prob;
  assert.ok(p(lo, "down") > p(mid, "down"), "低分下探概率未更高");
  assert.ok(p(mid, "down") > p(hi, "down"), "高分下探概率未更低");
  assert.ok(p(hi, "up") > p(mid, "up") && p(mid, "up") > p(lo, "up"));
  assert.ok(p(mid, "down") === p(mid, "up"), "中性时应上下对称");
});

/* ───────────────── O7 情景落点价有序，且中位贴近现价 ───────────────── */
test("O7 下探落点 < 中位落点 < 上探落点，中位不偏离现价 1% 以上", () => {
  const o = build({ technical: mkt({ score: 13 }) });
  const [down, mid, up] = ["down", "mid", "up"].map((k) => o.scenarios.find((s) => s.key === k));
  assert.ok(down.targetUsd < mid.targetUsd && mid.targetUsd < up.targetUsd);
  assert.ok(Math.abs(mid.targetUsd / o.priceUsd - 1) < 0.01, "中位落点离现价过远，说明漂移项过大");
});

/* ───────────────── O8 分层只聚合、不重算 ───────────────── */
test("O8 四层净票 = Σ(dir × weight)，与 technical.score 无关", () => {
  const o = build();
  const net = Object.fromEntries(o.layers.map((l) => [l.key, l.net]));
  assert.equal(net.trend, -2.7);      // ma20 −1.2 + align −1.5
  assert.equal(net.momentum, -3.2);   // day −1 + rsi −1 + macd −1.2
  assert.equal(net.band, 1);          // boll +1（触下轨，超卖反弹票）
  assert.equal(net.ext, -1);          // rating −1 + macro 0
  const total = o.layers.reduce((a, l) => a + l.net, 0);
  assert.ok(Math.abs(total - -5.9) < 1e-9);

  /* 给一份「方向与得分刻意不自洽」的信号：聚合仍只认 dir×weight */
  const bogus = mkt({ score: 99, signals: mkt().signals });
  const o2 = build({ technical: bogus });
  assert.equal(o2.layers.find((l) => l.key === "trend").net, -2.7);
});

test("O8b 信号缺少 layer 字段时按 key 兜底归类，不丢票", () => {
  const o = build();
  const voted = o.layers.reduce((a, l) => a + l.voted, 0);
  const want = mkt().signals.filter((s) => s.weight > 0 && s.dir !== 0).length;
  assert.equal(voted, want, `有票没归到任何一层（${voted} ≠ ${want}）`);
});

/* ───────────────── O9 关键位：分类、排序、每侧最多 2 个 ───────────────── */
test("O9 支撑全部低于现价、阻力全部高于现价，按距离由近到远", () => {
  const o = build();
  const sup = o.levels.filter((l) => l.kind === "sup");
  const res = o.levels.filter((l) => l.kind === "res");
  assert.ok(sup.length >= 1 && res.length >= 1, "两侧都要有关键位，空列表不算通过");
  assert.ok(sup.length <= 2 && res.length <= 2);
  for (const l of sup) assert.ok(l.priceUsd < o.priceUsd);
  for (const l of res) assert.ok(l.priceUsd > o.priceUsd);
  for (const arr of [sup, res]) {
    for (let i = 1; i < arr.length; i++) {
      assert.ok(Math.abs(arr[i].distPct) > Math.abs(arr[i - 1].distPct), "未按距离由近到远排序");
    }
  }
});

test("O10 同一价位多来源只保留一条（不重复占位）", () => {
  /* 刻意造重叠：MA5 = MA10，布林下轨只差 0.05% —— 不去重就会把同一个价摆两次，
     近端两名被它俩占满，真正的 100.0 反而被挤掉。 */
  const B = mkB({
    indicators: {
      ...mkB().indicators,
      ma: { ma5: 100.6, ma10: 100.6, ma20: 99.5, ma50: 98.1 },
      boll: { mid: 99.5, upper: 102, lower: 100.55, pctB: 0.44, bandwidth: 5.02 },
    },
  });
  const o = build({ B });
  assert.ok(o.levels.length >= 3, "关键位少于 3 条，去重断言没有意义");
  const keys = o.levels.map((l) => l.priceUsd.toFixed(1));
  assert.equal(new Set(keys).size, keys.length, `关键位出现重复价位：${keys.join(",")}`);
  const sup = o.levels.filter((l) => l.kind === "sup");
  assert.equal(sup.length, 2);
  assert.ok(sup[1].priceUsd < 100.5, "重叠位把 20 日低挤掉了，说明没去重");
});

/* ───────────────── O11 失效条件与阈值同源 ───────────────── */
test("O11 偏空时失效条件指向「站上均线 + 得分回 41」，偏多时反向", () => {
  const bear = build();
  assert.ok(bear.invalidate.length >= 2);
  assert.ok(bear.invalidate.some((x) => /站上|收复/.test(x.text)), "偏空缺少「站上」类失效条件");
  assert.ok(bear.invalidate.some((x) => /41/.test(x.text)), "失效门槛必须来自 technical 阈值（41）");
  assert.ok(bear.invalidate.every((x) => x.met === false), "当前就该是「未触发」");

  const bull = build({ technical: mkt({ scenario: "tech_bull", dir: 1, score: 84 }) });
  assert.ok(bull.invalidate.some((x) => /跌破|失守/.test(x.text)));
  assert.ok(bull.invalidate.some((x) => /59/.test(x.text)));
});

/* ───────────────── O12/O13 退化不崩 ───────────────── */
test("O12 B 为 null / 空对象时不抛异常", () => {
  for (const B of [null, {}, { ok: true }]) {
    const o = buildOutlook({ B, technical: mkt(), ladder: null, cfg });
    assert.equal(o.ok, false);
    assert.ok(typeof o.reason === "string" && o.reason.length > 4, "降级必须给人话原因");
  }
});

test("O13 收盘全等（σ=0）时不出现 NaN，区间降级为「不可测」", () => {
  const B = mkB({ closes: Array(30).fill(100), atr14: null, priceUsdOz: 100 });
  const o = build({ B });
  const s = JSON.stringify(o);
  assert.ok(!/NaN|null,"price"|Infinity/.test(s), `退化序列泄漏脏值：${s.slice(0, 400)}`);
  assert.equal(o.range.src, "none");
  assert.equal(o.range.d1, null);
});

/* ───────────────── R1–R3 首页分层渲染 ───────────────── */
function stateFor(o) {
  return {
    ok: true,
    now: Date.UTC(2026, 10, 19, 13, 30),
    B: mkB(),
    C: { mode: "normal", dir: 0, label: "分歧", panic: false, items: [] },
    technical: mkt(),
    outlook: o,
    meta: { staleA: false, staleB: false, degraded: false },
  };
}

test("R1 首页必须给出：定调、四层一致性、5 日区间、三情景、失效条件", () => {
  const o = build();
  globalThis.document = { getElementById: () => ({ innerHTML: "" }) };
  const box = { innerHTML: "" };
  globalThis.document.getElementById = () => box;
  renderBriefing(stateFor(o));
  const h = box.innerHTML;
  assert.match(h, /bl-stance/, "缺少定调");
  assert.equal((h.match(/class="ly"/g) || []).length, 4, "四层一致性条不是 4 层");
  assert.match(h, /cone-svg/, "缺少 5 日区间可视化");
  assert.equal((h.match(/class="sc"/g) || []).length, 3, "情景不是 3 个");
  assert.match(h, /什么会推翻它/, "缺少失效条件区");
  for (const t of ["下探", "横盘", "反抽"]) assert.ok(h.includes(t), `缺少情景「${t}」`);
  assert.ok(!/NaN|undefined|Infinity/.test(h), "渲染出现脏值");
});

test("R2 首页结论必须仍在 M1 之前（顺序不变）", async () => {
  const html = await read("index.html");
  assert.ok(html.indexOf('id="m0"') < html.indexOf('id="m1"'));
  assert.ok(html.indexOf('id="m0"') > 0);
});

test("R3 技术面：因子贡献条 + 均线位置尺 + RSI 刻度，且全部内联 SVG", () => {
  const box = { innerHTML: "" };
  globalThis.document = { getElementById: () => box };
  renderDecision(stateFor(build()));
  const h = box.innerHTML;
  assert.equal((h.match(/data-f="/g) || []).length, 7, "贡献条数量应等于投票项数（7）");
  assert.match(h, /class="ma-ruler"/, "缺少均线位置尺");
  assert.match(h, /class="rsi-gauge"/, "缺少 RSI 刻度");
  assert.ok(!/<img|https?:\/\//.test(h), "禁止外链资源");
  assert.ok(!/[\u2705\u274C\u2714\u2716]/.test(h), "禁止用 emoji / ✔✘ 字符当图标");
});

test("R4 首页与技术面渲染不得引用任何外部资源", () => {
  const box = { innerHTML: "" };
  globalThis.document = { getElementById: () => box };
  renderBriefing(stateFor(build()));
  const h1 = box.innerHTML;
  renderDecision(stateFor(build()));
  const h2 = box.innerHTML;
  for (const h of [h1, h2]) {
    assert.ok(!/<script|<link|<img/i.test(h));
    assert.ok(!/https?:\/\//.test(h));
  }
});

test("R5 降级时首页不装样子：不显示情景概率与落点价", () => {
  const o = buildOutlook({ B: { ok: false }, technical: mkt({ scenario: "degraded", dir: 0, score: null }), ladder: null, cfg });
  const box = { innerHTML: "" };
  globalThis.document = { getElementById: () => box };
  renderBriefing(stateFor(o));
  const h = box.innerHTML;
  assert.equal((h.match(/class="sc"/g) || []).length, 0);
  assert.match(h, /降级|作废|不可用/);
});

test("R6 时间窗标注必须是「未来 5 个交易日」且概率标注为模型值", () => {
  const box = { innerHTML: "" };
  globalThis.document = { getElementById: () => box };
  renderBriefing(stateFor(build()));
  const h = box.innerHTML;
  assert.match(h, /5 个交易日/);
  assert.match(h, /模型|非保证/, "概率必须声明是模型值");
});
