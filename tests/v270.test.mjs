/**
 * v2.7.0 · 档位口径对齐老应用 XAU Desk + 逐档可点
 *
 * 背景（用户反馈）：M4「网格效率与熔断」的档位价与老应用对不上，
 * 且每一档不能点开看该档分配了多少克。
 *
 * 根因：
 *   1) 旧实现只认「区间均分」一种口径：档距 = H×(终止−起始)/100/(n−1)，
 *      而老应用有 3 种档距方式（α×ATR / 目标均价反解 / 区间均分）+ 终止跌幅夹取；
 *      老应用当前 α=1.16、ATR14≈90.5 $/oz → 档距 105，旧实现算出 190.7，
 *      第 5 档 3275.9 对 3618.59，差 343 美元。
 *   2) 每档克重直接用 TOTAL×wPct，没走「可分配预算 = TOTAL − 未标记档位持仓」，
 *      也没走配额下沉（跌破档的待补额度按权重挪给未失效档），数量级完全不对。
 *
 * 本文件锁定（对齐老应用 gearBase / planBase / reallocPlan / gearState）：
 *   D1 第 1 档锚点 = H×(1−起始跌幅)
 *   D2 档距三口径：α×ATR / 目标反解 / 区间均分
 *   D3 终止跌幅夹取（只压不拉，clamped 可见）
 *   D4 可分配预算 = TOTAL − 未标记档位持仓
 *   D5 配额下沉（跌破档池子按权重分给接收方，Σ 不变）
 *   D6 老应用实拍对齐（105 档距 / 23.7051·39.5084·7.9017 克）
 *   D7 下一档 = 现价下方第一个未买满的档（与老应用高亮一致）
 *   D8 已买标记（gearMarks）→ 已补 / 待补 / 超买
 *   D9 降级不抛
 *   G1/G2 网格效率用对齐后的档距与 ATR/档距
 *   V1–V4 逐档可点（button + aria-expanded + 明细含克重/金额/距现价）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildGearPlan } from "../src/core/gear.js";
import { assessGrid } from "../src/core/grid.js";
import { renderGrid } from "../src/render.js";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} 期望 ${b}±${tol}，实际 ${a}`);

/* ── 老应用实拍基线（2026-11-16 13:10 截图）──
   H 4696（手动高点）、起始 14%、α 1.16、ATR14 90.5112、6 档、
   权重 5/5/30/50/10/0、TOTAL 400 克、未标档持仓 328.8848 克、现价 3874.69 */
const DESK_RAW = {
  gearCount: 6,
  H_BASE: 4696,
  startDrop: 14,
  endDrop: 34.3,
  wPct: [5, 5, 30, 50, 10, 0],
  alpha: 1.16,
  spanMode: "alpha",
  avgTarget: 3800,
  avgBand: 60,
  avgAnchor: 5,
  noCap: false,
  TOTAL: 400,
  realloc: { on: true, mode: "prop", ratio: 1, maxDrop: 3 },
  gearMarks: {},
};
const DESK = () =>
  buildGearPlan({
    cfg: DESK_RAW,
    unmarkedGrams: 328.8848,
    heldGrams: 328.8848,
    avgCostCny: 969,
    priceUsd: 3874.69,
    atrUsd: 90.5112,
    fx: 7.93,
  });

/* ───────────────── D1 第 1 档锚点 ───────────────── */
test("D1 第 1 档 = 高点 ×（1 − 起始跌幅），不是按终止跌幅均分的起点", () => {
  const g = DESK();
  near(g.p1, 4038.56, 0.01, "p1");
  near(g.levels[0].priceUsd, 4038.56, 0.01, "第1档");
  near(g.levels[0].dropPct, 14, 0.01, "第1档跌幅");
});

/* ───────────────── D2 档距三口径 ───────────────── */
test("D2a α×ATR：档距 = α × ATR14，与终止跌幅无关", () => {
  const g = DESK();
  near(g.d, 1.16 * 90.5112, 0.01, "档距");
  assert.equal(g.mode, "alpha");
});

