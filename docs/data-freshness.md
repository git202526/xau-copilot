# 账户数据新鲜度：现状、根因与已实施方案

> 适用版本：v2.4.0+（阈值分级）／v2.5.0+（自调度链路）
> 相关文件：`.github/workflows/sync-data.yml`、`src/config.js`、`src/app.js`、`src/render.js`

> **状态：方案 A 已实施（v2.5.0）** —— 采用 GitHub 原生自调度链，**不需要**外部定时服务、**不需要**额外 PAT。
> 效果：数据每 10 分钟刷新一次；链路意外中断后最多 **30 分钟**由兜底 `schedule` 自愈。

## 1. 现状

账户事实（持仓、均价、克重、网格参数）来自私有库 `git202526/xau-desk-data`，前端无法直连（仓库私有、需令牌），只能由 GitHub Actions 定时同步为公开快照 `data/live.json` + `data/meta.json`。

`meta.json` 记录最近一次同步时间：

```json
{ "syncedAt": "2026-11-12T19:12:59.711Z", "sourceUpdatedAt": 1794497393074, "mode": "actions" }
```

## 2. 根因：GitHub scheduled workflow 会被大幅延迟

工作流原本配置 `cron: "*/15 * * * *"`，但实际运行间隔常达 **4–8 小时**。这不是配置写错，而是 GitHub 对 scheduled workflow 的既有行为：

- 高峰期排队，可能延迟数小时甚至跳过；
- 仓库活跃度低时优先级更低；
- 官方文档明确说明 schedule 不保证准时。

因此「页面显示数据陈旧」并非前端 bug，而是同步链路本身的时效上限。

## 3. v2.4.0 已做的改进（无需额外配置）

| 改进 | 说明 |
|---|---|
| cron `*/15` → `*/5` | 提高触发命中率；GitHub 最小间隔为 5 分钟，仍可能延迟 |
| 阈值分离 | 行情用 `staleMinutes=15`（严格），账户快照用 `accountStaleMinutes=360`（宽松），避免把正常调度延迟误报成「陈旧」 |
| 页脚分级 | 「账户快照 3.2 小时前」按分钟 / 小时显示，超过 6 小时才标「（陈旧）」 |
| `push` 顺带同步 | 每次发版 push 到 `main` 也会触发一次同步，不完全依赖 schedule |

## 4. 已实施：GitHub 原生自调度链（v2.5.0，方案 A 的实现）

`workflow_dispatch` 是即时触发的，不受 schedule 排队影响。既然 GitHub 自带的 `GITHUB_TOKEN` 支持 `workflow_dispatch`（属于官方文档列明的「不会被 GITHUB_TOKEN 抑制」的例外事件），就让**工作流自己在轮末调度下一轮**，不需要任何外部 cron、也不需要长期 PAT。

### 4.1 链路结构

```
run(N) ── 同步 ×6 轮（每 10 分钟一次，约 60 分钟）
        └─ 轮末：gh workflow run sync-data.yml --ref main
                                  ↓
run(N+1) ── 同上 …… 持续滚动
```

| 参数 | 值 | 理由 |
|---|---|---|
| `SYNC_INTERVAL` | `600`（10 分钟） | 每小时 6 次 Pages 构建，低于免费站点 10 次/小时软限制；对网格决策已足够 |
| `SYNC_ROUNDS` | `6` | 单次 run 约 60 分钟，避免长时间占用 runner |
| `timeout-minutes` | `75` | 兜住异常挂起 |
| 兜底 `schedule` | `*/30 * * * *` | 链断了最多 30 分钟自愈 |
| 权限 | `contents: write` + `actions: write` | 仅仓库内置令牌，无外部凭证 |

### 4.2 防双链与自我修复

- **只在 `schedule` / `workflow_dispatch` 触发的 run 里自调度**；`push`（发版）触发的 run 只同步一次，不接链。
- dispatch 前先查 `--status=queued` 与 `--status=in_progress`，排除自身 `GITHUB_RUN_ID`；已有其他任务在跑/排队则**跳过自调度**。
- 单轮抓取失败只打印日志并保留上一份快照（`|| echo`），不会中断整条链。
- 推送前 `git pull --rebase --autostash`，失败重试 3 次，避免与并发提交分叉。

### 4.3 熔断与回滚

- 停止链路：仓库 Settings → Variables 设 `SYNC_LOOP=off`，或在 Actions 页面 Disable workflow。当前 run 会把尾巴跑完，之后不再自调度。
- 回滚到 v2.4.0 行为：`git checkout v2.4.0 -- .github/workflows/sync-data.yml`，即回到纯 `schedule` 模式（会重新变慢）。
- 想改刷新频率：只改 `SYNC_INTERVAL`（秒）。低于 600 会逼近 Pages 构建软限制，不建议。

