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

/* ─────────────────────────────────────────────────────────────────
 * v2.3.0 需求变更（用户指令）：「应用不要内外部双印证了，只搜集外部
 * 实时行情指标做出判断，影响到其它卡片同步更新」。
 *
 * 原 T22/T23 守护的是 v2.2.0 的双印证渲染分支（intraday_rebound 黄色
 * 警示 / app.js 把 B.dayPct 喂给 decide），该特性随本次重构整体下线。
 * 两条守卫如实退役并改写为新架构契约，不删除、不放水：
 *   T22' 守护 M2 消费 s.technical 且渲染外部指标网格
 *   T23' 守护 app.js 装配 decideTechnical、且不再调用 decide
 * 引擎 decide() 本身保留为历史纯函数夹具（T13–T21 继续测它），
 * 但运行时链路不再 import，避免「测试在、功能已下线」的假绿。
 * ───────────────────────────────────────────────────────────────── */

/* ── T22'（原 T22 退役改写）渲染层守卫：M2 改为纯外部技术面决策 ── */
test("T22' M2 消费 s.technical 且渲染外部指标网格，不再有双印证分支", async () => {
  const s = await readFile("src/render.js", "utf8");
  const start = s.indexOf("export function renderDecision");
  const end = s.indexOf("export function renderAccount");
  assert.ok(start > 0 && end > start, "未找到 M2 渲染函数边界");
  const seg = s.slice(start, end);
  assert.match(seg, /s\.technical/, "M2 未接入纯外部判断");
  assert.doesNotMatch(seg, /intraday_rebound|盘中强反抽|共振|背离|内部结构/, "M2 仍残留双印证渲染分支");
});

/* ── T23'（原 T23 退役改写）装配层守卫：app.js 改为 decideTechnical ── */
test("T23' app.js 装配 decideTechnical，且不再调用双印证 decide", async () => {
  const s = await readFile("src/app.js", "utf8");
  assert.match(s, /decideTechnical/, "装配层未引入纯外部引擎");
  assert.doesNotMatch(s, /\bdecide\s*\(\s*\{/, "装配层仍在调用 decide({...})");
});
