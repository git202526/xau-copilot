# v2.1.0 全流程自动化运行报告

- 生成时间：2026-11-09 23:47 GMT+8
- 线上地址：https://git202526.github.io/xau-copilot/
- 仓库：`git202526/xau-copilot`（public）
- 发布提交：`a81526f573834094349cde5a06206070ac593ca2`
- Release：https://github.com/git202526/xau-copilot/releases/tag/v2.1.0

---

## 一、版本递增（自动计算，禁止硬编码）

由 `scripts/release.mjs` 读 Git 最新 Tag 后计算，日志见 `18-version-calc.log`：

| 项 | 值 |
|---|---|
| bump 类型 | feature（+0.1） |
| 最新 Tag | `v2.0.0` |
| package.json 旧值 | `2.0.0` |
| **新版本** | **`v2.1.0`** |
| 本地唯一性 | 通过（已知 v1.0.0 / v1.0.1 / v2.0.0） |
| 远端唯一性 | 通过（`gh api .../git/ref/tags/v2.1.0` → 404，UNIQUE） |

> `git ls-remote` 走 HTTPS 在本环境 ETIMEDOUT，远端校验改用 `gh api`，结果已追加进日志。

## 二、TDD 红绿证据（全部实跑，`docs/evidence/`）

| 日志 | 阶段 | 结果 |
|---|---|---|
| `10-red-terminal.log` | 初始红灯 | 5 个核心模块 `ERR_MODULE_NOT_FOUND` |
| `11-red-hardening.log` | 加固红灯 T9–T11 | 8 pass / **3 fail** |
| `12-green-terminal.log` | 首次绿灯 | **11 / 11 pass** |
| `13-mutation-hardening.log` | 变异（改坏 confidence + rebalance） | 9 pass / **2 fail**（T9、T10 立即失败） |
| `14-regression.log` | 还原回归 | **11 / 11 pass** |
| `15-red-freshness.log` | 新鲜度红灯 T12 | 11 pass / **1 fail** |
| `16-green-final.log` | 最终绿灯 | **12 / 12 pass** |
| 变异复验（T12） | 改坏 sourceB 的 ts 口径 | 11 pass / **1 fail** |
| `17-regression-final.log` | 最终回归 | **12 / 12 pass** |

用例覆盖（12 条）：T1 持仓缺失、T2 僵尸数据、T3 国内休市冻结溢价、T4 真实浮亏原样透出、T5 背离+FOMO 锁、T6 资金枯竭、T7 VIX 极值避险、T8 全库 PAXG 守卫、T9 僵尸废弃印证、T10 单一均价数据源、T11 定时器清理、T12 新鲜度口径。异常/边界用例 ≥ 9 条。

## 三、本轮续作修复清单

| # | 问题 | 修复 |
|---|---|---|
| 1 | 同页出现两个「整体均价」（M3 `972.01` / M5 `972.05`） | 再平衡统一取 `A.position.avgCost`，消除账户四舍五入二次加权（T10） |
| 2 | 僵尸数据仍照常输出方向结论 | `decide` 最优先判 `stale` → 「印证作废」，不输出方向（T9） |
| 3 | `pagehide` 未清理定时器 | 卸载钩子清理 `ui.timer` / `ui.countdown`；Webhook 超时器移入 `finally`（T11） |
| 4 | ISO 时间串被 `Number()` 解析成 `null`，`ts=null` 被误判僵尸 | 新增 `parseTs`；新鲜度锚点改为「本次实时现价抓取时刻」，实时挂掉回退旧快照才判僵尸（T12） |
| 5 | 降级文案把「结构陈旧」与「印证作废」混为一谈 | 分离为 `结构数据陈旧`（源 A，仅供参考）与 `外部僵尸 · 印证作废`（源 B，结论作废） |
| 6 | 15 分钟定时任务从未触发（`syncedAt` 停在 12:24Z） | 去掉 `push.paths` 限制，发版即触发同步；本次 push 已实测自动触发并成功 |

## 四、回归与端到端凭证（本地）

- `node --test tests/terminal.test.mjs` → **12 / 12 pass**，`PAXG` 全局 grep 仅命中测试守卫自身。
- 390px：6 张卡全渲染、`scrollWidth=390`、页面高 1827px、`console error 0`。
- 1280px 桌面：`scrollWidth=1280`、6 卡，无溢出。
- 断网演练：拦截全部 `/data/` 与外部请求 → 晨报显示「源异常」+ 降级 chips，6 卡照常渲染，`pageerror 0`，不白屏。
- 均价一致性：`972.01` 同时出现在 M3/M5，`972.05` 已消失。

## 五、部署凭证

