/**
 * 数据清洗与防呆：僵尸数据、休市判定、缓存 TTL
 * 纯函数，无 DOM / 无网络依赖。
 */

export const STALE_MS = 15 * 60 * 1000;   // 超过 15 分钟视为僵尸数据
export const QUOTE_TTL = 60 * 1000;       // 现价/汇率缓存 1 分钟
export const MACRO_TTL = 15 * 60 * 1000;  // 宏观/评级缓存 15 分钟

/** 时间戳是否已过期（含未来时间容错：时钟偏差不超过 2 分钟不算异常） */
export function isStale(ts, now = Date.now(), maxAgeMs = STALE_MS) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return true;
  const age = now - t;
  if (age < -2 * 60 * 1000) return false; // 未来时间：视为刚更新
  return age > maxAgeMs;
}

/** 距上次更新多少分钟（用于文案） */
export function ageMinutes(ts, now = Date.now()) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

/** 是否周末（UTC+8 口径） */
export function isWeekend(d) {
  const day = new Date(d.getTime() + 8 * 3600 * 1000).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * 国内黄金交易时段（上海黄金交易所口径，UTC+8）
 * 日盘 09:00–11:30 / 13:30–15:30；夜盘 20:00–次日 02:30
 * 周六、周日休市（周五夜盘到 02:30 结束）
 */
export function isDomesticSession(date = new Date()) {
  const d = new Date(date.getTime() + 8 * 3600 * 1000);
  const day = d.getUTCDay();
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();

  const DAY_A = [9 * 60, 11 * 60 + 30];
  const DAY_B = [13 * 60 + 30, 15 * 60 + 30];
  const NIGHT = [20 * 60, 24 * 60];
  const NIGHT_EARLY = [0, 2 * 60 + 30];

  if (day >= 1 && day <= 5) {
    if ((m >= DAY_A[0] && m <= DAY_A[1]) || (m >= DAY_B[0] && m <= DAY_B[1])) return true;
    if (m >= NIGHT[0]) return true;
  }
  // 夜盘尾部：周二至周六凌晨（周一夜盘属于周一晚，周六凌晨来自周五晚）
  if (day >= 2 && day <= 6 && m <= NIGHT_EARLY[1]) return true;
  return false;
}

/** 溢价率状态：休市时冻结计算 */
export function premiumState(date = new Date()) {
  const open = isDomesticSession(date);
  return {
    open,
    frozen: !open,
    reason: open ? "国内交易时段，溢价率实时" : "国内休市，外盘独立运行中",
  };
}

/** 通用 TTL 缓存：命中返回缓存值，未命中执行 loader 并回填 */
export function withTTL(key, ttlMs, loader) {
  const store = withTTL._s || (withTTL._s = new Map());
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve()
    .then(loader)
    .then((val) => {
      if (val != null) store.set(key, { at: Date.now(), val });
      return val;
    });
}
