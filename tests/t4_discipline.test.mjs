import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, uninstallFetch, jsonResponse, memStorage, fixtureA, mkBars, ramp, DAY } from "./helpers/mock.mjs";
import { loadAll } from "../src/app.js";
import { sectionsHTML } from "../src/render.js";

const FX = () => jsonResponse({ result: "success", rates: { CNY: 7.1 } });
const NOW = 1794223899292;

test("T4 逆势加仓扣分：单边下跌 + 今日 BUY → 红色纪律扣分", async () => {
  const todayBuy = {
    id: "bT", name: "浙商", gram: 20, priceCny: 940.2,
    time: new Date(NOW - 3600 * 1000).toISOString(), note: "", acct: "a1",
  };
  const A = fixtureA({
    feed: [{ t: NOW, type: "dir", text: "方向由 震荡 转为 单边下跌", detail: "周线 下行 · 日线 单边下跌 · 4小时 下行 · 1小时 下行 · 置信 71" }],
    buys: [...fixtureA().buys, todayBuy],
  });
  installFetch([
    ["binance", () => jsonResponse(mkBars(ramp(4300, 3950, 23)))],
    ["er-api", FX],
    ["live.json", () => jsonResponse(A)],
  ]);
  const state = await loadAll({ storage: memStorage(), now: NOW });
  uninstallFetch();

  assert.equal(state.discipline.state, "violation");
  assert.match(state.discipline.text, /纪律扣分/);
  assert.equal(state.discipline.tone, "red");
  const html = sectionsHTML(state);
  assert.match(html.discipline, /纪律扣分/);
  assert.match(html.discipline, /tone--red/);
});

test("T4b 纪律良好：下跌但今日无 BUY", async () => {
  installFetch([
    ["binance", () => jsonResponse(mkBars(ramp(4300, 3950, 23)))],
    ["er-api", FX],
    ["live.json", () => jsonResponse(fixtureA())],
  ]);
  const state = await loadAll({ storage: memStorage(), now: NOW });
  uninstallFetch();
  assert.equal(state.discipline.state, "clean");
  assert.match(state.discipline.text, /纪律良好/);
  assert.match(sectionsHTML(state).discipline, /tone--green/);
});
