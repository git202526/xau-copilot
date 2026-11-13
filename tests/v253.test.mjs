/**
 * v2.5.3 用例：发版触发的同步运行不再被并发组顶掉
 *
 * 现象（2026-11-13 14:22 实测）：
 *   push 触发的 sync-data 从创建起一直 pending（同组有 chain run 在跑），
 *   5 分钟后新的 workflow_dispatch run 进入同组队列，GitHub 只保留最新 pending，
 *   于是 push run 被判 cancelled —— Actions 页面留下红叉，发版后的即时同步实际没跑。
 *
 * 修法：
 *   P1  push 只对非 data 变更触发（paths-ignore），消除「提交数据 → 再触发 → 再提交」的自激
 *   P2  push 运行使用独立并发组，不与 chain run 抢同一个 queued 名额
 *   P3  push 仍保留（发版后立即用新代码同步一次），且只跑 1 轮、不接链
 *   P4  chain（schedule / workflow_dispatch）之间仍互斥，防双链
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(ROOT, p), "utf8");
const WF = ".github/workflows/sync-data.yml";

test("P1 push 忽略 data/** 变更，避免数据提交自我触发", async () => {
  const yml = await read(WF);
  assert.match(yml, /push:[\s\S]*?paths-ignore:[\s\S]*?data\/\*\*/, "push 需 paths-ignore data/**");
  /* 仍要响应代码/文档变更 */
  assert.match(yml, /branches:\s*\[main\]/, "push 仍限定 main");
});

test("P2 push 运行使用独立并发组，不被 chain run 顶掉", async () => {
  const yml = await read(WF);
  assert.match(
    yml,
    /concurrency:[\s\S]*?group:\s*sync-data-\$\{\{\s*github\.event_name\s*\}\}/,
    "并发组需按事件名区分，否则 push 会排队后被顶替",
  );
  assert.match(yml, /cancel-in-progress:\s*false/, "不得开启取消进行中的运行");
});

test("P3 push 仍保留且只跑 1 轮、不自调度", async () => {
  const yml = await read(WF);
  assert.match(yml, /if\s*\[\s*"\$\{GITHUB_EVENT_NAME:-\}"\s*=\s*"push"\s*\]\s*;\s*then\s+ROUNDS=1/, "push 应只同步 1 轮");
  assert.match(
    yml,
    /github\.event_name\s*==\s*'schedule'\s*\|\|\s*github\.event_name\s*==\s*'workflow_dispatch'/,
    "自调度仍只对 chain 事件生效",
  );
});

test("P4 chain 事件之间仍互斥（防双链守卫未丢）", async () => {
  const yml = await read(WF);
  assert.match(yml, /--status=queued/, "需检查排队中的运行");
  assert.match(yml, /--status=in_progress/, "需检查运行中的任务");
  assert.match(yml, /databaseId\s*!=\s*\$\{GITHUB_RUN_ID\}/, "需排除自身");
});

test("P5 同步步骤仍带失败兜底，不中断链路", async () => {
  const yml = await read(WF);
  const guarded = yml.match(/node scripts\/sync-\S+\.mjs\s+\|\|\s*echo/g) || [];
  assert.ok(guarded.length >= 3, `三个同步步骤都应带兜底，实际 ${guarded.length}`);
});
