/**
 * Source A：老应用 XAU Desk 的云端 data.json → 归一化契约
 *
 * 真实结构是扁平字段（已验证）：
 *   buys[] / sells[] 逐笔流水、accounts[] 仅元信息、feed[] 承载趋势与置信、
 *   TOTAL 目标克重、H_BASE 建仓高点、startDrop/endDrop 区间、wPct 档位权重。
 *
 * 关键口径（对齐老应用 holdStats，不可改动）：
 *   均价 = Σ(buy.gram × buy.priceCny) ÷ Σbuy.gram     ← 不扣减卖出
 *   克重 = Σbuy.gram − Σsells.gram
 *   成本 = 均价 × 克重
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const TREND_UP = /涨|上行|多头|走强|突破|上升/;
export const TREND_DOWN = /跌|下行|空头|走弱|下跌|下降/;

/** 趋势词 → 符号 */
export function signOf(text) {
  const s = String(text || "");
  if (!s) return 0;
  if (TREND_DOWN.test(s)) return -1;
  if (TREND_UP.test(s)) return 1;
  return 0;
}

/** 解析 feed 里 type='dir' 的最新一条，取出多周期趋势与置信度 */
export function parseStructure(feed) {
  const dirs = (Array.isArray(feed) ? feed : [])
    .filter((x) => x && x.type === "dir")
    .sort((a, b) => num(b.t) - num(a.t));
  const last = dirs[0];
  if (!last) {
    return { text: null, sign: 0, confidence: null, tf: {}, raw: null, at: null };
  }
  const tf = {};
  let confidence = null;
  for (const seg of String(last.detail || "").split("·")) {
    const s = seg.trim();
    const m = s.match(/^(周线|日线|4小时|1小时)\s*(.+)$/);
    if (m) tf[m[1]] = m[2].trim();
    const c = s.match(/置信\s*(\d+)/);
    if (c) confidence = Number(c[1]);
  }
  const day = tf["日线"] || null;
  return { text: day, sign: signOf(day), confidence, tf, raw: last.text || null, at: num(last.t) || null };
}

/** 按账户聚合持仓：accounts 里只有 id/name/color，克重与均价必须从流水重算 */
export function calcAccounts(accounts, buys, sells) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (!list.length) return [];
  return list.map((a) => {
    let bg = 0, bAmt = 0, sg = 0;
    for (const b of buys) {
      if (String(b.acct || "") !== String(a.id)) continue;
      const g = num(b.gram), p = num(b.priceCny);
      bg += g; bAmt += g * p;
    }
    for (const s of sells) {
      if (String(s.acct || "") !== String(a.id)) continue;
      sg += num(s.gram);
    }
    return {
      id: a.id,
      name: a.name || a.id,
      color: a.color || "#7c8595",
      note: a.note || "",
      buyGram: bg,
      sold: sg,
      grams: Math.max(0, bg - sg),
      avgCost: bg > 0 ? bAmt / bg : null,
    };
  });
}

/** 今日操作：按本地日界过滤 buys/sells */
export function calcTodayActions(buys, sells, now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  const out = [];
  for (const b of buys) {
    const t = Date.parse(b.time);
    if (!Number.isFinite(t) || t < start || t > now + 6 * 3600 * 1000) continue;
    out.push({ type: "BUY", name: b.name || "", acct: b.acct || null, priceCny: num(b.priceCny), gram: num(b.gram), time: t });
  }
  for (const s of sells) {
    const t = Date.parse(s.time);
    if (!Number.isFinite(t) || t < start || t > now + 6 * 3600 * 1000) continue;
    out.push({ type: "SELL", name: s.name || "", acct: s.acct || null, priceCny: num(s.priceCny), gram: num(s.gram), time: t });
  }
  return out.sort((a, b) => b.time - a.time);
}

/**
 * 网格计划派生（移植老应用 gearBase / planBudget）
 *   档距 = H × (endDrop − startDrop)/100 ÷ (n − 1)
 *   预算 = noCap ? TOTAL : TOTAL − 未标记档位的持仓
 *   剩余可买 = 预算 − 已持克重
 *   预算额度折算(万) = 剩余可买 × 现价 ÷ 10000（派生估算，非账户余额）
 *   下一档克重 = TOTAL × wPct[next]
 * 注：老应用 Source A 无资金/余额字段，TOTAL 为预算总克重，以上均为计划参数派生量。
 */
