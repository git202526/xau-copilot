/**
 * sync-data.mjs —— 把老应用私有库的 data.json 同步成本仓库的公开快照
 * 运行环境：GitHub Actions（需要 secret XAU_DATA_TOKEN，只读老应用数据仓库）
 * 本地运行：DATA_TOKEN=xxx node scripts/sync-data.mjs
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const TOKEN = process.env.XAU_DATA_TOKEN || process.env.DATA_TOKEN || process.env.GH_TOKEN;
const SRC = {
  owner: process.env.SRC_OWNER || "git202526",
  repo: process.env.SRC_REPO || "xau-desk-data",
  path: process.env.SRC_PATH || "data.json",
  branch: process.env.SRC_BRANCH || "main",
};
const OUT = "data/live.json";
const META = "data/meta.json";

if (!TOKEN) {
  console.error("[sync] 缺少 XAU_DATA_TOKEN，退出（不覆盖既有快照）");
  process.exit(1);
}

const api = `https://api.github.com/repos/${SRC.owner}/${SRC.repo}/contents/${SRC.path}?ref=${SRC.branch}`;
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "xau-copilot-sync",
};

function validate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("payload 不是对象");
  const keys = ["buys", "sells", "accounts", "feed", "TOTAL", "H_BASE"];
  const hit = keys.filter((k) => k in raw).length;
  if (hit < 2) throw new Error(`payload 字段缺失（命中 ${hit} 个）`);
  return raw;
}

const res = await fetch(api, { headers });
if (!res.ok) {
  console.error(`[sync] 读取源失败 HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const text = await res.text();
let raw;
try {
  raw = validate(JSON.parse(text));
} catch (e) {
  console.error(`[sync] 校验失败：${e.message}`);
  process.exit(1);
}

const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
const next = JSON.stringify(raw, null, 2);
const changed = prev.trim() !== next.trim();

/* 老快照兼容：读不到就当作没有 */
let prevMeta = {};
try {
  prevMeta = existsSync(META) ? JSON.parse(readFileSync(META, "utf8")) : {};
} catch {
  prevMeta = {};
}

const nowIso = new Date().toISOString();

if (changed) writeFileSync(OUT, next + "\n");

/* 无论内容是否变化都要刷新 META：
 *   checkedAt —— 本次轮询成功的时刻（链路是否活着）
 *   syncedAt  —— 内容真正发生变化的时刻（数据新旧），未变化则沿用上一次
 * 否则账户流水一天只变几次时，轮询再频繁也会被误读成「数据陈旧」。 */
writeFileSync(
  META,
  JSON.stringify(
    {
      checkedAt: nowIso,
      syncedAt: changed ? nowIso : (prevMeta.syncedAt || nowIso),
      sourceUpdatedAt: raw.updatedAt || null,
      source: `${SRC.owner}/${SRC.repo}/${SRC.path}`,
      bytes: Buffer.byteLength(next),
      trades: (raw.buys || []).length + (raw.sells || []).length,
      mode: "actions",
    },
    null,
    2,
  ) + "\n",
);

console.log(
  changed
    ? `[sync] 已更新快照：${Buffer.byteLength(next)} bytes，源 updatedAt=${raw.updatedAt}`
    : `[sync] 内容无变化，已刷新 checkedAt=${nowIso}`,
);
