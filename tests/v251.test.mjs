/**
 * v2.5.1 用例：区分「上次轮询时间」与「内容变更时间」
 *
 * 背景：meta.syncedAt 只在源数据内容变化时才更新。账户流水一天只变几次，
 * 于是轮询明明每分钟都在成功，页面却显示「账户快照 5 小时前」——这是
 * 「读取不及时」的直接来源。
 *
 * 约定：
 *   checkedAt  —— 每次成功轮询都刷新（链路是否活着）
 *   syncedAt   —— 快照内容真正发生变化的时刻（数据新旧）
 *   sourceUpdatedAt —— 上游 data.json 自报的更新时间
 *
 * N1 sync-data.mjs 必须写入 checkedAt
 * N2 内容无变化时也必须刷新 META（不得提前 exit 跳过写 meta）
 * N3 前端优先用 checkedAt，缺失时回退 syncedAt（兼容老快照）
 * N4 syncedAt 语义保留为「内容变更时刻」
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(ROOT, p), "utf8");

test("N1 sync-data.mjs 写入 checkedAt（每次轮询都刷新）", async () => {
  const src = await read("scripts/sync-data.mjs");
  assert.match(src, /checkedAt:\s*new Date\(\)\.toISOString\(\)|checkedAt:\s*now/, "缺少 checkedAt");
});

test("N2 内容无变化时仍刷新 META，不得提前退出", async () => {
  const src = await read("scripts/sync-data.mjs");
  assert.doesNotMatch(src, /无变化，跳过写入/, "不得再走「跳过写入」提前退出");
  const changed = src.indexOf("const changed");
  const metaWrite = src.indexOf("writeFileSync(\n  META");
  assert.ok(changed > -1 && metaWrite > changed, "写 META 必须发生在判定 changed 之后且无条件执行");
  assert.doesNotMatch(
    src.slice(metaWrite, metaWrite + 40),
    /if\s*\(/,
    "写 META 不得被条件包裹",
  );
});

test("N3 前端优先用 checkedAt，缺失时回退 syncedAt", async () => {
  const src = await read("src/app.js");
  assert.match(src, /checkedAt\s*\|\|\s*[a-zA-Z.]*\.?syncedAt/, "需 checkedAt 优先、syncedAt 回退");
});

test("N4 syncedAt 保留「内容变更时刻」语义", async () => {
  const src = await read("scripts/sync-data.mjs");
  assert.match(src, /syncedAt/, "仍须写出 syncedAt");
  assert.match(src, /changed|变化/, "需按是否变更决定 syncedAt");
});
