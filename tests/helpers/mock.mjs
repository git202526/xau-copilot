// tests/helpers/mock.mjs —— 零依赖 fetch 拦截器（TDD 基础设施）
export const DAY = 86400000;

/** 造 n 根已收盘日线：closes 为收盘价序列（USD/oz） */
export function mkBars(closes, opts = {}) {
  const step = opts.step || DAY;
  const start = opts.start || (Date.now() - (closes.length + 2) * step);
  return closes.map((c, i) => {
    const ot = start + i * step;
    const ct = ot + step - 1;
    const o = i === 0 ? c : closes[i - 1];
    const h = Math.max(o, c) * 1.004;
    const l = Math.min(o, c) * 0.996;
    return [ot, String(o), String(+h.toFixed(3)), String(+l.toFixed(3)), String(c), "100", ct, "0", 10, "0", "0", "0"];
  });
}

/** 单调序列生成器 */
export function ramp(from, to, n) {
  return Array.from({ length: n }, (_, i) => +(from + ((to - from) * i) / (n - 1)).toFixed(3));
}

export function jsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

export function textResponse(txt, status = 200) {
  return { ok: status === 200, status, headers: { get: () => null }, text: async () => txt, json: async () => JSON.parse(txt) };
}

/**
 * 安装全局 fetch 路由。routes: [[substring, handler]]，handler(url, opts) 可返回 response 或抛错。
 * 返回 calls 数组，供断言（T5 检查 POST 载荷）。
 */
export function installFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: (opts.method || "GET").toUpperCase(), body: opts.body });
    for (const [pat, handler] of routes) {
      if (u.includes(pat)) return handler(u, opts);
    }
    throw new Error("UNROUTED_FETCH: " + u);
  };
  return calls;
}

export function uninstallFetch() {
  delete globalThis.fetch;
}

/** 内存版 storage（替代 localStorage） */
export function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

/** 老应用 data.json 形态的测试夹具 */
export function fixtureA(over = {}) {
  return {
    H_BASE: 4696,
    TOTAL: 330,
    cutRatio: 100,
    lastDir: "dn",
    alpha: 1.16,
    spanMode: "alpha",
    avgTarget: 3800,
    avgBand: 60,
    wPct: [4, 6, 10, 14, 17, 18, 15, 10, 6],
    updatedAt: 1794223899292,
    accounts: [
      { id: "a1", name: "浙商", note: "", color: "#D4A24C", at: 0 },
      { id: "a2", name: "民生", note: "", color: "#6EA8FE", at: 0 },
    ],
    acctLast: "a1",
    buys: [
      { id: "b1", name: "浙商", gram: 71.6283, priceCny: 959.41, time: "2026-11-03T06:58:00.000Z", note: "", acct: "a1" },
      { id: "b2", name: "民生", gram: 120.0, priceCny: 1042.5, time: "2026-10-28T02:10:00.000Z", note: "", acct: "a2" },
      { id: "b3", name: "浙商", gram: 60.0, priceCny: 981.2, time: "2026-10-21T02:10:00.000Z", note: "", acct: "a1" },
    ],
    sells: [{ id: "s1", name: "卖出", gram: 1, priceCny: 878.87, time: "2026-11-09T08:57:00.000Z", note: "", acct: "a1" }],
    marks: [{ id: "mk1", at: 1793466702604, price: 4500, name: "成本位置", kind: "auto", dist: 16.08 }],
    takePlan: {
      "整数 $4000": { cut: 26, price: 856.6, at: 1793623408354 },
      "整数 $4100": { cut: 31.7, price: 879.36, at: 1793547957340 },
    },
    alerts: [],
    feed: [
      { t: 1794223899292, type: "dir", text: "方向由 震荡 转为 下行", detail: "周线 震荡 · 日线 下行 · 4小时 上行 · 1小时 震荡 · 置信 31" },
      { t: 1794216885455, type: "dir", text: "方向由 下行 转为 震荡", detail: "周线 震荡 · 日线 震荡 · 4小时 上行 · 1小时 震荡 · 置信 0" },
    ],
    gearHit: {},
    gearCleared: {},
    ...over,
  };
}
