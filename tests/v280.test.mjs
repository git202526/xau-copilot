/**
 * v2.8.0 · 熔断条下方列出「空 / 中性 / 多」的成立条件，并逐条打 ✔ / ✗
 *
 * 背景（用户反馈）：
 *   M4 熔断条只说「偏空 → 暂停买入，等转为中性再恢复」，但没告诉用户
 *   「转中性到底要满足什么」。用户看不到门槛，只能等，等于给了一句无法验证的话。
 *
 * 判定链的真实来源（src/core/technical.js，本文件不重写、只读）：
 *   前置 1  数据链正常：B.ok && !stale && indicators.ok      → 否则 degraded
 *   前置 2  无避险拦截：C.mode !== "risk_off"                 → 否则 risk_off
 *   然后    score = 多头权重 /（多头 + 空头）× 100（四舍五入）
 *   终判    score ≥ 60 → 偏多 ；score ≤ 40 → 偏空 ；其余 → 中性
 *
 * 本文件锁定：
 *   L1–L5 三种场景 × 两种前置，条件逐条 ✔/✗ 正确
 *   S1    三档门槛文案各自正确（≤40 / 41–59 / ≥60）
 *   S2    得分只能取 technical.score，不许本模块按权重重算（两处口径必然漂）
 *   S3    自洽性：active 档内所有条件都 ✔；非 active 档至少一条 ✗
 *   T1–T3 转中性缺口（还需 +/-X 分、折算多少权重）
 *   R1–R5 渲染：在熔断条下方、三档 × 三条、✔/✗ 用内联 SVG、零 emoji 零外链
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildLadder } from "../src/core/ladder.js";
import { assessGrid } from "../src/core/grid.js";
import { renderGrid } from "../src/render.js";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

/* ── 构造与 technical.js 同形状的入参 ──
   weights 与 score 刻意给成自洽值：bull/total 四舍五入后正好等于 score。
   S2 会另用一个「不自洽」的样本，验证 ladder 只认 score、不自己重算。 */
function tech({
  scenario = "tech_bear",
  dir = -1,
  score = 34,
  bull = 3.0,
  bear = 5.8,
  total = 8.8,
  voted = 7,
  mode = "normal",
} = {}) {
  return {
    scenario,
    conf: "medium",
    tone: "gray",
    dir,
    score,
    headline: "",
    text: "",
    detail: "",
    signals: [],
    weights: { bull, bear, total, voted },
    _mode: mode,
  };
}
/* risk_off / degraded 在 technical.js 里是独立 scenario，mode 只用来给 C 侧留痕 */
const riskOff = () =>
  tech({ scenario: "risk_off", dir: 0, score: null, bull: 0, bear: 0, total: 0, voted: 0, mode: "risk_off" });
const degradedT = () =>
  tech({ scenario: "degraded", dir: 0, score: null, bull: 0, bear: 0, total: 0, voted: 0, mode: "degraded" });
const neutralT = () => tech({ scenario: "tech_neutral", dir: 0, score: 45, bull: 3.96, bear: 4.84 });
const bullT = () => tech({ scenario: "tech_bull", dir: 1, score: 68, bull: 5.98, bear: 2.82 });

const tierOf = (L, key) => L.tiers.find((t) => t.key === key);
const condOf = (L, key, id) => tierOf(L, key).conds.find((c) => c.id === id);

/* ───────────────── L1 正常偏空 ───────────────── */
test("L1 偏空：前置两条 ✔、得分门槛 ✔，三档里只有偏空成立", () => {
  const L = buildLadder(tech());
  assert.equal(L.ok, true);
  assert.equal(L.tier, "bear");
  assert.equal(tierOf(L, "bear").active, true);
  assert.equal(tierOf(L, "neutral").active, false);
  assert.equal(tierOf(L, "bull").active, false);

  assert.equal(condOf(L, "bear", "data").ok, true, "数据链正常应为 ✔");
  assert.equal(condOf(L, "bear", "risk").ok, true, "无避险拦截应为 ✔");
  assert.equal(condOf(L, "bear", "score").ok, true, "34 ≤ 40 应为 ✔");
});

