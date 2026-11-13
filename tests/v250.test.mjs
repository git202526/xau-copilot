/**
 * v2.5.0 用例：数据刷新链路（方案 A · GitHub 原生自调度）
 *
 * 背景：GitHub `schedule` 实测延迟 4–8 小时，用户反馈「账户数据陈旧、读取不及时」。
 * 方案：工作流每轮 10 分钟同步一次，轮末 `workflow_dispatch` 调度自己，形成连续链路；
 *       `schedule` 降级为兜底（链断后最多 30 分钟自愈）；
 *       仅使用仓库内置 GITHUB_TOKEN（actions: write），不引入外部定时服务或长期 PAT。
 *
 * H1  自调度权限：workflow 必须声明 actions: write
 * H2  自调度步骤：必须存在 `gh workflow run sync-data.yml`
 * H3  节流参数：SYNC_INTERVAL=600 + SYNC_ROUNDS≥2 + sleep 间隔
 * H4  兜底 cron：每 30 分钟（不再靠每 5 分钟扛主链路）
 * H5  防双链守卫：dispatch 前排除自身 run id，并检查 queued / in_progress
 * H6  只对 schedule / workflow_dispatch 自调度（push 事件不自调度）
 * H7  熔断开关：vars.SYNC_LOOP == 'off' 时停止链路
 * H8  单轮失败不中断链路（抓取步骤带 || 兜底）
 * H9  推送前 pull --rebase（避免与并发提交分叉）
 * H10 Pages 构建频率：10 分钟节流 → 每小时 6 次（低于免费站点 10 次/小时软限制）
 * H11 文档同步：data-freshness 标明已实施方案 A 与链路自愈时间
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFile(join(ROOT, p), "utf8");
const WF = ".github/workflows/sync-data.yml";

test("H1 工作流声明 actions: write（自调度所需最小权限）", async () => {
  const yml = await read(WF);
  assert.match(yml, /permissions:[\s\S]*?actions:\s*write/, "缺少 actions: write 无法 dispatch");
  assert.match(yml, /contents:\s*write/, "提交数据仍需 contents: write");
  assert.doesNotMatch(yml, /secrets\.GH_PAT|secrets\.PAT_/, "不得引入外部长期 PAT");
});

test("H2 存在自调度步骤（gh workflow run 自身）", async () => {
  const yml = await read(WF);
  assert.match(yml, /gh workflow run sync-data\.yml/, "缺少自调度调用");
});

test("H3 节流参数：10 分钟一轮、多轮循环", async () => {
  const yml = await read(WF);
  assert.match(yml, /SYNC_INTERVAL:\s*"?600"?/, "间隔应为 600 秒（10 分钟）");
  const m = yml.match(/SYNC_ROUNDS:\s*"?(\d+)"?/);
  assert.ok(m, "缺少 SYNC_ROUNDS");
  assert.ok(Number(m[1]) >= 2, "每轮至少 2 次同步才值得自调度");
  assert.match(yml, /sleep\s+"?\$(INTERVAL|SYNC_INTERVAL)"?/, "循环内需按间隔 sleep");
  assert.match(yml, /\$\{INPUT_INTERVAL:-\$SYNC_INTERVAL\}/, "间隔需可被手动输入覆盖，默认值不变");
});

test("H4 兜底 cron 改为 */30（主链路不再依赖 schedule）", async () => {
  const yml = await read(WF);
  assert.match(yml, /\*\/30 \* \* \* \*/, "schedule 应降级为 30 分钟兜底");
  assert.doesNotMatch(yml, /\*\/5 \* \* \* \*/, "不应再用 */5 冒充刷新主链路");
});

test("H5 防双链守卫：排除自身 run 并检查排队/运行中", async () => {
  const yml = await read(WF);
  assert.match(yml, /GITHUB_RUN_ID/, "必须排除自身 run id");
  assert.match(yml, /--status=queued/, "需检查排队中的运行");
  assert.match(yml, /--status=in_progress/, "需检查运行中的任务");
  assert.match(yml, /跳过自调度|avoid|skip/i, "命中守卫时应明确跳过");
});

test("H6 仅 schedule / workflow_dispatch 触发自调度，push 不自调度", async () => {
  const yml = await read(WF);
  assert.match(
    yml,
    /github\.event_name\s*==\s*'schedule'[\s\S]{0,120}github\.event_name\s*==\s*'workflow_dispatch'/,
    "自调度条件需限定为 schedule / workflow_dispatch",
  );
});

test("H7 熔断开关：vars.SYNC_LOOP=off 停止链路", async () => {
  const yml = await read(WF);
  assert.match(yml, /vars\.SYNC_LOOP/, "缺少熔断开关");
  assert.match(yml, /SYNC_LOOP\s*!=\s*'off'/, "默认开启、置 off 即停");
});

test("H8 单轮抓取失败不中断整条链路", async () => {
  const yml = await read(WF);
  const guarded = yml.match(/node scripts\/sync-\S+\.mjs\s+\|\|\s*echo/g) || [];
  assert.ok(guarded.length >= 3, `三个抓取脚本都需失败兜底，实际 ${guarded.length} 个`);
});

test("H9 推送前先 pull --rebase，避免与并发提交分叉", async () => {
  const yml = await read(WF);
  assert.match(yml, /git pull --rebase/, "缺少 rebase 收敛");
  assert.match(yml, /git push/, "需实际推送");
});

test("H10 每 10 分钟一次 → 每小时 6 次 Pages 构建，低于 10 次软限制", async () => {
  const yml = await read(WF);
  const sec = Number((yml.match(/SYNC_INTERVAL:\s*"?(\d+)"?/) || [])[1]);
  assert.equal(sec, 600);
  const buildsPerHour = 3600 / sec;
  assert.ok(buildsPerHour <= 10, `每小时构建 ${buildsPerHour} 次，超出 Pages 软限制`);
});

test("H11 文档标注已实施方案 A 与自愈时间", async () => {
  const doc = await read("docs/data-freshness.md");
  assert.match(doc, /已实施/, "需标明已实施");
  assert.match(doc, /30 分钟/, "需写明兜底自愈时间");
  assert.match(doc, /自调度|workflow_dispatch/, "需说明自调度机制");
});