test("D2b 目标反解：档距 =（p1 − 目标）/ 前 k 档权重重心", () => {
  const g = buildGearPlan({
    cfg: { ...DESK_RAW, spanMode: "target", noCap: true },
    unmarkedGrams: 328.8848,
    heldGrams: 0,
    priceUsd: 3874.69,
    atrUsd: 90.5112,
    fx: 7.93,
  });
  assert.equal(g.mode, "target");
  /* 权重 5/5/30/50/10 的前 5 档重心 =（0+5+60+150+40）/100 = 2.55 */
  near(g.d, (4038.56 - 3800) / 2.55, 0.05, "目标反解档距");
  near(g.levels[1].priceUsd, 4038.56 - (4038.56 - 3800) / 2.55, 0.06, "第2档");
});

test("D2c 区间均分：档距 = 终止−起始 均分 n 档", () => {
  const g = buildGearPlan({
    cfg: { ...DESK_RAW, spanMode: "range" },
    unmarkedGrams: 328.8848,
    heldGrams: 0,
    priceUsd: 3874.69,
    atrUsd: 90.5112,
    fx: 7.93,
  });
  assert.equal(g.mode, "range");
  near(g.d, ((34.3 - 14) / 100) * 4696 / 5, 0.01, "区间档距");
  near(g.levels[5].dropPct, 34.3, 0.01, "最深档落在终止跌幅");
});

test("D2d ATR 缺失时退化为 1%×高点，不返回 null 档距", () => {
  const g = buildGearPlan({
    cfg: { ...DESK_RAW, spanMode: "alpha" },
    unmarkedGrams: 328.8848,
    heldGrams: 0,
    priceUsd: 3874.69,
    atrUsd: null,
    fx: 7.93,
  });
  assert.equal(g.spanSrc, "fallback");
  near(g.d, 1.16 * 46.96, 0.02, "1% × H 兜底");
});

/* ───────────────── D3 终止跌幅夹取 ───────────────── */
test("D3 α 过大时按终止跌幅夹取档距（只压不拉），clamped 可见", () => {
  const g = buildGearPlan({
    cfg: { ...DESK_RAW, alpha: 3 },
    unmarkedGrams: 328.8848,
    heldGrams: 0,
    priceUsd: 3874.69,
    atrUsd: 90.5112,
    fx: 7.93,
  });
  const capD = ((34.3 - 14) / 100) * 4696 / 5;
  near(g.capD, capD, 0.01, "capD");
  near(g.d, capD, 0.01, "夹取后的档距");
  assert.equal(g.clamped, true);
  near(g.levels[5].dropPct, 34.3, 0.01, "最深档正好落在终止跌幅");
});

test("D3b α 正常时不得被夹取拉深（只压不拉）", () => {
  const g = DESK();
  assert.equal(g.clamped, false);
  near(g.d, 104.993, 0.01, "档距保持 α×ATR");
});

/* ───────────────── D4 可分配预算 ───────────────── */
test("D4 每档克重 =（TOTAL − 未标记档位持仓）× 权重占比", () => {
  const g = buildGearPlan({
    cfg: { ...DESK_RAW, realloc: { on: false } },
    unmarkedGrams: 328.8848,
    heldGrams: 328.8848,
    priceUsd: 3874.69,
    atrUsd: 90.5112,
    fx: 7.93,
  });
  near(g.budget, 71.1152, 0.001, "可分配预算");
  near(g.levels[2].planGrams, 71.1152 * 0.3, 0.001, "第3档");
  near(g.levels[3].planGrams, 71.1152 * 0.5, 0.001, "第4档");
});

/* ───────────────── D5 配额下沉 ───────────────── */
test("D5 跌破档的待补额度按权重下沉给未失效档，总量守恒", () => {
  const g = DESK();
  const sum = g.levels.reduce((a, l) => a + l.planGrams, 0);
  near(sum, g.budget, 1e-6, "Σ每档计划必须等于可分配预算");
  near(g.levels[0].planGrams, 0, 1e-6, "跌破的第1档不再留额度");
  near(g.levels[1].planGrams, 0, 1e-6, "跌破的第2档不再留额度");
  assert.equal(g.realloc.on, true);
  near(g.realloc.pool, 7.11152, 1e-4, "下沉池");
});

