import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, uninstallFetch, jsonResponse, memStorage, fixtureA } from "./helpers/mock.mjs";
import { loadAll } from "../src/app.js";
import { sectionsHTML } from "../src/render.js";

const NOW = 1794223899292;
const FX = () => jsonResponse({ result: "success", rates: { CNY: 7.1 } });

function xauDoc(closes) {
  // 用 YYYY-MM-DD 造 25 根已收盘日线（最后一根是「昨天」，确保不被当作未收盘剔除）
  const base = Date.parse("2026-11-09T00:00:00Z");
  const bars = closes.map((c, i) => {
    const d = new Date(base - (closes.length - i) * 86400000).toISOString().slice(0, 10);
    return { d, o: c, h: c * 1.004, l: c * 0.996, c };
  });
  return { symbol: "XAUUSD", provider: "sina:XAU", bars, spot: closes[closes.length - 1], spotSource: "gold-api", asOf: "2026-11-09T12:00:00Z" };
}

test("T6 XAUUSD 主通道：MA20 用新浪伦敦金日线，现价用 gold-api，标签不冒充", async () => {
  const closes = Array.from({ length: 25 }, (_, i) => 3900 + i * 10); // 3900→4140
  installFetch([
    ["xauusd.json", () => jsonResponse(xauDoc(closes))],
    ["gold-api", () => jsonResponse({ name: "Gold", symbol: "XAU", price: 4155.5 })],
    ["er-api", FX],
    ["live.json", () => jsonResponse(fixtureA())],
  ]);
  const state = await loadAll({ storage: memStorage(), now: NOW });
  uninstallFetch();

  assert.equal(state.B.ok, true);
  assert.equal(state.B.source, "xau");
  assert.equal(state.B.instrument, "XAUUSD");
  assert.equal(state.B.spotSource, "gold-api");
  assert.equal(state.B.priceUsdOz, 4155.5, "现价应取 gold-api 实时价");
  // 已收盘 25 根，最后一根是 11-08；MA20 = 最近 20 根收盘均值
  const expectMa = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  assert.ok(Math.abs(state.B.ma20UsdOz - expectMa) < 0.51, `MA20 应≈${expectMa}，实际 ${state.B.ma20UsdOz}`);
  assert.equal(state.B.trend, 1);
  assert.match(state.B.sourceLabel, /XAUUSD/);
});

test("T6b XAUUSD 快照缺 bar：自动退到 PAXG 且标签写「代理」", async () => {
  installFetch([
    ["xauusd.json", () => jsonResponse({ symbol: "XAUUSD", bars: [] })],
    ["binance", () => jsonResponse(Array.from({ length: 26 }, (_, i) => {
      const ot = NOW - (30 - i) * 86400000;
      return [ot, "1", "1", "1", String(4000 + i * 5), "1", ot + 80000000, "0"];
    }))],
    ["gold-api", () => { throw new Error("down"); }],
    ["er-api", FX],
    ["live.json", () => jsonResponse(fixtureA())],
  ]);
  const state = await loadAll({ storage: memStorage(), now: NOW });
  uninstallFetch();
  assert.equal(state.B.source, "binance");
  assert.match(state.B.sourceLabel, /代理/);
  assert.ok(sectionsHTML(state).decision.includes("PAXG"));
});