/* ───────────────── L2 降级 ───────────────── */
test("L2 降级：数据链一条 ✗ 就把三档全部否掉（不许在缺数据时给方向）", () => {
  const L = buildLadder(degradedT());
  assert.equal(L.ok, false);
  assert.equal(L.tier, null, "降级时不得落到任何一档（否则熔断逻辑会误判方向）");
  for (const key of ["bear", "neutral", "bull"]) {
    assert.equal(tierOf(L, key).active, false, `${key} 不得成立`);
    assert.equal(condOf(L, key, "data").ok, false, `${key} 的数据链条件必须 ✗`);
    assert.equal(condOf(L, key, "score").ok, false, `${key} 的得分条件必须 ✗`);
  }
  assert.match(condOf(L, "bear", "data").note, /降级/);
});

/* ───────────────── L3 避险 ───────────────── */
test("L3 避险：VIX 暴涨时三档同样全部否掉，但数据链仍 ✔（区分是拦截不是缺数据）", () => {
  const L = buildLadder(riskOff());
  assert.equal(L.ok, false);
  assert.equal(L.tier, null);
  for (const key of ["bear", "neutral", "bull"]) {
    assert.equal(tierOf(L, key).active, false, `${key} 不得成立`);
    assert.equal(condOf(L, key, "data").ok, true, "数据本身是好的");
    assert.equal(condOf(L, key, "risk").ok, false, `${key} 的避险条件必须 ✗`);
  }
  assert.match(condOf(L, "neutral", "risk").note, /避险/);
});

/* ───────────────── L4 / L5 中性、偏多 ───────────────── */
test("L4 中性：中性档三条全 ✔，偏空与偏多各有 ✗（用户看得见「为什么不是空/多」）", () => {
  const L = buildLadder(neutralT());
  assert.equal(L.tier, "neutral");
  assert.ok(tierOf(L, "neutral").conds.every((c) => c.ok), "中性档应全 ✔");
  assert.equal(condOf(L, "bear", "score").ok, false, "45 不满足 ≤40");
  assert.equal(condOf(L, "bull", "score").ok, false, "45 不满足 ≥60");
});

test("L5 偏多：偏多档三条全 ✔，偏空档得分条 ✗", () => {
  const L = buildLadder(bullT());
  assert.equal(L.tier, "bull");
  assert.ok(tierOf(L, "bull").conds.every((c) => c.ok), "偏多档应全 ✔");
  assert.equal(condOf(L, "bear", "score").ok, false);
});

/* ───────────────── S1 门槛文案 ───────────────── */
test("S1 三档门槛必须写清区间，且与 technical.js 的 40 / 60 阈值一致", async () => {
  const L = buildLadder(tech());
  assert.match(condOf(L, "bear", "score").text, /≤\s*40/);
  assert.match(condOf(L, "neutral", "score").text, /41\s*[–-]\s*59/);
  assert.match(condOf(L, "bull", "score").text, /≥\s*60/);

  /* 阈值不许各写一份：从 technical.js 读出来对齐，改一边而另一边没改会在这里炸 */
  const src = await read("src/core/technical.js");
  assert.match(src, /bullScore:\s*60/, "technical.js 的多头阈值应为 60");
  assert.match(src, /bearScore:\s*40/, "technical.js 的空头阈值应为 40");
});

/* ───────────────── S2 单一来源 ───────────────── */
test("S2 得分只认 technical.score，不按 weights 重算（否则两处口径必漂）", () => {
  /* weights 明显算不出 34（bull/bear=6.6/1.6 → 80 分），若 ladder 自己重算就会露馅 */
  const L = buildLadder(tech({ score: 34, bull: 6.6, bear: 1.6, total: 8.2 }));
  assert.equal(L.score, 34, "必须沿用 technical.score");
  assert.equal(L.tier, "bear", "档位也必须沿用 technical.scenario 推出的结果");
  assert.equal(condOf(L, "bear", "score").ok, true);
});

