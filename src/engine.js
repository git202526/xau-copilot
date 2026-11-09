/**
 * engine.js —— 纯计算层（无 DOM、无网络）
 * 输入：归一化后的 A（老应用）、B（外部日线）
 * 输出：各卡片可直接渲染的结论对象
 * 规则：只算不画；渲染层不参与任何判断。
 */
export const TROY = 31.1035;

export const toCnyGram = (usdOz, fx) => (Number(usdOz) * Number(fx)) / TROY;
export const toUsdOz = (cnyGram, fx) => (Number(cnyGram) * TROY) / Number(fx);
export const round = (v, d = 2) => (Number.isFinite(+v) ? +(+v).toFixed(d) : null);
export const wan = (v) => (Number.isFinite(+v) ? +(+v / 10000).toFixed(2) : null);

/** 文本 → 方向符号：+1 多 / -1 空 / 0 震荡 */
export function signOfText(txt) {
  const t = String(txt || "");
  if (!t) return 0;
  if (/涨|上行|多头|突破|做多|上升/.test(t)) return 1;
  if (/跌|下行|空头|走弱|做空|下降/.test(t)) return -1;
  return 0;
}

/** 从老应用 feed 里取最近一条 dir 记录，解析「日线 X」与置信 */
export function parseFeedTrend(feed) {
  const rows = Array.isArray(feed) ? feed.filter((x) => x && x.type === "dir") : [];
  const last = rows.sort((a, b) => (b.t || 0) - (a.t || 0))[0] || null;
  if (!last) return { label: "未知", text: "无方向记录", sign: 0, conf: null, at: null, levels: {} };
  const detail = String(last.detail || "");
  const levels = {};
  detail.split("·").forEach((seg) => {
    const m = seg.trim().match(/^(周线|日线|4小时|1小时)\s+(.+)$/);
    if (m) levels[m[1]] = m[2].trim();
  });
  const dayLabel = levels["日线"] || (String(last.text || "").split("转为").pop() || "").trim() || "未知";
  const confM = detail.match(/置信\s*(\d+)/);
  return {
    label: dayLabel,
    text: `日线 ${dayLabel}`,
    sign: signOfText(dayLabel),
    conf: confM ? Number(confM[1]) : null,
    at: last.t || null,
    levels,
  };
}

