# 部署与线上验证凭证（v1.0.1）

> 全部为实际执行结果，非示意。

## 1. 仓库与页面

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/git202526/xau-copilot （public） |
| 线上地址 | https://git202526.github.io/xau-copilot/ |
| Pages | source = main /（branch 部署），构建 status=success |
| 首版提交 | `25d5f58 feat(v1.0.0): XAU Copilot 多源印证决策台` |
| 标签 | `v1.0.0` / `v1.0.1` |

## 2. 数据上云验证（Actions 实跑）

- 手动触发 `sync-data`，run `42616698394`：**completed success**
- 日志关键行：
  ```
  [main a0b7964] chore(data): sync snapshot 2026-11-09T12:24Z
   To https://github.com/git202526/xau-copilot
     25d5f58..a0b7964  main -> main
  ```
- 同步产物校验：`data/live.json` 46 个字段，`TOTAL=330`、`buys=3`、`sells=1`、`accounts=3`、`updatedAt=1794223899292` —— 与私有库 `xau-desk-data/data.json` 一致（diff 仅为缩进格式化）。

## 3. 线上端到端（Playwright，390×844）

```
STATUS: 数据快照 11-09 20:16 | GitHub 同步 11-09 20:24 | 行情源 Binance PAXG | 汇率 6.6798
BRIEF : 晚上好。内部系统显示日线处于下行（内部置信 31），但外部独立校验价格 870.08 元/克，
        已站上 MA20（863.29）。多源出现分歧（置信度：低）。多源不一致时不加仓...
BADGE : 置信度 低
CARDS : 6   scrollWidth=390 / innerWidth=390（无横向溢出）
ERRS  : []（无 pageerror、无 console error）
```

- 真实数据下引擎判定 `divergence_trap_up`：内部 `feed` 最近一条 `dir` 为「日线 下行」（sign=-1），
  外部 PAXG 收盘价折人民币 870.08 > MA20 863.29（trend=+1）→ **多源背离，置信度低**，
  正是「不盲信老应用」要抓的场景。
- 断网演练（拦截全部外部请求 + data 请求）：气泡显示「源数据异常，已降级处理」，6 张卡片仍渲染，
  `body.scrollHeight=1439`，无 JS 异常。

## 4. 回退预案（已演练路径）

```bash
git revert <sync-commit>            # 数据回滚，Pages 随 main 自动重发
git checkout v1.0.0 -- .            # 代码回滚到首版
git push origin v1.0.0^{commit}:main
```