/* ───────────────── S3 自洽性 ───────────────── */
test("S3 自洽：active 档全 ✔，非 active 档至少一条 ✗（五类样本轮询）", () => {
  const samples = [tech(), neutralT(), bullT(), riskOff(), degradedT()];
  for (const t of samples) {
    const L = buildLadder(t);
    assert.equal(L.tiers.length, 3, "三档必须都在（空实现会让 every() 假性通过）");
    for (const tier of L.tiers) {
      const allOk = tier.conds.every((c) => c.ok);
      assert.equal(
        allOk,
        tier.active,
        `${t.scenario}/${tier.key}：条件全 ✔ 与 active 必须等价（实际 allOk=${allOk} active=${tier.active}）`,
      );
    }
    const actives = L.tiers.filter((x) => x.active);
    assert.ok(actives.length <= 1, `${t.scenario} 不允许同时成立两档`);
  }
});

/* ───────────────── T1–T3 转中性缺口 ───────────────── */
test("T1 偏空 34 分：转中性还差 +7 分，折算约 0.62 个权重", () => {
  const L = buildLadder(tech());
  assert.equal(L.delta, 7, "34 → 41 需要 +7");
  assert.ok(Math.abs(L.weightsNeeded - 0.62) < 0.01, `权重缺口应约 0.62，实际 ${L.weightsNeeded}`);
  assert.equal(L.deltaDir, "up", "偏空时要涨分");
});

test("T2 已在中带：缺口为 0，不需要任何翻转", () => {
  const L = buildLadder(neutralT());
  assert.equal(L.delta, 0);
  assert.equal(L.weightsNeeded, 0);
  assert.equal(L.deltaDir, "none");
});

test("T3 偏多 68 分：要转中性得往回落 9 分（方向不能写成「还需涨分」）", () => {
  const L = buildLadder(bullT());
  assert.equal(L.delta, -9, "68 → 59 需要 -9");
  assert.equal(L.deltaDir, "down");
  assert.ok(Math.abs(L.weightsNeeded - 0.79) < 0.01, `权重缺口应约 0.79，实际 ${L.weightsNeeded}`);
});

/* ───────────────── 渲染 ───────────────── */
function mount(id) {
  const box = { id, innerHTML: "" };
  globalThis.document = { getElementById: (k) => (k === id ? box : null) };
  return box;
}

function gridState(technical, { fuse = true } = {}) {
  const grid = assessGrid({
    A: { plan: { baseSpacing: 22.49, gearCount: 6, highBase: 4696 } },
    gear: null,
    atrUsdOz: 19.39,
    fx: 7.1,
    priceUsdOz: 3874.69,
    techDir: technical.dir,
    ladder: buildLadder(technical),
  });
  grid.fuse = fuse;
  return { grid, technical, B: { priceUsdOz: 3874.69 }, now: Date.now() };
}

