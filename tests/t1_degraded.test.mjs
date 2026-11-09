import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, uninstallFetch, jsonResponse, memStorage, fixtureA } from "./helpers/mock.mjs";
import { loadAll } from "../src/app.js";
import { sectionsHTML } from "../src/render.js";

test("T1 外部行情全挂：不白屏，决策降级为「外部校验失败，置信度降级」", async () => {
  const calls = installFetch([
    ["binance", () => { throw new Error("ETIMEDOUT binance"); }],
    ["yahoo", () => { throw new Error("ETIMEDOUT yahoo"); }],
    ["live.json", () => jsonResponse(fixtureA())],
  ]);
  const state = await loadAll({ storage: memStorage(), now: 1794223899292 });
  uninstallFetch();

  assert.equal(state.B.ok, false, "B 应标记失败");
  assert.equal(state.decision.confidence, "degraded");
  assert.equal(state.decision.badge, "降级");
  assert.match(state.decision.body, /外部校验失败，置信度降级/);

  const html = sectionsHTML(state);
  assert.match(html.decision, /外部校验失败/);
  assert.match(html.briefing, /降级/);
  // 七张卡仍然全部产出，无白屏
  for (const k of ["briefing", "decision", "tradePlan", "stress", "grid", "rebalance", "discipline"]) {
    assert.ok(html[k] && html[k].length > 20, `${k} 卡片未渲染`);
  }
  assert.ok(calls.length >= 2);
});

test("T1b 老应用数据挂、外部正常：内部降级但不崩", async () => {
  installFetch([
    ["binance", () => jsonResponse([[1, "1", "1", "1", "4000", "1", 2]])],
    ["live.json", () => { throw new Error("404"); }],
  ]);
  const state = await loadAll({ storage: memStorage(), now: 1794223899292 });
  uninstallFetch();
  assert.equal(state.A.ok, false);
  assert.match(state.decision.body, /内部源数据异常|源数据异常/);
  assert.ok(sectionsHTML(state).decision.length > 20);
});
