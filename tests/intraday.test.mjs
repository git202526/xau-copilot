/**
 * v2.2.0 · 时间维度对齐引擎（规范 §3 / 强制 T1）
 *
 * 核心命题：内部趋势基于「昨日日线收盘」，外部 API 默认返回「盘中实时价」。
 * 二者时间维度不同，必须分开判定，否则会出现「内部看空 / 外部看多」的假背离。
 *
 *   B1 外部日线评级 → decide 的 bRating
 *   B2 外部盘中异动 → decide 新增的 intradayPct（现价相对昨收涨跌%）
 *
 * 决策：
 *   强共振   内部日线 == 外部日线     → 顺势
 *   真背离   内部日线 != 外部日线     → 黄字警报，暂停交易
 *   盘中反抽 日线共振 + 盘中反向急拉 → 黄字「盘中强反抽」，不触发绝对警报
 *
 * 本文件为纯函数测试（不碰 DOM），任何环境可跑。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { decide } from "../src/core/confidence.js";

/* ── T13（规范 T1）盘中反抽：内部日线空 + 外部日线空 + 盘中大涨 ── */
test("T13 盘中强反抽：日线共振做空但盘中急拉 → 反抽预警，绝不判真背离", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: -1, intradayPct: 2.5 });
  assert.equal(d.scenario, "intraday_rebound");
  assert.notEqual(d.scenario, "divergence", "盘中反抽绝不能被误判成真背离");
  assert.match(d.headline, /盘中强反抽/);
  assert.match(d.text, /盘中强反抽/);
  assert.doesNotMatch(d.text, /真背离|背离/, "反抽文案不得出现『背离』字样，避免与真背离混淆");
  assert.equal(d.tone, "amber", "反抽是黄字警示，不是红色绝对警报");
  assert.equal(d.intraday && d.intraday.surge, 1, "应记录盘中异动方向为 +1（涨）");
});

/* ── T14 真背离优先：日线本身冲突时，盘中大涨不能把它洗成反抽 ── */
test("T14 真背离：内部日线空 + 外部日线多 + 盘中大涨 → 仍是真背离", () => {
  const d = decide({ aSign: -1, bRating: 80, cDir: 0, intradayPct: 2.5 });
  assert.equal(d.scenario, "divergence");
  assert.match(d.headline, /背离/);
});

/* ── T15 异常边界：盘中数据缺失（API 超时 / null）→ 不崩，按日线共振处理 ── */
test("T15 异常边界 intradayPct=null → 不触发反抽，回退日线共振", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: -1, intradayPct: null });
  assert.equal(d.scenario, "resonance_short");
  assert.equal(d.intraday, null);
});

/* ── T16 向后兼容：不传盘中维度时，行为与 v2.1.0 完全一致 ── */
test("T16 向后兼容：未传 intradayPct → 保持旧版共振结论", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: -1 });
  assert.equal(d.scenario, "resonance_short");
  assert.equal(d.headline, "强共振做空");
});

/* ── T17 异常边界：盘中异动落在死区内 → 不算强反抽 ── */
test("T17 异常边界 盘中 +0.3%（小于阈值）→ 不触发反抽", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: 0, intradayPct: 0.3 });
  assert.equal(d.scenario, "resonance_short");
});

/* ── T18 优先级：僵尸数据最高，即使盘中大涨也不得输出反抽结论 ── */
test("T18 异常边界 stale=true + 盘中大涨 → 仍判僵尸·印证作废", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: 0, intradayPct: 2.5, stale: true });
  assert.equal(d.scenario, "degraded");
  assert.equal(d.intraday, null, "降级时不应附带盘中结论");
});

/* ── T19 异常边界：盘中同向（顺势下跌）不是反抽 ── */
test("T19 异常边界 共振做空 + 盘中顺势大跌 -2.5% → 不误报反抽", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: 0, intradayPct: -2.5 });
  assert.equal(d.scenario, "resonance_short");
});

/* ── T20 异常边界：外部校验失败时不得输出反抽 ── */
test("T20 异常边界 bMissing=true + 盘中大涨 → 外部校验失败降级", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: 0, intradayPct: 2.5, bMissing: true });
  assert.equal(d.scenario, "degraded");
});

/* ── T21 对称场景：共振做多 + 盘中急跌 → 回踩预警，话术不得用『追空』 ── */
test("T21 共振做多 + 盘中急跌 → 盘中回踩预警，文案不得出现『追空』", () => {
  const d = decide({ aSign: 1, bRating: 80, cDir: 0, intradayPct: -2.5 });
  assert.equal(d.scenario, "intraday_rebound");
  assert.match(d.text, /盘中/);
  assert.doesNotMatch(d.text, /追空/, "做多方向的反抽不应误用做空话术");
});

/* ── T22 渲染层守卫：M2 必须有盘中反抽的黄色标记分支 ── */
test("T22 render.js 的 M2 含 intraday_rebound 黄色警示渲染分支", async () => {
  const s = await readFile("src/render.js", "utf8");
  assert.match(s, /intraday_rebound/, "M2 未处理盘中反抽场景");
  assert.match(s, /盘中强反抽/, "M2 缺少反抽文案/图标");
});

/* ── T23 装配层守卫：app.js 必须把外部盘中涨跌 B.dayPct 喂给 decide ── */
test("T23 app.js 将 B.dayPct 作为盘中维度传入 decide", async () => {
  const s = await readFile("src/app.js", "utf8");
  assert.match(s, /intradayPct/, "装配层未把盘中异动维度喂给决策引擎");
});
