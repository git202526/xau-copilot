# v2.5.3 运行报告 — 发版触发的同步运行不再被判 cancelled

> 触发：v2.5.2 发布后观察到 `sync-data` 的 `push` run 被 GitHub 判为 `cancelled`，Actions 留红叉
> 版本规则：fix → `v2.5.2 → v2.5.3`
> 执行时间：2026-11-13 22:31–22:52 GMT+8

## 1. 现象

`docs/evidence/141-v252-v253-facts.log` 原样记录：

```
2026-11-13T14:44:01Z 43445534013 push              completed/success da6389d
2026-11-13T14:27:07Z 43442828955 workflow_dispatch in_progress/       805b10b
2026-11-13T14:22:00Z 43442027707 push              completed/cancelled 805b10b
2026-11-13T13:41:35Z 43435868626 push              completed/cancelled 15f4c30
2026-11-13T13:35:51Z 43435034296 workflow_dispatch completed/success  c07ba6c
```

v2.5.0 起，**每一次** push run 都是 `cancelled`。

## 2. 根因

两个独立问题叠加：

1. **`push` 没排除 `data/**`**
   工作流自己提交数据 → 又触发 `push` → 再同步 → 再提交。天然自激。
2. **`concurrency.group` 是固定值 `sync-data`**
   60 分钟的 chain run 一直占着这个组，push run 只能排 `pending`；14:27 新的 `workflow_dispatch` run 进入同组队列时，GitHub 只保留最新 pending，push run 被判 `cancelled`。

用 `gh api .../actions/runs/43442027707` 核对：`status=completed conclusion=cancelled created=14:22:00 updated=14:27:10`——正好是 chain run 结束并 dispatch 下一轮的时刻。

## 3. 改动

| 项 | 改前 | 改后 |
|---|---|---|
| push 触发范围 | 所有 main 变更 | `paths-ignore: ["data/**"]` |
| 并发组 | `group: sync-data` | `group: sync-data-${{ github.event_name }}` |
| push 轮次 | `ROUNDS=1`、不自调度 | 不变（P3 守卫） |
| chain 互斥 | 查 queued/in_progress + 排除自身 | 不变（P4 守卫） |

`push` 保留的意义：发版后**立即**用新代码同步一次，不必等下一轮 chain（最长 60 分钟）。

## 4. 红灯

`docs/evidence/137-v253-red.log`（在 `v2.5.2` 工作树上复现）

```
not ok 1 - P1 push 忽略 data/** 变更，避免数据提交自我触发
not ok 2 - P2 push 运行使用独立并发组，不被 chain run 顶掉
ok     3 - P3 push 仍保留且只跑 1 轮、不自调度
ok     4 - P4 chain 事件之间仍互斥（防双链守卫未丢）
ok     5 - P5 同步步骤仍带失败兜底，不中断链路
# tests 5 / pass 3 / fail 2
```

## 5. 绿灯

`docs/evidence/138-v253-green.log`

```
## v253 专项
# tests 5 / pass 5 / fail 0
## 全量
# tests 145 / pass 145 / fail 0
## YAML 结构
on  = ['push', 'schedule', 'workflow_dispatch']
push= {'branches': ['main'], 'paths-ignore': ['data/**']}
conc= {'group': 'sync-data-${{ github.event_name }}', 'cancel-in-progress': False}
```

## 6. 变异测试

`docs/evidence/139-v253-mutation.log`

```
[CAUGHT] M1 去掉 paths-ignore，data 提交会自我触发 → fail=1 restored=true
[CAUGHT] M2 并发组退回共用，push run 会被顶掉 → fail=1 restored=true
[MUTATION PASS]
```

## 7. 真实修复验证（关键）

不是「测试通过」，而是**同一条链路的事件类型对照**：

| 版本 | push run | 结论 |
|---|---|---|
| v2.5.2 | `43442027707` | `cancelled`（排队 5 分钟后被顶） |
| v2.5.3 | `43445534013` | **`success`** |

`docs/evidence/141-v252-v253-facts.log` 首行即该记录。

## 8. 部署执行结果

### 8.1 发布

| 项 | 值 |
|---|---|
| 提交 | `da6389d`（变基到 `9db4132` 之上） |
| Tag | `v2.5.3` → `4f3aab3c`（annotated），解引用 `da6389d` |
| 推送 | `9db4132..da6389d main -> main`；`[new tag] v2.5.3` |
| Release | `id=444349233`，`draft=false`、`prerelease=false` |

推送首次尝试 `Failed to connect to github.com port 443 after 134927 ms`，第 2 次成功；已脱敏。

### 8.2 工作流与 Pages

| run | 事件 | 结论 |
|---|---|---|
| `43445534013` | push（`da6389d`） | **success** |
| Pages（`b6f6c27`） | dynamic | success |

### 8.3 线上终验

`docs/evidence/140-v253-live-browser.log`

```
version  : v2.5.3
pills    : 美元指数DXY 103.19→ ｜ 10Y 美债TNX 5.16↑ ｜ 恐慌指数VIX 18.79→
macro-at : 数据 22:44 · 4 分钟前
width    : 390 / 390
gold-api : 未请求(OK)
errors   : 0
bad resp : 0
[LIVE PASS] 版本/金价口径/宏观中文与时刻/0报错/无溢出
[LIVE OFFLINE PASS] 不白屏 / 明确降级 / 版本号仍显示 / 0 JS 异常
```

线上版本号交叉核对：

```
index.html  id="app-ver">v2.5.3
src/version.js  export const VERSION = "2.5.3";
本地            export const VERSION = "2.5.3";
```

## 9. 遗留与边界

- 本版只改 CI 触发与并发策略，**未触碰任何业务逻辑**，页面行为与 v2.5.2 完全一致。
- `paths-ignore: data/**` 意味着纯数据提交不再触发同步——这正是 chain 的职责，链路仍在每 10 分钟运行。
- 回退：`git checkout v2.5.2` 即恢复旧并发策略（代价是 push run 继续红叉）。