/** 归一化 A：把老应用 data.json 变成引擎能吃的稳定结构 */
export function normalizeA(raw, opt = {}) {
  const fx = Number(opt.fx) || 7.1;
  const now = Number(opt.now) || Date.now();
  if (!raw || typeof raw !== "object") {
    return {
      ok: false, err: "老应用数据为空", raw: null, updatedAt: null,
      trend: { label: "未知", text: "无方向记录", sign: 0, conf: null, at: null, levels: {} },
      trendText: "无方向记录", sign: 0, position: { gram: 0, cost: 0, avgCost: null },
      accounts: [], supports: [], actions: [], todayActions: [],
      plan: { target: null, spacingUsd: null, spacingCny: null, lotPerGrid: null, cash: null, gears: 0 },
      feed: [], marks: [], gearHit: {},
    };
  }
  const buys = Array.isArray(raw.buys) ? raw.buys : [];
  const sells = Array.isArray(raw.sells) ? raw.sells : [];
  const sum = (arr, k) => arr.reduce((s, x) => s + (Number(x[k]) || 0), 0);

  const gram = sum(buys, "gram") - sum(sells, "gram");
  const cost = buys.reduce((s, b) => s + (Number(b.gram) || 0) * (Number(b.priceCny) || 0), 0)
             - sells.reduce((s, x) => s + (Number(x.gram) || 0) * (Number(x.priceCny) || 0), 0);
  const avgCost = gram > 0 ? round(cost / gram, 2) : null;

  // 账户：优先 accounts + acct 指针，缺失时按买入记录的 name 聚合
  const acctRaw = Array.isArray(raw.accounts) && raw.accounts.length ? raw.accounts : null;
  let accounts = [];
  if (acctRaw) {
    accounts = acctRaw.map((a) => {
      const bs = buys.filter((b) => b.acct === a.id);
      const ss = sells.filter((s) => s.acct === a.id);
      const g = sum(bs, "gram") - sum(ss, "gram");
      const c = bs.reduce((s, b) => s + (Number(b.gram) || 0) * (Number(b.priceCny) || 0), 0)
              - ss.reduce((s, x) => s + (Number(x.gram) || 0) * (Number(x.priceCny) || 0), 0);
      return { id: a.id, name: a.name || a.id, gram: round(g, 3), cost: round(c, 2), avgCost: g > 0 ? round(c / g, 2) : null };
    });
  } else {
    const names = [...new Set(buys.map((b) => b.name || "默认账户"))];
    accounts = names.map((n, i) => {
      const bs = buys.filter((b) => (b.name || "默认账户") === n);
      const ss = sells.filter((s) => (s.name || "默认账户") === n);
      const g = sum(bs, "gram") - sum(ss, "gram");
      const c = bs.reduce((s, b) => s + (Number(b.gram) || 0) * (Number(b.priceCny) || 0), 0);
      return { id: "n" + i, name: n, gram: round(g, 3), cost: round(c, 2), avgCost: g > 0 ? round(c / g, 2) : null };
    });
  }

  // 支撑/阻力：marks 是 $/oz，takePlan.price 已是 ¥/g
  const supports = [];
  (Array.isArray(raw.marks) ? raw.marks : []).forEach((m) => {
    const usd = Number(m.price);
    if (usd > 0) supports.push({ name: m.name || "标记位", cny: round(toCnyGram(usd, fx), 2), usdOz: round(usd, 1), kind: "mark" });
  });
  const tp = raw.takePlan && typeof raw.takePlan === "object" ? raw.takePlan : {};
  Object.keys(tp).forEach((k) => {
    const p = Number(tp[k] && tp[k].price);
    if (p > 0) supports.push({ name: k, cny: round(p, 2), usdOz: round(toUsdOz(p, fx), 1), kind: "take" });
  });
  supports.sort((a, b) => b.cny - a.cny);

  // 档距（$/oz）：H_BASE × (endDrop − startDrop)% ÷ (档数 − 1)
  const gears = Array.isArray(raw.wPct) && raw.wPct.length ? raw.wPct.length : 6;
  const startDrop = Number(raw.startDrop) > 0 ? Number(raw.startDrop) : 13;
  const endDrop = Number(raw.endDrop) > 0 ? Number(raw.endDrop) : 25;
  const hBase = Number(raw.H_BASE) > 0 ? Number(raw.H_BASE) : null;
  const spacingUsd = hBase ? round((hBase * (endDrop - startDrop)) / 100 / Math.max(1, gears - 1), 1) : null;

  const trend = parseFeedTrend(raw.feed);
  const actions = [
    ...buys.map((b) => ({ type: "BUY", gram: Number(b.gram) || 0, priceCny: Number(b.priceCny) || 0, time: b.time, name: b.name || "" })),
    ...sells.map((s) => ({ type: "SELL", gram: Number(s.gram) || 0, priceCny: Number(s.priceCny) || 0, time: s.time, name: s.name || "" })),
  ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  const isToday = (iso) => {
    if (!iso) return false;
    const d = new Date(iso);
    return dayKey(d.getTime(), 8) === dayKey(now, 8);
  };

  return {
    ok: true, err: null, raw,
    updatedAt: Number(raw.updatedAt) || null,
    trend, trendText: trend.text, sign: trend.sign,
    position: { gram: round(gram, 3), cost: round(cost, 2), avgCost },
    accounts,
    supports,
    actions,
    todayActions: actions.filter((a) => isToday(a.time)),
    plan: {
      target: Number(raw.TOTAL) > 0 ? Number(raw.TOTAL) : null,
      hBase,
      gears,
      spacingUsd,
      spacingCny: spacingUsd ? round(toCnyGram(spacingUsd, fx), 2) : null,
      lotPerGrid: Number(raw.TOTAL) > 0 ? round(Number(raw.TOTAL) / gears, 2) : null,
      cash: Number(raw.cash) > 0 ? Number(raw.cash) : null,
      wPct: Array.isArray(raw.wPct) ? raw.wPct : [],
    },
    feed: Array.isArray(raw.feed) ? raw.feed : [],
    marks: supports,
    gearHit: raw.gearHit || {},
    gearCleared: raw.gearCleared || {},
  };
}

/** 简单移动平均（只取最后 n 根已收盘） */
export function ma(closes, n) {
  if (!Array.isArray(closes) || closes.length < n || n <= 0) return null;
  const slice = closes.slice(-n);
  const s = slice.reduce((a, b) => a + b, 0);
  return s / n;
}

/** ATR（Wilder 简化：TR 的算术均值） */
export function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  const seg = bars.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < seg.length; i++) {
    const h = seg[i].h, l = seg[i].l, pc = seg[i - 1].c;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / period;
}