test("D5b 现价高于全部档位时不下沉（无失效档）", () => {
  const g = buildGearPlan({
    cfg: DESK_RAW,
    unmarkedGrams: 328.8848,
    heldGrams: 328.8848,
    priceUsd: 4300,
    atrUsd: 90.5112,
    fx: 7.93,
  });
  near(g.levels[0].planGrams, 3.55576, 1e-4, "第1档保留原计划");
  near(g.realloc.pool, 0, 1e-6, "无下沉");
});

/* ───────────────── D6 老应用实拍对齐 ───────────────── */
test("D6 与老应用实拍逐档对齐：档位价与分配克重", () => {
  const g = DESK();
  const want = [4038.56, 3933.57, 3828.57, 3723.58, 3618.59, 3513.6];
  g.levels.forEach((lv, i) => near(lv.priceUsd, want[i], 0.03, `第${i + 1}档价`));
  near(g.levels[2].planGrams, 23.7051, 0.001, "第3档补持");
  near(g.levels[3].planGrams, 39.5084, 0.001, "第4档补持");
  near(g.levels[4].planGrams, 7.9017, 0.001, "第5档补持");
});

/* ───────────────── D7 下一档 ───────────────── */
test("D7 下一档 = 现价下方第一个未买满的档（不是按克重比例反推）", () => {
  const g = DESK();
  assert.equal(g.nextIdx, 3);
  assert.equal(g.levels[2].isNext, true);
  assert.equal(g.levels[0].isNext, false, "现价上方的档不可能是下一档");
  assert.equal(g.levels[0].belowPrice, false);
  assert.equal(g.levels[2].belowPrice, true);
});

/* ───────────────── D8 已买标记 ───────────────── */
test("D8 gearMarks 记录已买克重 → 已补/待补/超买三态正确", () => {
  const g = buildGearPlan({
    cfg: {
      gearCount: 6, H_BASE: 4700, startDrop: 14, endDrop: 25, wPct: [5, 5, 30, 50, 10, 0],
      alpha: 1, spanMode: "alpha", avgAnchor: 5, noCap: true, TOTAL: 100,
      realloc: { on: false }, gearMarks: { 3: { g: 30 }, 4: { g: 10, sold: 2 } },
    },
    unmarkedGrams: 0,
    heldGrams: 40,
    priceUsd: 3900,
    atrUsd: 100,
    fx: 7.93,
  });
  near(g.levels[2].boughtGrams, 30, 1e-6, "第3档已补");
  near(g.levels[2].pendingGrams, 0, 1e-6, "第3档已买满");
  near(g.levels[3].boughtGrams, 8, 1e-6, "第4档净持仓要扣卖出");
  near(g.levels[3].pendingGrams, 42, 1e-6, "第4档待补 = 50 − 8");
  assert.equal(g.levels[2].isNext, false, "买满的档不是下一档");
});

/* ───────────────── D9 降级 ───────────────── */
test("D9 没有档位参数时不抛异常，返回空档位并标记 ok=false", () => {
  const g = buildGearPlan({});
  assert.equal(g.ok, false);
  assert.deepEqual(g.levels, []);
  assert.equal(g.d, null);
});

/* ───────────────── G1/G2 网格效率改用对齐档距 ───────────────── */
function mkGridState(gear, extra = {}) {
  const A = { ok: true, plan: { baseSpacing: 190.7, levels: [], gearCount: 6, highBase: 4696 } };
  return assessGrid({ A, gear, atrUsdOz: 90.5112, fx: 7.93, priceUsdOz: 3874.69, techDir: 0, ...extra });
}

test("G1 网格效率的「当前档距」用对齐后的档距，不是区间均分的老值", () => {
  const g = DESK();
  const gr = mkGridState(g);
  near(gr.spacingUsd, g.d, 0.01, "档距");
  near(gr.spacingCny, (g.d / 31.1035) * 7.93, 0.02, "折算元/克");
  assert.notEqual(Math.round(gr.spacingUsd), 191);
});

