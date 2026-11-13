/**
 * 终极重构 · 红灯用例 T1–T8
 * 只依赖 src/core/* 纯函数，不碰 DOM，保证在任何环境可跑。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeA } from "../src/core/normalize.js";
import { isStale, isDomesticSession, premiumState } from "../src/core/sanitize.js";
import { judgeMacro } from "../src/core/macro.js";
import { decide } from "../src/core/confidence.js";
import { assess } from "../src/core/risk.js";
import { rebalance } from "../src/core/rebalance.js";

const MIN = 60 * 1000;
const NOW = Date.parse("2026-11-09T21:00:00+08:00");

/* 真实结构的精简样本（字段名与线上 data.json 一致） */
function rawSample(over = {}) {
  return {
    TOTAL: 330,
    H_BASE: 4696,
    GRAMS: 0,
    COST: 0,
    gearCount: 9,
    startDrop: 15,
    endDrop: 34.3,
    wPct: [4, 6, 10, 14, 17, 18, 15, 10, 6],
    noCap: true,
    keepGram: 0,
    lastDir: "dn",
    updatedAt: NOW - 2 * MIN,
    accounts: [
      { id: "a0", name: "建行", color: "#D4A24C" },
      { id: "a1", name: "民生", color: "#5B8FF9" },
    ],
    buys: [
      { id: "b1", name: "建行", gram: 172.42, priceCny: 988.2091, time: "2026-11-03T07:01:00.000Z", gear: null, acct: "a0" },
      { id: "b2", name: "民生", gram: 84.8, priceCny: 949.73, time: "2026-11-04T02:00:00.000Z", gear: null, acct: "a1" },
      { id: "b3", name: "建行", gram: 71.6648, priceCny: 968.0, time: "2026-11-05T02:00:00.000Z", gear: null, acct: "a0" },
    ],
    sells: [
      { id: "s1", name: "卖出", gram: 1, priceCny: 878.87, time: "2026-11-09T08:57:00.000Z", acct: "a1" },
    ],
    feed: [
      { t: NOW - 40 * MIN, type: "dir", text: "方向由 震荡 转为 下行",
        detail: "周线 下行 · 日线 下行 · 4小时 上行 · 1小时 下行 · 置信 61" },
    ],
    alerts: [{ id: "al1", name: "成本位置", price: 4500, dir: "both", on: true, firedAt: NOW - 60 * MIN }],
    ...over,
  };
}

/* ── T1 老应用 JSON 解析异常：持仓缺失不得崩溃 ── */
test("T1 持仓数据缺失 → 不崩溃，盈亏标记为数据缺失而非 0", () => {
  const a = normalizeA(rawSample({ buys: undefined, sells: undefined, GRAMS: 0, COST: 0 }), { priceCnyGram: 880 });
  assert.equal(a.ok, true, "缺 buys/sells 时仍需 ok=true，页面要能渲染");
  assert.equal(a.position.grams, null, "无逐笔也无汇总时克重必须是 null，不能当 0 处理");
  assert.equal(a.position.avgCost, null);
  const r = assess({ A: a, priceCnyGram: 880, macro: { dir: 0, mode: "normal" }, divergence: false });
  assert.equal(r.pnl, null);
  assert.match(r.pnlText, /数据缺失/);
});

/* ── T2 僵尸数据 ── */
test("T2 外部数据延迟 30 分钟 → 判定为僵尸数据并废弃", () => {
  assert.equal(isStale(NOW - 30 * MIN, NOW), true);
  assert.equal(isStale(NOW - 5 * MIN, NOW), false);
  const r = assess({
    A: normalizeA(rawSample(), { priceCnyGram: 880 }),
    priceCnyGram: 880,
    macro: { dir: 0, mode: "normal" },
    stale: true,
  });
  assert.equal(r.trusted, false);
  assert.match(r.notice, /僵尸数据/);
});

/* ── T3 休市逻辑 ── */
test("T3 国内凌晨 3:00 休市 → 溢价率冻结", () => {
  const t3 = new Date("2026-11-10T03:00:00+08:00");
  assert.equal(isDomesticSession(t3), false);
  const p = premiumState(t3);
  assert.equal(p.frozen, true);
  assert.match(p.reason, /国内休市/);
  const open = new Date("2026-11-10T14:00:00+08:00");
  assert.equal(isDomesticSession(open), true);
  assert.equal(premiumState(open).frozen, false);
});

