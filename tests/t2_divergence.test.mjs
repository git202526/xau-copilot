import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, uninstallFetch, jsonResponse, memStorage, fixtureA, mkBars, ramp } from "./helpers/mock.mjs";
import { loadAll } from "../src/app.js";
import { sectionsHTML } from "../src/render.js";

const FX = () => jsonResponse({ result: "success", rates: { CNY: 7.1 } });

test("T2 多源背离：A 看空 + B 站上 MA20 → 黄色「多源背离」，徽章「低」", async () => {
  // 收盘价从 3900 抬到 4150，现价必在 MA20 之上
  installFetch([
    ["binance", () => jsonResponse(mkBars(ramp(3900, 4150, 23)))],
    ["er-api", FX],
    ["live.json", () => jsonResponse(fixtureA())],
  ]);
  const state = await loadAll({ storage: memStorage(), now: 1794223899292 });
  uninstallFetch();

  assert.equal(state.A.sign, -1, "A 应为空头");
  assert.equal(state.B.trend, 1, "B 应为多头");
  assert.equal(state.decision.scenario, "divergence_trap_up");
  assert.equal(state.decision.confidence, "low");
  assert.equal(state.decision.badge, "低");
  assert.equal(state.decision.tone, "amber");
  assert.match(state.decision.body, /多源背离/);
  assert.match(state.decision.body, /暂停建仓/);

  const html = sectionsHTML(state);
  assert.match(html.decision, /badge--low/);
  assert.match(html.decision, /多源背离/);
});

test("T3 强共振做空：A 看空 + B 跌破 MA20 → 红色，徽章「高」", async () => {
  installFetch([
    ["binance", () => jsonResponse(mkBars(ramp(4300, 3950, 23)))],
    ["er-api", FX],
    ["live.json", () => jsonResponse(fixtureA())],
  ]);
  const state = await loadAll({ storage: memStorage(), now: 1794223899292 });
  uninstallFetch();

  assert.equal(state.B.trend, -1);
  assert.equal(state.decision.scenario, "resonance_short");
  assert.equal(state.decision.confidence, "high");
  assert.equal(state.decision.badge, "高");
  assert.equal(state.decision.tone, "red");
  assert.match(state.decision.body, /强共振做空/);

  const html = sectionsHTML(state);
  assert.match(html.decision, /badge--high/);
});

test("T3b 强共振做多：双多 → 绿底", async () => {
  installFetch([
    ["binance", () => jsonResponse(mkBars(ramp(3800, 4200, 23)))],
    ["er-api", FX],
    ["live.json", () => jsonResponse(fixtureA({
      feed: [{ t: 1794223899292, type: "dir", text: "方向由 震荡 转为 上行", detail: "周线 上行 · 日线 上行 · 4小时 上行 · 1小时 震荡 · 置信 62" }],
    }))],
  ]);
  const state = await loadAll({ storage: memStorage(), now: 1794223899292 });
  uninstallFetch();
  assert.equal(state.decision.scenario, "resonance_long");
  assert.equal(state.decision.tone, "green");
  assert.match(sectionsHTML(state).decision, /badge--high/);
});