test("G2 ATR/档距 用同一口径的 ATR 与档距，比值同步变化", () => {
  const g = DESK();
  const gr = mkGridState(g);
  near(gr.ratio, 90.5112 / g.d, 1e-6, "比值");
  assert.equal(gr.ratioPct, 86);
  assert.equal(gr.state, "ok");
});

test("G2b 无 gear 时保留旧调用路径（baseSpacing 兜底），不抛", () => {
  const A = { ok: true, plan: { baseSpacing: 190.7, levels: [] } };
  const gr = assessGrid({ A, atrUsdOz: 90, fx: 7.93, priceUsdOz: 3900, techDir: 0 });
  near(gr.spacingUsd, 190.7, 0.01);
});

/* ───────────────── V1–V4 渲染与交互 ───────────────── */
function stateOf(gear, openIdx = -1) {
  const grid = mkGridState(gear);
  grid.openIdx = openIdx;
  return { grid, B: { priceUsdOz: 3874.69 }, now: Date.now() };
}

function mount(id) {
  const box = { id, innerHTML: "" };
  globalThis.document = { getElementById: (k) => (k === id ? box : null) };
  return box;
}

test("V1 六个档位都要渲染成可点的行（button + data-lv + aria-expanded）", () => {
  const box = mount("m4");
  renderGrid(stateOf(DESK()));
  const html = box.innerHTML;
  for (let i = 1; i <= 6; i++) {
    assert.match(html, new RegExp(`data-lv="${i}"`), `第${i}档行`);
  }
  assert.equal((html.match(/class="lv-row/g) || []).length, 6, "6 个档位行");
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<button[^>]*class="lv-row/, "档位行必须是 button（键盘可达）");
});

test("V2 点开某档后展示该档分配克重、待补、金额与距现价", () => {
  const box = mount("m4");
  renderGrid(stateOf(DESK(), 2));
  const html = box.innerHTML;
  assert.match(html, /data-lv="3"[^>]*aria-expanded="true"/, "第3档要展开");
  assert.match(html, /该档计划/);
  assert.match(html, /23\.7/, "该档分配克重要出现在明细里");
  assert.match(html, /待补/);
  assert.match(html, /距现价/);
  /* 金额要单独锚到「该档金额」这一行：整个快照里别处也有 ¥（触发价元/克），
     只断 /¥/ 会让「金额没折算成人民币」这种回归漏网（变异 M12 实测存活）。 */
  assert.match(html, /该档金额[\s\S]{0,60}?¥[\d.]+\s*万/, "该档金额必须折算成人民币万元");
});

test("V2b 展开任意一档都出明细，不限于「下一档」", () => {
  const box = mount("m4");
  /* 第 5 档不是下一档（下一档是第 3 档）——只给下一档做展开的实现会在这里露馅 */
  renderGrid(stateOf(DESK(), 4));
  const html = box.innerHTML;
  assert.match(html, /data-lv="5"[^>]*aria-expanded="true"/, "第5档要展开");
  assert.match(html, /该档计划[\s\S]{0,80}?7\.9/, "第5档明细要出现该档克重");
});

test("V3 口径要写在卡面上（档距怎么来的可核对）", () => {
  const box = mount("m4");
  renderGrid(stateOf(DESK()));
  const html = box.innerHTML;
  assert.match(html, /α/);
  assert.match(html, /ATR/);
  assert.match(html, /口径/);
});

test("V4 渲染产物零外链、零 emoji（图标只用内联 SVG）", () => {
  const box = mount("m4");
  renderGrid(stateOf(DESK(), 1));
  const html = box.innerHTML;
  assert.doesNotMatch(html, /https?:\/\//, "不得出现外部链接");
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "不得用 emoji 当图标");
  assert.match(html, /<svg/, "图标用内联 SVG");
});

test("V5 main.js 必须为档位行做事件委托并只重画 M4（不整页刷新）", async () => {
  const src = await read("src/main.js");
  assert.match(src, /data-lv/, "要按 data-lv 找行");
  assert.match(src, /renderGrid/, "点击后只重画 M4");
  assert.match(src, /openIdx/, "展开态存 state.grid.openIdx");
});