| 环节 | 凭证 |
|---|---|
| 本地提交 | `a81526f feat(v2.1.0): 终极重构 …`（50 文件，+4153 / −1652） |
| 本地 tag | `v2.1.0`（annotated） |
| git push | tag 推送成功；`main` 因远端分叉被拒（fetch first） |
| 远端对齐 | `gh api -X PATCH .../git/refs/heads/main -f sha=a81526f… -F force=true` → 成功 |
| 一致性 | 远端 `main = a81526f`，tag `v2.1.0` 的 annotated object → `a81526f` |
| 关键文件 | index.html / src/core/rating.js / src/sourceC.js / data/rating.json / data/macro.json / scripts/release.mjs / tests/terminal.test.mjs 全部存在 |
| Release | `v2.1.0` 已创建（含变更、验证凭证、回退命令） |
| 数据同步 | run **42646879445** `sync-data event=push completed success`；日志 `[macro] DXY 102.205 / 10Y 4.84% / VIX 25.64`；产出 `5558c6f chore(data): sync snapshot 2026-11-09T15:39Z`（4 files） |
| 数据新鲜度 | `data/meta.json syncedAt = 2026-11-09T15:39:43.301Z`（由 12:24Z 刷新为当前） |
| 循环收敛 | Actions 用 GITHUB_TOKEN 的 push 未再产生新的 sync run，无自循环 |
| Pages | run **42646923097** `completed success`；线上 `src/render.js` = 17547 bytes，与本地字节级一致 |

## 六、线上终验（390px，真实数据）

| 模块 | 实测输出 |
|---|---|
| M0 晨报 | 「内部日线下行，但外部站上 MA20（4,066.96）；宏观方向分歧。多源背离，建议暂停建仓。」+ 置信低 |
| M1 雷达 | `DXY 102.21↑` / `TNX 4.84↓` / `VIX 25.64↓`；国际 `XAUUSD 4,119.00 $/oz` Buy；国内 `884.60 元/克` 下行 置信31；溢价率 `-0.65%` |
| M2 决策 | `多源背离`、置信低徽章、内部 ↓空头 × 外部 ↑多头 |
| M3 账户 | 真实浮亏 **-28,660.59 元**（红色大字）、收益率 -8.99%、均价 972.01、再跌5% -1.45万、可用 0.19万、资金枯竭「仅够 0.11 档」 |
| M5 再平衡 | 建行 988.21 减仓 / 民生 949.73 补仓，整体均价 972.01（单一数字） |
| M6 纪律 | 纪律良好（今日卖出 1.00g @878.87） |
| 页脚 | `A 结构 ok · B 行情 实时 · C 宏观 ok · 汇率 6.6798 · 数据 68 分钟前 · 云端同步 7 分钟前` |
| 全局 | 6 卡、`scrollWidth=390`、`PAXG=0`、`console error 0` |

线上页脚「云端同步 7 分钟前」证明数据管道已恢复；僵尸标签消失，因为同步新鲜。

## 七、回退预案

```bash
# 1) 回退代码到 v2.0.0（远端 main 强制指向旧 tag 的 commit）
export GH_TOKEN=<PAT>
OLD=$(gh api repos/git202526/xau-copilot/git/ref/tags/v2.0.0 --jq '.object.sha')
gh api -X PATCH repos/git202526/xau-copilot/git/refs/heads/main -f sha="$OLD" -F force=true

# 2) 或按提交 revert（保留历史）
git revert a81526f && git push origin main
```

Pages 跟随 `main` 自动重发，链接不变；`data/` 由 sync-data 独立维护，回退代码不影响云端快照。

## 八、已知限制

- **技术评级为服务端预算**（`src/core/rating.js` 的 MA/RSI/MACD/Stoch/CCI/W%R 加权投票），UI 已标注来源，非第三方付费评级 API；免鉴权且带 CORS 的 TradingView / Alpha Vantage 通道实测不可用。
- **老应用数据** `updatedAt` 是用户手动记账时间，天然不会 15 分钟一变；页面用 `meta.syncedAt`（云端管道）判定新鲜度，页脚同时展示两个时间以避免混淆。
- **GC=F / XAUUSD 现价**：gold-api 提供实时价，日线来自新浪 XAU（伦敦金现）快照；前端不自行计算 MACD。
- **数据同步**：依赖 GitHub Actions `schedule`（`*/15`）与 push 触发；GitHub 对公开仓库的 schedule 可能延迟，故额外加了「发版即同步」与前端同步时间可见性作为双保险。
- **持仓金额公开**：仓库与页面均为 public，底部有免责声明；用户已确认按「模拟数据」处理。