/** GMT+8 日期键 YYYY-MM-DD */
export function dayKey(ts, tz = 8) {
  const d = new Date(Number(ts) + tz * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * 置信度引擎：A 的内部日线趋势 × B 的外部 MA20 趋势
 * 返回 {scenario, confidence, badge, tone, headline, body, alerts}
 */
export function confidence(A, B, cfg = {}) {
  const dz = (cfg.deadZonePct ?? 0.05) / 100;
  const base = { alerts: [] };
  if (!A.ok) {
    return {
      ...base, scenario: "no-a", confidence: "degraded", badge: "降级", tone: "gray",
      headline: "内部源数据异常", toneClass: "tone--gray",
      body: "源数据异常，降级处理：老应用 data.json 读取失败，本页仅展示外部独立校验，不作建仓依据。",
    };
  }
  if (!B || !B.ok) {
    return {
      ...base, scenario: "degraded", confidence: "degraded", badge: "降级", tone: "gray",
      headline: "外部校验失败", toneClass: "tone--gray",
      body: `外部校验失败，置信度降级：内部显示日线${A.trend.label}，但独立行情不可用，无法交叉印证，建议暂停建仓。`,
    };
  }
  const a = A.sign, b = B.trend;
  if (a === -1 && b === -1) {
    return {
      ...base, scenario: "resonance_short", confidence: "high", badge: "高", tone: "red", toneClass: "tone--red",
      headline: "强共振做空", alerts: ["RESONANCE_SHORT"],
      body: `🔴 强共振做空：内部通道向下 + 外部跌破 MA20（现价 ${B.priceCnyGram} / MA20 ${B.ma20CnyGram}，偏离 ${B.devPct}%）。置信度高，建议严格按计划减仓，不接飞刀。`,
    };
  }
  if (a === 1 && b === 1) {
    return {
      ...base, scenario: "resonance_long", confidence: "high", badge: "高", tone: "green", toneClass: "tone--green",
      headline: "强共振做多", alerts: ["RESONANCE_LONG"],
      body: `🟢 强共振做多：内部上行 + 外部站上 MA20（偏离 +${Math.abs(B.devPct)}%）。置信度高，可按网格分批，但只加不追。`,
    };
  }
  if (a === -1 && b === 1) {
    return {
      ...base, scenario: "divergence_trap_up", confidence: "low", badge: "低", tone: "amber", toneClass: "tone--amber",
      headline: "多源背离", alerts: ["DIVERGENCE"],
      body: `⚠️ 多源背离：内部结构偏空，但外部 MA20 支撑强劲（现价 ${B.priceCnyGram} 高于 MA20 ${B.ma20CnyGram}，偏离 +${B.devPct}%）。假突破风险大，建议暂停建仓。`,
    };
  }
  if (a === 1 && b === -1) {
    return {
      ...base, scenario: "divergence_trap_down", confidence: "low", badge: "低", tone: "amber", toneClass: "tone--amber",
      headline: "多源背离", alerts: ["DIVERGENCE"],
      body: `⚠️ 多源背离：内部结构偏多，但外部已失守 MA20（偏离 ${B.devPct}%）。上冲缺乏外部支撑，勿追多，等回踩确认。`,
    };
  }
  return {
    ...base, scenario: "neutral", confidence: "low", badge: "低", tone: "gray", toneClass: "tone--gray",
    headline: "区间中轴",
    body: `⏳ 耐心持有：内部日线${A.trend.label}、外部${b === 0 ? "贴 MA20 震荡" : b === 1 ? "在 MA20 上方" : "在 MA20 下方"}，未形成共振。当前处于区间中轴，多看少动。`,
  };
}

/** 模块 0：晨报/晚报融合播报 */
export function briefing(A, B, conf, now = Date.now()) {
  const h = Number(new Date(Number(now) + 8 * 3600 * 1000).toISOString().slice(11, 13));
  const greet = h < 11 ? "早上好" : h < 18 ? "下午好" : "晚上好";
  if (!A.ok) return `${greet}。内部源数据异常，已降级处理：老应用 data.json 读取失败，本页仅展示外部独立校验结果，请勿据此下单。`;
  const inner = `内部系统显示日线处于${A.trend.label}${A.trend.conf != null ? `（内部置信 ${A.trend.conf}）` : ""}`;
  if (!B || !B.ok) {
    return `${greet}。${inner}，但外部独立行情抓取失败，交叉印证中断（置信度：降级）。建议只看内部计划、暂停新建仓位。`;
  }
  const outer = B.trend === 1
    ? `外部独立校验价格 ${B.priceCnyGram} 元/克，已站上 MA20（${B.ma20CnyGram}）`
    : B.trend === -1
      ? `外部独立校验价格 ${B.priceCnyGram} 元/克，已跌破 MA20（${B.ma20CnyGram}）`
      : `外部独立校验价格 ${B.priceCnyGram} 元/克，贴 MA20（${B.ma20CnyGram}）横走`;
  const agree = conf.confidence === "high" ? "多源一致（置信度：高）" : conf.confidence === "low" ? "多源出现分歧（置信度：低）" : "置信度：降级";
  const tail = conf.scenario === "resonance_short"
    ? "内部与外部同时转弱，建议优先执行减仓纪律，暂停自动买入。"
    : conf.scenario === "resonance_long"
      ? "方向一致向上，可维持网格节奏，但不要在偏离 MA20 过大时追加。"
      : conf.scenario === "neutral"
        ? "两侧都没给出方向，耐心等价格选边。"
        : "多源不一致时不加仓，等外部与内部重新对齐再动手。";
  return `${greet}。${inner}，但${outer.replace(/^外部独立校验/, "外部独立校验")}。${agree}。${tail}`;
}

/** 模块 2：交易计划与支撑验证 */
export function tradePlan(A, B) {
  if (!A.ok) return { tone: "gray", toneClass: "tone--gray", support: null, state: "unknown", text: "源数据异常，降级处理：读不到内部支撑位，本节暂不可用。" };
  const price = B && B.ok ? B.priceCnyGram : null;
  const below = price ? A.supports.filter((s) => s.cny < price).sort((a, b) => b.cny - a.cny) : A.supports.slice();
  const support = below[0] || A.supports[A.supports.length - 1] || null;
  if (!support) return { tone: "gray", toneClass: "tone--gray", support: null, state: "unknown", text: "内部未配置支撑位（marks / takePlan 为空），无法验证。" };
  const broken = price != null && price < support.cny;
  const label = `${support.name} ¥${support.cny}${support.usdOz ? `（$${support.usdOz}）` : ""}`;
  if (broken) {
    return {
      tone: "red", toneClass: "tone--red", support, state: "invalid",
      text: `⚠️ 支撑失效：外部现价 ${price} 已击穿内部支撑 ${label}，按纪律取消该档买入，等重新站回再评估。`,
    };
  }
  return {
    tone: "green", toneClass: "tone--green", support, state: "watch",
    text: `若回踩内部支撑位 ${label}，且外部日线出现下影线（收回支撑上方），建议买入；若外部行情直接击穿 ${support.cny}，支撑失效，取消买入。`,
  };
}

/** 模块 3：账户压力测试 */
export function stress(A, B, cfg = {}) {
  const drop = cfg.stressDrop ?? 0.05;
  const gram = A.ok ? A.position.gram : 0;
  const price = B && B.ok ? B.priceCnyGram : A.ok ? A.position.avgCost : null;
  if (!price || !gram) {
    return { tone: "gray", toneClass: "tone--gray", target: null, lossWan: null, cashWan: null, levels: 0, text: "源数据异常，降级处理：缺少可用的现价或持仓克重，压力测试跳过。" };
  }
  const target = round(price * (1 - drop), 2);
  const loss = gram * (price - target);
  const cash = A.plan.cash != null ? A.plan.cash : (A.plan.target ? Math.max(0, A.plan.target - gram) * price : 0);
  const lot = A.plan.lotPerGrid ? A.plan.lotPerGrid * target : target;
  const levels = lot > 0 ? Math.floor(cash / lot) : 0;
  const tone = levels >= 1 ? "amber" : "red";
  return {
    tone, toneClass: tone === "amber" ? "tone--amber" : "tone--red",
    target, lossWan: wan(loss), cashWan: wan(cash), levels, price, gram,
    text: `💣 极端压力：若跌 ${Math.round(drop * 100)}% 至 ${target} 元/克，浮亏达 ${wan(loss)} 万。${A.plan.cash != null ? "当前可用资金" : "计划内剩余额度"}（${wan(cash)} 万）可覆盖建仓至第 ${levels} 档。杠杆率：0。`,
  };
}

/** 模块 4：网格效率与熔断 */
export function grid(A, B, cfg = {}) {
  const fuse = A.ok && /单边下跌/.test(A.trend.label);
  const atrUsd = B && B.ok ? B.atrUsdOz : null;
  const spacing = A.ok ? A.plan.spacingUsd : null;
  const ratio = atrUsd && spacing ? atrUsd / spacing : null;
  if (!A.ok) return { tone: "gray", toneClass: "tone--gray", state: "unknown", fuse: false, ratio: null, text: "源数据异常，降级处理：读不到档距配置，网格效率无法评估。" };
  if (fuse) {
    return {
      tone: "red", toneClass: "tone--red", state: "fuse", fuse: true, ratio, atrUsd, spacing,
      text: `🔴 熔断警告：单边下跌，建议暂停后续自动买入计划（档距 ${spacing ?? "--"} 美元，ATR ${atrUsd} 美元）。`,
    };
  }
  if (ratio != null && ratio < 0.7) {
    return {
      tone: "amber", toneClass: "tone--amber", state: "low", fuse: false, ratio, atrUsd, spacing,
      text: `📉 效率下降：ATR 仅 ${Math.round(atrUsd)} 低于间距 ${Math.round(spacing)}（${(ratio * 100).toFixed(0)}%），触发频率低，建议缩小间距或观望。`,
    };
  }
  return {
    tone: "gray", toneClass: "tone--gray", state: "ok", fuse: false, ratio, atrUsd, spacing,
    text: `✅ 网格效率正常：ATR ${atrUsd ? Math.round(atrUsd) : "--"} 美元 / 档距 ${spacing ? Math.round(spacing) : "--"} 美元（${ratio ? (ratio * 100).toFixed(0) : "--"}%），维持现有节奏。`,
  };
}

/** 模块 5：多账户再平衡 */
export function rebalance(A, cfg = {}) {
  const list = A.ok ? A.accounts.filter((a) => a.gram > 0 && a.avgCost) : [];
  if (list.length < 2) {
    return { tone: "gray", toneClass: "tone--gray", text: "账户不足两个或克重为 0，暂无需再平衡。", high: null, low: null, spreadPct: null };
  }
  const sorted = [...list].sort((a, b) => b.avgCost - a.avgCost);
  const high = sorted[0], low = sorted[sorted.length - 1];
  const spread = ((high.avgCost - low.avgCost) / low.avgCost) * 100;
  const thin = spread < (cfg.rebalanceSpreadPct ?? 3);
  return {
    tone: thin ? "gray" : "amber", toneClass: thin ? "tone--gray" : "tone--amber",
    high, low, spreadPct: round(spread, 2),
    text: thin
      ? `🔄 换仓建议：${high.name}（${high.avgCost}）与 ${low.name}（${low.avgCost}）成本仅差 ${round(spread, 1)}%，无需换仓。`
      : `🔄 换仓建议：${high.name} 成本（${high.avgCost}）远高于 ${low.name}（${low.avgCost}），价差 ${round(spread, 1)}%。建议逢高减仓高成本账户、逢低补入低成本账户，拉低整体均价。`,
  };
}

/** 模块 6：纪律复盘教练 */
export function discipline(A, B, now = Date.now()) {
  if (!A.ok) return { tone: "gray", toneClass: "tone--gray", state: "unknown", items: [], text: "源数据异常，降级处理：读不到今日操作，纪律复核跳过。" };
  const bearish = A.sign === -1 || (B && B.ok && B.trend === -1 && A.sign === 0);
  const todayBuys = A.todayActions.filter((a) => a.type === "BUY");
  const todaySells = A.todayActions.filter((a) => a.type === "SELL");
  const items = A.todayActions.map((a) => ({ type: a.type, gram: a.gram, price: a.priceCny, time: a.time }));
  if (bearish && todayBuys.length) {
    const g = round(todayBuys.reduce((s, x) => s + x.gram, 0), 2);
    return {
      tone: "red", toneClass: "tone--red", state: "violation", items,
      text: `❌ 纪律扣分：趋势向下（${A.trend.label}）却于今日买入 ${g} 克，逆势加仓容易接飞刀，请严格执行网格，等价格回到支撑再买。`,
    };
  }
  if (!bearish && todaySells.length && A.sign === 1) {
    return {
      tone: "amber", toneClass: "tone--amber", state: "warn", items,
      text: `⚠️ 纪律提醒：趋势向上时卖出 ${round(todaySells.reduce((s, x) => s + x.gram, 0), 2)} 克，若非计划内止盈，注意别把底仓卖飞。`,
    };
  }
  return {
    tone: "green", toneClass: "tone--green", state: "clean", items,
    text: todayBuys.length
      ? `✅ 纪律良好：今日买入 ${round(todayBuys.reduce((s, x) => s + x.gram, 0), 2)} 克，方向与内部趋势不冲突，未发现违规操作。`
      : "✅ 纪律良好：未发现违规操作。",
  };
}
