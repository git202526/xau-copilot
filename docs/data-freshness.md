# 账户数据新鲜度：现状、根因与根治方案

> 适用版本：v2.4.0+
> 相关文件：`.github/workflows/sync-data.yml`、`src/config.js`、`src/app.js`、`src/render.js`

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

## 4. 根治方案 A：外部定时器触发 `workflow_dispatch`（推荐，零代码改动）

GitHub 的 schedule 不可控，但 `workflow_dispatch` 是**即时触发**的。用任意免费外部 cron 每 5–10 分钟调用一次 GitHub API 即可绕开调度延迟。

### 4.1 生成细粒度令牌

GitHub → Settings → Developer settings → Fine-grained tokens：

- 仅授权仓库 `git202526/xau-copilot`
- 权限：`Actions: Read and write`（仅此一项）
- 有效期按需设置

### 4.2 用 cron-job.org（免费）

1. 注册 https://cron-job.org
2. 新建任务：
   - URL：`https://api.github.com/repos/git202526/xau-copilot/actions/workflows/sync-data.yml/dispatches`
   - Method：`POST`
   - Headers：
     - `Authorization: Bearer <你的细粒度令牌>`
     - `Accept: application/vnd.github+json`
     - `Content-Type: application/json`
   - Body：`{"ref":"main"}`
   - 频率：每 5 分钟
3. 保存后可在 GitHub Actions 页面看到由 `workflow_dispatch` 触发的运行记录。

### 4.3 用 Cloudflare Worker（更可控）

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

配合 `wrangler.toml` 的 `[triggers] crons = ["*/5 * * * *"]`，令牌放 Worker Secret。

> 注意：令牌只存在外部服务端，**绝不写入前端或仓库**。

## 5. 根治方案 B：老应用仓库转公开 + 前端直连（时效最好，需权衡隐私）

若把 `xau-desk-data` 设为 public，前端可直接 `fetch`：

```js
const raw = "https://raw.githubusercontent.com/git202526/xau-desk-data/main/data.json";
```

- 优点：打开即最新，raw CDN 缓存约 5 分钟，链路最短；
- 缺点：实盘仓位对公网可见。用户此前表示「实盘上云也没事，别人以为是模拟数据」，如接受可直接切换；
- 切换成本：`src/config.js` 增加 `dataDirectUrl`，`loadA` 优先直连、失败回退 Actions 快照。

## 6. 取舍建议

| 场景 | 建议 |
|---|---|
| 只想尽快改善、不改隐私 | 方案 A（外部 cron 触发 dispatch） |
| 追求最短链路、可接受公开持仓 | 方案 B（公开仓库 + 前端直连） |
| 完全不想引入外部服务 | 保持现状：cron `*/5` + 阈值分级，接受数小时级延迟 |

无论哪种方案，前端都应继续显示「账户快照 X 前」，让用户对数据时效有明确预期，而不是给出「实时」的错觉。
