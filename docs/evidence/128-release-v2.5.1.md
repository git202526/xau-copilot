# XAU Copilot v2.5.1 自动化运行报告

生成时间：2026-11-13 21:38 (GMT+8)
交付范围：**账户快照新鲜度语义修正（问题 6 的第二层根因）**

---

## 0. 为什么 v2.5.0 之后还有一版

v2.5.0 把刷新频率提到 10 分钟，但上线后核对发现：页面仍会显示「账户快照 5 小时前」。

原因不在频率，而在**时间戳语义**：

```js
// scripts/sync-data.mjs（修复前）
if (prev.trim() === next.trim()) {
  console.log("[sync] 无变化，跳过写入");
  process.exit(0);          // ← 内容没变就完全不写 meta
}
```

`meta.syncedAt` 记的是「内容变更时刻」，不是「上次成功轮询」。账户流水一天只变几次，于是轮询再勤，时间戳也不动——用户看到的就是「数据陈旧」。

## 1. 修复

`meta.json` 拆成三个时间：

| 字段 | 含义 | 写入时机 |
|---|---|---|
| `checkedAt` | 上次成功轮询 | **每次轮询都写** |
| `syncedAt` | 快照内容真正变化 | 仅内容变化时 |
| `sourceUpdatedAt` | 上游 `data.json` 自报更新时间 | 每次轮询 |

前端 `src/app.js`：

```js
const syncAt = aRes.meta
  ? Date.parse(aRes.meta.checkedAt || aRes.meta.syncedAt || 0) || null
  : null;
```

旧快照没有 `checkedAt` 时自动回退 `syncedAt`，不会崩。

## 2. 红灯

`docs/evidence/124-v251-red.log` —— 在 **v2.5.0 的 git worktree** 上跑新用例：

```
not ok 1 - N1 sync-data.mjs 写入 checkedAt
not ok 2 - N2 内容无变化时仍刷新 META，不得提前退出
not ok 3 - N3 前端优先用 checkedAt，缺失时回退 syncedAt
ok     4 - N4 syncedAt 保留「内容变更时刻」语义
# tests 4 / pass 1 / fail 3
```

## 3. 绿灯

`docs/evidence/125-v251-green.log`：4/4，全量 **123/123**，`SYNTAX OK`。

本地实跑两次（内容未变）：

```
[sync] 内容无变化，已刷新 checkedAt=2026-11-13T13:23:07.829Z
[sync] 内容无变化，已刷新 checkedAt=2026-11-13T13:23:10.855Z
checkedAt 前进: True
syncedAt  保持: 2026-11-13T13:06:47.659Z
```

## 4. 线上生效（`127-v251-restart.log`）

链路当时跑在旧代码上（13:07 启动的那一轮），为避免它把 meta 写回旧格式，做了「取消 + 立即重启」：

```
cancel  43430927723  （旧代码，13:07 启动）
dispatch 43435034296 （新代码 c07ba6c，13:35:51 启动）
```

新代码首轮写入：

```json
{ "checkedAt": "2026-11-13T13:36:09.120Z", "syncedAt": "2026-11-13T13:06:47.659Z" }
```

`checkedAt` 2.7 分钟前、`syncedAt` 32 分钟前 —— 语义分离生效，且 `syncedAt` 保持不动证明「内容确实未变」而不是「链路没跑」。

## 5. 部署执行结果

**状态：已上线，线上终验 PASS（2026-11-13 21:35 GMT+8）。**

| 步骤 | 结果 |
|---|---|
| 提交 | `c07ba6c fix(v2.5.1): 区分 checkedAt 与 syncedAt` |
| 变基 | 变基到链路数据提交后推送成功（`82f2d9f..c07ba6c`） |
| Tag | annotated `v2.5.1` → `c07ba6c` |
| Release | `id=444264325`，`draft=false` |
| 线上版本 | `index.html` → `v2.5.1`；`src/app.js` 已含 `checkedAt` 回退逻辑 |
| 线上浏览器 | `[LIVE PASS]` + `[LIVE OFFLINE PASS]`（`126-v251-live-browser.log`） |

线上页脚实测：

```
账户数据 ok · 外部行情 实时 · 宏观 ok · 汇率 6.6851 · 源数据 1.2 小时前 · 账户快照 11 分钟前
```

语义已正确：

- **账户快照 11 分钟前** = 我们最近一次成功轮询（`checkedAt`）
- **源数据 1.2 小时前** = 老应用 `data.json` 自己 `updatedAt`（你多久没在 XAU Desk 里操作）

## 6. 回退

- 单文件回退：`git checkout v2.5.0 -- scripts/sync-data.mjs src/app.js`
- 整站回退：`git checkout v2.5.0`，Pages 自动重发
- 数据兼容：`checkedAt` 是**新增字段**，v2.5.0 前端忽略它；`syncedAt` 语义未破坏

## 附：凭证索引

`124` 红灯 · `125` 绿灯 123/123 · `126` 线上 390px + 断源 · `127` 链路换代与 checkedAt 实测 · 本报告 `128`
