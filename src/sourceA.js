/** sourceA.js —— 老应用数据的只读适配层（零侵入：只 GET，绝不写） */
import { CONFIG } from "./config.js";

function unwrap(j) {
  if (!j || typeof j !== "object") return null;
  // 兼容三种云端形态：裸 cfg / {data:cfg} / {state:cfg}
  if (j.buys || j.accounts || j.feed || j.TOTAL || j.H_BASE) return j;
  if (j.data && typeof j.data === "object") return jwt(j.data);
  if (j.state && typeof j.state === "object") return jwt(j.state);
  if (j.cfg && typeof j.cfg === "object") return jwt(j.cfg);
  return j;
}
function jwt(o) {
  if (o.buys || o.accounts || o.feed || o.TOTAL) return o;
  if (o.cfg && typeof o.cfg === "object") return o.cfg;
  return o;
}

/**
 * @returns {{ok:boolean, stale:boolean, raw:object|null, err:string|null, fetchedAt:number}}
 */
export async function loadA(opt = {}) {
  const config = opt.config || CONFIG;
  const fetchImpl = opt.fetchImpl || globalThis.fetch;
  const storage = opt.storage || null;
  const now = Number(opt.now) || Date.now();
  const url = `${config.dataUrl}${config.dataUrl.includes("?") ? "&" : "?"}t=${now}`;

  try {
    const r = await fetchImpl(url, { cache: "no-store" });
    if (!r || !r.ok) throw new Error("data HTTP " + (r && r.status));
    const raw = unwrap(await r.json());
    if (!raw || typeof raw !== "object") throw new Error("data: empty / malformed");
    // 顺带取一次同步元信息（失败不影响主流程）：让用户看见「数据在 GitHub 上，几点同步的」
    let syncAt = null, sourceUpdatedAt = null;
    try {
      const mr = await fetchImpl(config.dataUrl.replace(/live\.json$/, "meta.json") + "?t=" + now, { cache: "no-store" });
      if (mr && mr.ok) {
        const mj = await mr.json();
        syncAt = mj && mj.syncedAt ? Date.parse(mj.syncedAt) : null;
        sourceUpdatedAt = mj && mj.sourceUpdatedAt ? Number(mj.sourceUpdatedAt) : null;
      }
    } catch (_) {}
    if (storage) {
      try { storage.setItem(config.cacheKey, JSON.stringify({ at: now, raw })); } catch (_) {}
    }
    return { ok: true, stale: false, raw, err: null, fetchedAt: now, syncAt, sourceUpdatedAt };
  } catch (e) {
    let cached = null;
    try { cached = storage && storage.getItem(config.cacheKey); } catch (_) {}
    if (cached) {
      try {
        const c = JSON.parse(cached);
        if (c && c.raw) return { ok: true, stale: true, raw: c.raw, err: String(e.message || e), fetchedAt: c.at || null, syncAt: null };
      } catch (_) {}
    }
    return { ok: false, stale: false, raw: null, err: String(e.message || e), fetchedAt: null };
  }
}
