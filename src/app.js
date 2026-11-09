/** app.js —— 装配层：取数 → 归一化 → 引擎计算（无 DOM，可被测试直接调用） */
import { CONFIG } from "./config.js";
import { loadA } from "./sourceA.js";
import { loadB } from "./sourceB.js";
import * as E from "./engine.js";

export function buildState({ a, b, now, config = CONFIG }) {
  const fx = (b && b.fx) || config.fxFallback;
  const A = E.normalizeA(a && a.raw, { fx, now });
  A.ok = !!(a && a.ok) && A.ok;
  A.err = (a && a.err) || null;
  A.stale = !!(a && a.stale);

  const B = b || { ok: false, err: "no external data", trend: null };
  const decision = E.confidence(A, B, config);

  const state = {
    now,
    A,
    B,
    decision,
    briefing: E.briefing(A, B, decision, now),
    tradePlan: E.tradePlan(A, B),
    stress: E.stress(A, B, config),
    grid: E.grid(A, B, config),
    rebalance: E.rebalance(A, config),
    discipline: E.discipline(A, B, now),
    meta: {
      dataUpdatedAt: A.updatedAt,
      dataStale: A.stale,
      dataErr: A.err,
      bSource: B.ok ? B.source : null,
      bSourceLabel: B.ok ? B.sourceLabel : null,
      bAsOf: B.ok ? B.asOf : null,
      bBars: B.ok ? B.bars : 0,
      fx: fx,
      fxOk: !!(B && B.fxOk),
      fxFallbackUsed: !(B && B.fxOk),
      degraded: [!A.ok ? "A" : null, !B.ok ? "B" : null].filter(Boolean),
      dataUrl: config.dataUrl,
    },
  };
  return state;
}

export async function loadAll(opt = {}) {
  const config = opt.config || CONFIG;
  const now = Number(opt.now) || Date.now();
  const fetchImpl = opt.fetchImpl || globalThis.fetch;
  const storage = opt.storage !== undefined
    ? opt.storage
    : (typeof localStorage !== "undefined" ? localStorage : null);

  const [a, b] = await Promise.all([
    loadA({ fetchImpl, storage, now, config }),
    loadB({ fetchImpl, now, config }),
  ]);
  return buildState({ a, b, now, config });
}
