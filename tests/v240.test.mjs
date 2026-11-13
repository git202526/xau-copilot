/**
 * v2.4.0 用例：7 项用户反馈的验收守卫
 *
 * A 中文标签（DXY/TNX/VIX + 技术评级）
 * B 网格档位克重
 * C 剩余可买按持仓上限估算
 * D 账户数据新鲜度分级
 * E 顶部版本号（单一来源）
 * F 回归守卫（零双印证 / 配色不回归 / 七模块）
 * G 网格效率展示
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { calcPlan } from "../src/core/normalize.js";
import { assess } from "../src/core/risk.js";
import { assessGrid } from "../src/core/grid.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(ROOT, p), "utf8");
const readJSON = async (p) => JSON.parse(await read(p));
const dyn = async (p) => { try { return await import(p); } catch { return null; } };

/* 线上真实结构样本：TOTAL=400、6 档、wPct=[5,5,30,50,10,0]、3 笔买入 gear 全 null */
const RAW = {
  TOTAL: 400, noCap: false, gearCount: 6, H_BASE: 4696,
  startDrop: 14, endDrop: 34.3, wPct: [5, 5, 30, 50, 10, 0],
  buys: [
    { gram: 71.6283, priceCny: 959.41, gear: null, acct: "a1", time: "2026-11-03T06:00:00.000Z" },
    { gram: 84.8365, priceCny: 949.73, gear: null, acct: "a2", time: "2026-11-03T06:10:00.000Z" },
    { gram: 172.42, priceCny: 988.2091, gear: null, acct: "a0", time: "2026-11-03T07:01:00.000Z" },
  ],
  sells: [{ gram: 1, priceCny: 950, acct: "a0", time: "2026-11-04T06:00:00.000Z" }],
};
const GRAMS = 327.88;
const PRICE = 840.6;

/* ───────────────── A 中文标签 ───────────────── */

test("A1 ratingZh 覆盖五档 + 大小写 + 未知值兜底", async () => {
  const m = await dyn("../src/core/labels.js");
  assert.ok(m, "src/core/labels.js 必须存在");
  assert.equal(m.ratingZh("Strong Buy"), "强烈买入");
  assert.equal(m.ratingZh("Buy"), "买入");
  assert.equal(m.ratingZh("Neutral"), "中性");
  assert.equal(m.ratingZh("Sell"), "卖出");
  assert.equal(m.ratingZh("Strong Sell"), "强烈卖出");
  assert.equal(m.ratingZh("STRONG SELL"), "强烈卖出");
  assert.equal(m.ratingZh("样本不足"), "样本不足");
  assert.equal(m.ratingZh(""), "未评级");
  assert.equal(m.ratingZh(null), "未评级");
  assert.equal(m.ratingZh("WeirdLabel"), "WeirdLabel");
});

test("A2 ratingZhEn 中英并列（英文原值保留）", async () => {
  const m = await dyn("../src/core/labels.js");
  assert.ok(m);
  assert.equal(m.ratingZhEn("Strong Sell"), "强烈卖出 Strong Sell");
  assert.equal(m.ratingZhEn("Neutral"), "中性 Neutral");
  assert.equal(m.ratingZhEn(null), "未评级");
});

test("A3 macroZh 覆盖 DXY / TNX / VIX", async () => {
  const m = await dyn("../src/core/labels.js");
  assert.ok(m);
  assert.equal(m.macroZh("DXY"), "美元指数");
  assert.equal(m.macroZh("TNX"), "10Y 美债");
  assert.equal(m.macroZh("VIX"), "恐慌指数");
  assert.equal(m.macroZh("XXX"), "XXX");
});

test("A4 renderRadar 宏观 pills 必须消费中文 label", async () => {
  const src = await read("src/render.js");
  assert.match(src, /macroZh|it\.label/, "pills 必须使用中文标签");
  assert.doesNotMatch(src, /<span class="k">\$\{esc\(it\.key\)\}<\/span>/, "不得只渲染英文 key");
});

test("A5 technical.js 技术评级输出中文（不再拼英文 label）", async () => {
  const src = await read("src/core/technical.js");
  assert.match(src, /ratingZh/, "评级应走中文映射");
  assert.doesNotMatch(src, /\$\{B\.rating\.label\} \$\{ratingScore\}/, "不得直接拼接英文 label");
});