/* ── T4 真实浮亏必须被解析并渲染 ── */
test("T4 真实浮亏 -30000 → 原样透出，不回退成 0", () => {
  const a = normalizeA(rawSample(), { priceCnyGram: 880 });
  const r = assess({ A: a, priceCnyGram: 880, macro: { dir: 0, mode: "normal" } });
  assert.equal(typeof r.pnl, "number");
  const fake = assess({ A: a, priceCnyGram: 880, macro: { dir: 0, mode: "normal" }, pnlOverride: -30000 });
  assert.equal(fake.pnl, -30000);
  assert.match(fake.pnlText, /-30,000/);
  assert.equal(fake.pnlTone, "green", "浮亏属跌，按红涨绿跌应为绿（v2.3.1 口径改写）");
});

/* ── T5（v2.3.0 改写）FOMO 锁 ──
 * 需求变更：应用不再做内部/外部双印证，FOMO 触发源由「背离」改为
 * 「外部技术面偏空 techDir<0」。账户事实断言（趋势解析、今日 BUY 识别）
 * 与历史引擎 decide() 测点均保留，仅把 assess 的入参改为 techDir。 */
test("T5 外部技术面偏空 + 今日有 BUY → 逆势买入触发 FOMO 锁", () => {
  const a = normalizeA(
    rawSample({ buys: [...rawSample().buys, { id: "b9", gram: 5, priceCny: 882, time: "2026-11-09T06:00:00.000Z", gear: null, acct: "a0" }] }),
    { priceCnyGram: 880, now: NOW }
  );
  assert.equal(a.trend.sign, -1, "「日线 下行」应解析为 -1（账户事实解析仍保留）");
  assert.equal(a.todayActions.filter((x) => x.type === "BUY").length, 1, "今日 BUY 必须被识别");

  const d = decide({ aSign: -1, bRating: 80, cDir: 0, vixSpike: false });
  assert.equal(d.scenario, "divergence", "历史引擎夹具保留，仍可独立验证");
  assert.equal(d.conf, "low");
  assert.equal(d.tone, "amber");

  const r = assess({ A: a, priceCnyGram: 880, macro: { dir: 0, mode: "normal" }, techDir: -1 });
  assert.equal(r.fomoLock, true);
  assert.match(r.fomoText, /逆势|接飞刀/);
  assert.equal(r.fomoCountdown, 10);
});

/* ── T6 预算额度不足（v2.3.1 需求变更：老应用无资金字段，改预算口径 + 中性告警色）── */
test("T6 剩余可买 < 1.5 倍下一档 → 琥珀额度不足告警", () => {
  const a = normalizeA(rawSample(), { priceCnyGram: 880 });
  assert.ok(a.plan.ratio < 1.5, `实测比值 ${a.plan.ratio} 应小于 1.5`);
  const r = assess({ A: a, priceCnyGram: 880, macro: { dir: 0, mode: "normal" } });
  assert.equal(r.depleted, true);
  assert.match(r.depletedText, /额度不足|剩余可买/, "v2.4.0 文案改为剩余可买口径");
  assert.equal(r.depletedTone, "amber");
});

/* ── T7 宏观极值：VIX 单日暴涨 >20% 强制避险 ── */
test("T7 VIX 单日 +69.7% → 强制避险模式", () => {
  const m = judgeMacro({ dxy: 102.2, dxyPrev: 102.5, tnx: 4.84, tnxPrev: 4.90, vix: 28.18, vixPrev: 16.61 });
  assert.equal(m.mode, "risk_off");
  assert.match(m.riskOffText, /避险/);
  const calm = judgeMacro({ dxy: 102.2, dxyPrev: 102.5, tnx: 4.84, tnxPrev: 4.90, vix: 17.2, vixPrev: 17.4 });
  assert.equal(calm.mode, "normal");
  assert.equal(calm.dir, 1, "DXY 跌 + 10Y 跌 = 强支撑（+1）");
});

/* ── T8 守卫：全库不得残留 PAXG ── */
test("T8 全项目不得出现 PAXG 字样", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const hits = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "docs"].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!/\.(js|mjs|html|json|md|yml)$/.test(e.name)) continue;
      if (e.name === "terminal.test.mjs") continue;
      const txt = await readFile(p, "utf8");
      if (/paxg/i.test(txt)) hits.push(p);
    }
  }
  await walk(".");
  assert.deepEqual(hits, [], `以下文件仍含 PAXG：${hits.join(", ")}`);
});