test("R1 渲染出三档标题与逐条 ✔/✗", () => {
  const box = mount("m4");
  renderGrid(gridState(tech()));
  const html = box.innerHTML;
  assert.match(html, /偏空/);
  assert.match(html, /中性/);
  assert.match(html, /偏多/);
  assert.equal((html.match(/class="cond /g) || []).length, 9, "三档 × 三条 = 9 条条件");
  /* 两态都要出现：偏空样本里 bear 档 3 条全 ✔、neutral/bull 各有一条 ✗ */
  assert.equal((html.match(/class="cond ok"/g) || []).length, 7, "✔ 条数");
  assert.equal((html.match(/class="cond no"/g) || []).length, 2, "✗ 条数");
});

test("R2 条件表必须挂在熔断提醒条下方（用户位置要求）", () => {
  const box = mount("m4");
  renderGrid(gridState(tech()));
  const html = box.innerHTML;
  const iAlert = html.indexOf("alert-strip");
  const iLadder = html.indexOf("tech-ladder");
  assert.ok(iAlert >= 0, "必须先有熔断提醒条");
  assert.ok(iLadder > iAlert, `条件表要在提醒条之后（alert=${iAlert} ladder=${iLadder}）`);
  /* 只比 order 不够：把块挪到 </section> 之后也能过（变异 M11 实测存活）。
     位置要求是「在卡片里、在提醒条下方」，所以要同时钉住卡片闭合位置。 */
  assert.ok(iLadder < html.lastIndexOf("</section>"), "条件表必须仍在卡片内部");
});

test("R3 ✔/✗ 用内联 SVG，不许用符号字符或 emoji", () => {
  const box = mount("m4");
  renderGrid(gridState(tech()));
  const html = box.innerHTML;
  assert.match(html, /<svg[^>]*class="cond-ico"/, "勾叉要画成 SVG");
  assert.doesNotMatch(html, /[\u2713\u2714\u2717\u2718\u2611\u2612]/, "不得用 ✓✔✗✘ 字符");
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "不得用 emoji");
  assert.doesNotMatch(html, /https?:\/\//, "不得出现外部链接");
});

test("R4 文案要写明「转中性还差多少分」，这样用户不用猜", () => {
  const box = mount("m4");
  renderGrid(gridState(tech()));
  const html = box.innerHTML;
  assert.match(html, /转中性/);
  assert.match(html, /\+\s*7\s*分|7 分/, "34 分时要写清还差 7 分");
});

test("R5 降级时条件表仍渲染（说明为什么三档都不成立），不白块", () => {
  const box = mount("m4");
  renderGrid(gridState(degradedT(), { fuse: false }));
  const html = box.innerHTML;
  assert.match(html, /tech-ladder/);
  assert.match(html, /降级/);
  assert.equal((html.match(/class="cond /g) || []).length, 9);
});

test("T4 无投票权重时不写「≈ null 个指标」（缺数据也要出人话）", () => {
  /* total=0 的极端：所有指标都 dir=0，technical 会给 score 50 / total 0 */
  const L = buildLadder(tech({ scenario: "tech_neutral", dir: 0, score: 50, bull: 0, bear: 0, total: 0, voted: 0 }));
  assert.equal(L.weightsNeeded, null);
  assert.equal(L.delta, 0);
  assert.doesNotMatch(L.hint, /null/, "缺权重时不得出现 null");
  assert.match(L.hint, /已在中带/);
});

test("R6 前置两条与门槛条要能区分（重复项压低视觉重量，门槛加粗）", () => {
  const box = mount("m4");
  renderGrid(gridState(tech()));
  const html = box.innerHTML;
  assert.equal((html.match(/data-k="pre"/g) || []).length, 6, "三档 × 2 条前置");
  assert.equal((html.match(/data-k="gate"/g) || []).length, 3, "三档 × 1 条门槛");
});

test("B1 阈值边界：40 / 41 / 59 / 60 必须落在正确的一档（≤ 与 < 写反会在这里露）", () => {
  const cases = [
    { score: 40, tier: "bear" },
    { score: 41, tier: "neutral" },
    { score: 59, tier: "neutral" },
    { score: 60, tier: "bull" },
  ];
  const scen = { bear: "tech_bear", neutral: "tech_neutral", bull: "tech_bull" };
  for (const c of cases) {
    const L = buildLadder(tech({ score: c.score, scenario: scen[c.tier], dir: c.tier === "bear" ? -1 : c.tier === "bull" ? 1 : 0 }));
    assert.equal(L.tier, c.tier, `${c.score} 分应判 ${c.tier}`);
    const act = L.tiers.find((t) => t.active);
    assert.ok(act.conds.every((x) => x.ok), `${c.score} 分时 ${act.key} 档应全 ✔`);
    const other = L.tiers.filter((t) => t.key !== c.tier);
    for (const o of other) assert.ok(o.conds.some((x) => !x.ok), `${c.score} 分时 ${o.key} 档应有一条 ✗`);
  }
});