test("A6 M0 徽章与 M1 评级同步中文", async () => {
  const src = await read("src/render.js");
  const hits = (src.match(/ratingZh/g) || []).length;
  assert.ok(hits >= 2, `评级中文映射至少用于 M0 与 M1 两处，实际 ${hits}`);
});

/* ───────────────── B 档位克重 ───────────────── */

test("B1 calcPlan 每档克重 = TOTAL × wPct", () => {
  const p = calcPlan(RAW, GRAMS, PRICE);
  assert.equal(p.levels.length, 6);
  assert.deepEqual(p.levels.map((x) => x.grams), [20, 20, 120, 200, 40, 0]);
});

test("B2 assessGrid 透传档位克重字段", () => {
  const A = { plan: calcPlan(RAW, GRAMS, PRICE) };
  const g = assessGrid({ A, atrUsdOz: 20.76, fx: 7.1, priceUsdOz: 4000, techDir: 0 });
  assert.equal(g.levels.length, 6);
  assert.ok(g.levels.every((lv) => "grams" in lv), "每档必须带 grams");
});

test("B3 renderGrid 档位柱读取克重并标注单位", async () => {
  const src = await read("src/render.js");
  assert.match(src, /lv\.grams|lv\.gram/, "档位必须读取 grams");
  assert.match(src, /克/, "档位必须出现克重单位");
});

test("B4 renderGrid 输出「下一档」克重摘要", async () => {
  const src = await read("src/render.js");
  assert.match(src, /下一档/, "必须输出下一档摘要");
  assert.match(src, /isNext/, "下一档从 isNext 取");
});

/* ───────────────── C 剩余可买 ───────────────── */

test("C1 剩余可买按持仓上限 TOTAL 计算（不再扣未标记流水）", () => {
  const p = calcPlan(RAW, GRAMS, PRICE);
  assert.equal(+p.remainingGrams.toFixed(2), 72.12, "400 − 327.88 应为 72.12 克");
  assert.equal(+p.unmarkedGrams.toFixed(2), 328.88, "未标记克重需暴露供解释");
});

test("C2 持仓超上限 → 剩余 0 且标记 overCap", () => {
  const p = calcPlan(RAW, 450, PRICE);
  assert.equal(p.remainingGrams, 0);
  assert.equal(p.overCap, true);
});

test("C3 risk 额度文案改为持仓上限口径，且不再误报不足", () => {
  const A = { position: { grams: GRAMS, avgCost: 972 }, plan: calcPlan(RAW, GRAMS, PRICE) };
  const r = assess({ A, priceCnyGram: PRICE, techDir: 0 });
  assert.match(r.depletedText, /持仓上限|剩余可买/);
  assert.doesNotMatch(r.depletedText, /剩余额度仅够 0\.00 档/);
  assert.equal(r.depletedTone, "gray", "剩余 72 克不应告警");
});

test("C4 noCap=true 与 false 都按 TOTAL 计算", () => {
  const p1 = calcPlan({ ...RAW, noCap: true }, GRAMS, PRICE);
  const p2 = calcPlan({ ...RAW, noCap: false }, GRAMS, PRICE);
  assert.equal(+p1.remainingGrams.toFixed(2), 72.12);
  assert.equal(+p2.remainingGrams.toFixed(2), 72.12);
});

/* ───────────────── D 数据新鲜度 ───────────────── */

test("D1 配置分离账户快照容忍阈值（>=180 分钟）", async () => {
  const { CONFIG } = await import("../src/config.js");
  assert.ok(CONFIG.accountStaleMinutes >= 180, "账户快照阈值应 >= 3 小时");
  assert.equal(CONFIG.staleMinutes, 15, "外部行情阈值保持 15 分钟");
});

test("D2 app.js 账户陈旧判定使用 accountStaleMinutes", async () => {
  const src = await read("src/app.js");
  assert.match(src, /accountStaleMinutes/);
  assert.doesNotMatch(src, /isStale\(syncAt, now, cfg\.staleMinutes \* 60 \* 1000\)/, "不得再用 15 分钟判账户快照");
});