/* ── T9 僵尸数据：必须废弃本次印证，不允许照常给方向结论 ── */
test("T9 外部数据僵尸（>15min）→ 废弃印证，置信度降级", () => {
  const d = decide({ aSign: -1, bRating: 20, cDir: -1, stale: true });
  assert.equal(d.scenario, "degraded", "僵尸数据不得产出共振/背离结论");
  assert.equal(d.conf, "degraded");
  assert.match(d.text, /僵尸数据/);
  const fresh = decide({ aSign: -1, bRating: 20, cDir: -1, stale: false });
  assert.notEqual(fresh.scenario, "degraded", "新鲜数据不应被误判为降级");
});

/* ── T10 单一数据源：再平衡文案里的「整体均价」必须与账户体检卡同源 ── */
test("T10 再平衡整体均价取 A.position.avgCost，不得二次加权造出第二个数字", () => {
  const A = {
    position: { avgCost: 972.01, grams: 327.8848 },
    accounts: [
      { name: "建行", grams: 172.42, avgCost: 988.21, color: "#f0b429" },
      { name: "浙商", grams: 70.63, avgCost: 959.41, color: "#e05d52" },
      { name: "民生", grams: 84.84, avgCost: 949.73, color: "#5b8def" },
    ],
  };
  const r = rebalance({ A, spreadPct: 3 });
  assert.equal(r.significant, true);
  assert.match(r.text, /972\.01/, `文案未引用主均价：${r.text}`);
  assert.doesNotMatch(r.text, /972\.05/, "不得出现账户四舍五入重算出的第二个均价");
  assert.equal(r.weightedAvg, 972.01);
});

/* ── T11 内存泄漏守卫：页面卸载时必须清理所有定时器 ── */
test("T11 pagehide 清理 ui.timer 与 ui.countdown", async () => {
  const { readFile } = await import("node:fs/promises");
  const s = await readFile("src/main.js", "utf8");
  assert.match(s, /pagehide|beforeunload/, "缺少卸载钩子");
  const hook = s.slice(s.search(/pagehide|beforeunload/));
  assert.match(hook, /clearInterval\(ui\.timer\)/);
  assert.match(hook, /clearInterval\(ui\.countdown\)/);
});

/* ── T12 新鲜度口径：实时现价成功时，不得因「日线快照写入时间旧」误判僵尸 ── */
test("T12 实时现价新鲜不判僵尸；实时挂掉且旧快照回退才判僵尸", async () => {
  const { loadB } = await import("../src/sourceB.js");
  const { withTTL } = await import("../src/core/sanitize.js");
  const now = Date.parse("2026-11-09T23:00:00+08:00");
  const old = new Date(now - 3 * 3600 * 1000).toISOString();
  const bars = Array.from({ length: 30 }, (_, i) => ({
    d: `2026-10-${String(i + 1).padStart(2, "0")}`, c: 4000 + i, h: 4012 + i, l: 3988 + i,
  }));
  const snap = { bars, spot: 4120, spotAt: old, asOf: old };
  const rating = { ok: true, score: 30, label: "Sell" };
  const cfg = { xauUrl: "data/xauusd.json", ratingUrl: "data/rating.json", xauSpotUrl: "https://api.gold-api.com/price/XAU", maPeriod: 20 };

  const mk = (spotOk) => (u) => {
    if (u.includes("xauusd.json")) return Promise.resolve({ ok: true, json: async () => snap });
    if (u.includes("rating.json")) return Promise.resolve({ ok: true, json: async () => rating });
    if (u.includes("gold-api")) {
      return spotOk
        ? Promise.resolve({ ok: true, json: async () => ({ price: 4124.4 }) })
        : Promise.reject(new Error("spot down"));
    }
    return Promise.reject(new Error("unexpected " + u));
  };

  withTTL._s?.clear();
  const fresh = await loadB({ fetchImpl: mk(true), now, config: cfg });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.stale, false, "实时现价成功，不应被 3 小时前写入的日线快照拖成僵尸");
  assert.ok(Math.abs(fresh.ts - now) < 60 * 1000, `ts 应取本次实时抓取时间，实际 ${fresh.ts}`);

  withTTL._s?.clear();
  const stale = await loadB({ fetchImpl: mk(false), now, config: cfg });
  assert.equal(stale.stale, true, "实时源挂掉并回退旧快照时，必须判僵尸并废弃印证");
  withTTL._s?.clear();
});