### 4.4 如何确认链路活着

```bash
gh run list --workflow=sync-data.yml --limit 10 \
  --json createdAt,event,status,conclusion \
  --jq '.[] | "\(.createdAt) \(.event) \(.status)/\(.conclusion)"'
```

健康特征：`event` 交替出现 `workflow_dispatch`，相邻 run 的 `createdAt` 间隔约 60 分钟；页面页脚「源数据 / 账户快照」应为个位数到十几分钟。

## 4A. 备选：外部定时器触发 `workflow_dispatch`（本方案未采用）

若将来想彻底摆脱 GitHub Actions 的链路（例如换成自己的服务器），仍可用外部 cron 触发，此时需要一把只授 `Actions: Read and write` 的细粒度令牌：

```bash
curl -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/git202526/xau-copilot/actions/workflows/sync-data.yml/dispatches \
  -d '{"ref":"main"}'
```

Cloudflare Worker 版本（`[triggers] crons = ["*/5 * * * *"]`，令牌放 Worker Secret）：

```js
export default {
  async scheduled(event, env) {
    await fetch(
      "https://api.github.com/repos/git202526/xau-copilot/actions/workflows/sync-data.yml/dispatches",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "xau-copilot-cron",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );
  },
};
```

> 令牌只存在外部服务端，**绝不写入前端或仓库**。当前 v2.5.0 的自调度链不需要这一步。

## 5. 根治方案 B：老应用仓库转公开 + 前端直连（时效最好，需权衡隐私）

若把 `xau-desk-data` 设为 public，前端可直接 `fetch`：

```js
const raw = "https://raw.githubusercontent.com/git202526/xau-desk-data/main/data.json";
```

- 优点：打开即最新，raw CDN 缓存约 5 分钟，链路最短；
- 缺点：实盘仓位对公网可见。用户此前表示「实盘上云也没事，别人以为是模拟数据」，如接受可直接切换；
- 切换成本：`src/config.js` 增加 `dataDirectUrl`，`loadA` 优先直连、失败回退 Actions 快照。

## 6. 取舍结论

| 场景 | 方案 | 状态 |
|---|---|---|
| 改善时效、不碰隐私、不引入外部服务 | **自调度链（本方案）** | **已实施（v2.5.0）** |
| 想彻底脱离 GitHub Actions 调度 | 外部 cron 触发 `workflow_dispatch` | 备选，需细粒度令牌 |
| 追求秒级、可接受公开原始流水 | 方案 B（老应用仓库转公开 + 前端直连） | 未采用 |
| 完全不想改 | `schedule` + 阈值分级 | 已废弃（实测 4–8 小时延迟） |

无论哪种方案，前端都继续显示「源数据 X 前 / 账户快照 X 前」，让用户对数据时效有明确预期，而不是给出「实时」的错觉。

---

## 7. 另外两条时效陷阱（v2.5.2）

账户链路修好之后，页面还有两处「看起来是刷新问题、实际是口径问题」的地方被用户直接点名，一并记录。

### 7.1 金价：源不同，价格就不同

| 源 | 实测（2026-11-13 同时刻） | 问题 |
|---|---|---|
| `api.gold-api.com/price/XAU` | 3885.77 / 3884.17 / 3889.72（连续三次） | 比新浪高 3.2~8.6，且每次跳；曾报 3909 而新浪约 3880 |
| `hq.sinajs.cn/list=hf_XAU` | 3880.18 / 3880.98 / 3881.13 | 与 XAU Desk 等行情软件逐项对得上 |

**结论**：金价不是「越实时的源越准」，而是「要跟用户对照的那个软件同源」。现改由 Actions 抓 `hf_XAU` 写快照，前端只读；`hq.sinajs.cn` 不返回 CORS 头，前端本来也直连不了。

### 7.2 宏观：日频源永远追不上「今天」

| 源 | 更新方式 | 11-13 能看到的最新值 |
|---|---|---|
| FRED `DGS10` | 日频，T+1 发布，遇美股假期再顺延 | 11-10（11-11 退伍军人节休市） |
| CBOE `VIX_History.csv` | 每交易日收盘后 | 11-12 收盘 |
| **CNBC `US10Y` / `.DXY` / `.VIX`** | 实时，带 `last_time` | **11-13 09:09 EST（当下）** |

页面现在会显示 `数据 22:09 · 3 分钟前`；超过 60 分钟标「源滞后」；一旦回退到日频源，直接写「数据日期 2026-11-10 · 源为日频，非实时」，不再让用户以为它坏了。

> 踩坑：CNBC 多标的必须用 `|`（`%7C`）分隔。用逗号会返回 `{"symbol":"US10Y,.DXY,.VIX","code":"1"}` 的空壳，三项全部落空并静默回退日频源。