test("D3 3 小时前不判陈旧、7 小时前判陈旧", async () => {
  const { isStale } = await import("../src/core/sanitize.js");
  const { CONFIG } = await import("../src/config.js");
  const now = Date.now();
  const win = (CONFIG.accountStaleMinutes || 360) * 60 * 1000;
  assert.equal(isStale(now - 3 * 3600 * 1000, now, win), false);
  assert.equal(isStale(now - 7 * 3600 * 1000, now, win), true);
});

test("D4 页脚按小时分级，删除误导性的 15 分钟提示", async () => {
  const src = await read("src/render.js");
  assert.match(src, /小时前/, "超过 60 分钟须显示小时");
  assert.doesNotMatch(src, /账户同步超 15 分钟/, "删除误导性提示");
});

test("D5 同步工作流不再依赖 schedule 扛主链路（v2.5.0 起改自调度）", async () => {
  const yml = await read(".github/workflows/sync-data.yml");
  assert.match(yml, /workflow_dispatch/, "需支持手动/自调度触发");
  assert.match(yml, /gh workflow run sync-data\.yml/, "v2.5.0：轮末自调度，代替不可靠的 schedule");
  assert.doesNotMatch(yml, /\*\/5 \* \* \* \*/, "v2.5.0：*/5 已被证明无法命中，改为 30 分钟兜底");
});

/* ───────────────── E 版本号 ───────────────── */

test("E1 src/version.js 与 package.json 版本一致", async () => {
  const pkg = await readJSON("package.json");
  const m = await dyn("../src/version.js");
  assert.ok(m, "src/version.js 必须存在");
  assert.equal(m.VERSION, pkg.version);
});

test("E2 release.mjs 自动写 src/version.js", async () => {
  const src = await read("scripts/release.mjs");
  assert.match(src, /src\/version\.js/);
  assert.match(src, /VERSION/);
});

test("E3 index.html 顶部有版本号挂载点", async () => {
  const src = await read("index.html");
  assert.match(src, /id="app-ver"/, "顶栏必须有 #app-ver");
  assert.match(src, /\.brand[^{]*\.ver|\.ver\b/, "版本号需要样式");
});

test("E4 main.js 注入 VERSION 到 #app-ver", async () => {
  const src = await read("src/main.js");
  assert.match(src, /import \{ VERSION \} from "\.\/version\.js"/);
  assert.match(src, /app-ver/);
});

/* ───────────────── F 回归守卫 ───────────────── */

test("F1 运行时零双印证残留", async () => {
  const files = ["src/app.js", "src/render.js", "src/main.js", "src/core/grid.js", "src/core/discipline.js", "src/core/risk.js", "index.html"];
  const BANNED = /共振|背离|印证作废|多源|内部结构|内部日线|盘中强反抽/;
  for (const f of files) assert.doesNotMatch(await read(f), BANNED, `${f} 不得出现双印证字样`);
});

test("F2 判断类评级仍禁用红绿（v2.3.1 不回归）", async () => {
  const css = await read("index.html");
  assert.match(css, /\.sig\.buy\{color:#FFC862/, "偏多仍为琥珀");
  assert.match(css, /\.sig\.sell\{color:#B9BEFF/, "偏空仍为靛蓝");
  const r = await read("src/render.js");
  assert.doesNotMatch(r, /rateCls\s*=\s*[^;]*"(red|green)"/, "评级不得用红绿类");
});

test("F3 七模块结构不变", async () => {
  const html = await read("index.html");
  for (let i = 0; i <= 6; i++) assert.match(html, new RegExp(`id="m${i}"`), `缺 m${i}`);
});

test("F4 v240 用例数 >= 20（防删测）", async () => {
  const src = await read("tests/v240.test.mjs");
  const n = (src.match(/^test\(/gm) || []).length;
  assert.ok(n >= 20, `v240 用例 ${n} 条，应 >= 20`);
});

/* ───────────────── G 网格效率 ───────────────── */

test("G1 网格卡展示 ATR/档距效率比", async () => {
  const src = await read("src/render.js");
  assert.match(src, /ratioPct|ATR\s*\/\s*档距|ATR\/档距/, "需展示 ATR 与档距的比率");
});
