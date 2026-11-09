import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, uninstallFetch, jsonResponse, memStorage, fixtureA, mkBars, ramp, textResponse } from "./helpers/mock.mjs";
import { loadAll } from "../src/app.js";
import { sendAlert, buildPayload } from "../src/webhook.js";

const FX = () => jsonResponse({ result: "success", rates: { CNY: 7.1 } });
const NOW = 1794223899292;
const HOOK = "https://hooks.example.com/services/T000/B000/XXXX";

async function resonanceState(storage) {
  installFetch([
    ["binance", () => jsonResponse(mkBars(ramp(4300, 3950, 23)))],
    ["er-api", FX],
    ["live.json", () => jsonResponse(fixtureA())],
  ]);
  return loadAll({ storage, now: NOW });
}

test("T5 强共振触发 Webhook：POST 一次，载荷正确，同日去重", async () => {
  const storage = memStorage();
  const state = await resonanceState(storage);
  assert.equal(state.decision.scenario, "resonance_short");

  const calls = installFetch([["hooks.example.com", () => textResponse("ok")]]);
  const r1 = await sendAlert(state, { webhookUrl: HOOK, storage, now: NOW });
  assert.equal(r1.sent, true);

  const posts = calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1, "应只发一次 POST");
  const payload = JSON.parse(posts[0].body);
  assert.equal(payload.event, "RESONANCE_SHORT");
  assert.equal(payload.app, "XAU Copilot");
  assert.ok(payload.price > 0 && payload.ma20 > 0);
  assert.match(payload.trendA, /日线/);
  assert.equal(payload.confidence, "high");
  assert.ok(payload.text.includes("强共振做空"));

  // 同日同事件去重
  const r2 = await sendAlert(state, { webhookUrl: HOOK, storage, now: NOW });
  assert.equal(r2.sent, false);
  assert.equal(r2.reason, "dedup");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  uninstallFetch();
});

test("T5b 非共振不推送；推送失败静默不抛", async () => {
  const storage = memStorage();
  const s1 = await resonanceState(storage);
  const neutral = { ...s1, decision: { ...s1.decision, scenario: "neutral", tone: "gray" } };
  const r0 = await sendAlert(neutral, { webhookUrl: HOOK, storage, now: NOW });
  assert.equal(r0.sent, false);
  assert.equal(r0.reason, "no-trigger");

  const calls = installFetch([["hooks.example.com", () => { throw new Error("ECONNRESET"); }]]);
  const r1 = await sendAlert(s1, { webhookUrl: HOOK, storage, now: NOW + 1000 * 60 * 60 * 24 });
  assert.equal(r1.sent, false);
  assert.equal(r1.reason, "failed"); // 静默失败，不抛出
  assert.ok(calls.length >= 1);
  uninstallFetch();
});

test("T5c 载荷结构固定（防回归）", () => {
  const p = buildPayload(
    { decision: { scenario: "RESONANCE_SHORT", confidence: "high", headline: "h", body: "b", tone: "red" }, B: { priceCnyGram: 900, ma20CnyGram: 910 }, A: { trendText: "日线 下行", position: { gram: 10, avgCost: 950 } } },
    1794223899292,
  );
  assert.deepEqual(Object.keys(p).sort(), ["app", "event", "ma20", "price", "position", "text", "trendA", "ts", "confidence"].sort());
});