export function calcPlan(raw, grams, priceCnyGram) {
  const n = num(raw.gearCount) || 9;
  const H = num(raw.H_BASE);
  const startDrop = num(raw.startDrop);
  const endDrop = num(raw.endDrop);
  const TOTAL = num(raw.TOTAL) || 0;
  const wPct = Array.isArray(raw.wPct) ? raw.wPct.map(num) : [];
  const price = num(priceCnyGram);

  const baseSpacing =
    H > 0 && endDrop > startDrop && n > 1 ? (H * ((endDrop - startDrop) / 100)) / (n - 1) : null;

  let budget = TOTAL;
  if (!raw.noCap) {
    const unmarked = (Array.isArray(raw.buys) ? raw.buys : []).reduce(
      (s, b) => (b.gear === null || b.gear === undefined || b.gear === "" ? s + num(b.gram) : s),
      0
    );
    if (unmarked > 0.01) budget = Math.max(0, TOTAL - unmarked);
  }

  const remainingGrams = grams != null && TOTAL > 0 ? Math.max(0, budget - grams) : null;
  const remainingFunds =
    remainingGrams != null && price > 0 ? (remainingGrams * price) / 10000 : null;

  // 已买满的档位序号：按持仓占目标克重比例推定
  const filled = TOTAL > 0 && grams != null ? Math.min(n, Math.floor((grams / TOTAL) * n)) : 0;
  const nextIdx = Math.min(n - 1, filled);
  const nextBuyGrams = wPct.length === n && TOTAL > 0 ? (TOTAL * wPct[nextIdx]) / 100 : null;
  const nextBuyAmount = nextBuyGrams != null && price > 0 ? (nextBuyGrams * price) / 10000 : null;
  const ratio = remainingFunds != null && nextBuyAmount > 0 ? remainingFunds / nextBuyAmount : null;

  // 档位价格表（美元/盎司）：第 i 档 = H × (1 − (startDrop + i×step)/100)
  const stepPct = n > 1 ? (endDrop - startDrop) / (n - 1) : 0;
  const levels = [];
  for (let i = 0; i < n; i++) {
    const dropPct = startDrop + i * stepPct;
    levels.push({
      i: i + 1,
      dropPct: +dropPct.toFixed(2),
      priceUsd: H > 0 ? +(H * (1 - dropPct / 100)).toFixed(1) : null,
      weightPct: wPct[i] ?? null,
      grams: wPct.length === n && TOTAL > 0 ? (TOTAL * wPct[i]) / 100 : null,
      filled: i < filled,
      isNext: i === nextIdx && filled < n,
    });
  }

  return {
    gearCount: n,
    highBase: H || null,
    startDrop: startDrop || null,
    endDrop: endDrop || null,
    baseSpacing: baseSpacing != null ? +baseSpacing.toFixed(1) : null,
    budget: TOTAL || null,
    remainingGrams,
    remainingFunds,
    nextIdx: nextIdx + 1,
    nextBuyGrams,
    nextBuyAmount,
    ratio,
    levels,
    ok: baseSpacing != null && remainingFunds != null,
  };
}

/** 主入口：raw data.json → A 契约 */
export function normalizeA(raw, ctx = {}) {
  const now = Number(ctx.now) || Date.now();
  const price = num(ctx.priceCnyGram);

  if (!raw || typeof raw !== "object") {
    return degraded("源数据不可读");
  }

  const buys = Array.isArray(raw.buys) ? raw.buys : [];
  const sells = Array.isArray(raw.sells) ? raw.sells : [];

  let bought = 0, buyAmt = 0, sold = 0, soldAmt = 0;
  for (const b of buys) {
    const g = num(b.gram), p = num(b.priceCny);
    bought += g; buyAmt += g * p;
  }
  for (const s of sells) {
    const g = num(s.gram), p = num(s.priceCny);
    sold += g; soldAmt += g * p;
  }

  let grams = null;
  let avgCost = null;
  let basis = "none";
  if (buys.length > 0 && bought > 0) {
    avgCost = buyAmt / bought;          // ← 老应用口径：不扣减卖出
    grams = Math.max(0, bought - sold);
    basis = "ledger";
  } else if (num(raw.GRAMS) > 0 && num(raw.COST) > 0) {
    grams = num(raw.GRAMS);
    avgCost = num(raw.COST);
    basis = "summary";                  // 兼容旧汇总（仅有 GRAMS/COST、无逐笔）
  }

  const totalCost = grams != null && avgCost != null ? grams * avgCost : null;
  const accounts = calcAccounts(raw.accounts, buys, sells);
  const trend = parseStructure(raw.feed);
  const plan = calcPlan(raw, grams, price);
  const todayActions = calcTodayActions(buys, sells, now);

  const alerts = (Array.isArray(raw.alerts) ? raw.alerts : [])
    .filter((a) => a && a.on !== false)
    .map((a) => ({
      id: a.id, name: a.name || "预警", price: num(a.price),
      dir: a.dir || "both", fired: num(a.firedAt) > 0,
    }));

  return {
    ok: true,
    basis,
    updatedAt: num(raw.updatedAt) || null,
    position: {
      grams,
      avgCost,
      totalCost,
      bought,
      sold,
      soldAmount: soldAmt,
    },
    accounts,
    trend,
    plan,
    todayActions,
    alerts,
    marketValue: grams != null && price > 0 ? grams * price : null,
    pnl: grams != null && avgCost != null && price > 0 ? (price - avgCost) * grams : null,
    err: null,
  };
}

export function degraded(err) {
  return {
    ok: false,
    basis: "none",
    updatedAt: null,
    position: { grams: null, avgCost: null, totalCost: null, bought: 0, sold: 0, soldAmount: 0 },
    accounts: [],
    trend: { text: null, sign: 0, confidence: null, tf: {}, raw: null, at: null },
    plan: { ok: false, baseSpacing: null, remainingFunds: null, nextBuyAmount: null, ratio: null, levels: [] },
    todayActions: [],
    alerts: [],
    marketValue: null,
    pnl: null,
    err: String(err || "未知错误"),
  };
}
