# v2.2.0 全流程自动化运行报告 · 时间维度对齐引擎

- 版本：`v2.1.0 → v2.2.0`（Feature，+0.1，脚本自动计算）
- 主题：补齐规范 §3「时间维度对齐引擎」——B1 外部日线评级 与 B2 外部盘中异动 分离判定
- 线上地址：https://git202526.github.io/xau-copilot/
- 仓库：`git202526/xau-copilot`（public）
- 生成时间：2026-11-10 GMT+8

---

## 一、版本递增（自动计算，禁止硬编码）

`node scripts/release.mjs feature` 实跑，凭证 `20-version-calc.log`：

| 项 | 值 |
|---|---|
| bump 类型 | feature（+0.1） |
| 最新 Tag | `v2.1.0` |
| package.json 旧值 | `2.1.0` |
| **新版本** | **`v2.2.0`** |
| 本地唯一性 | 通过（已知 v1.0.0 / v1.0.1 / v2.0.0 / v2.1.0） |
| 远端唯一性 | 通过（`gh api .../git/ref/tags/v2.2.0` → HTTP 404 UNIQUE，见 `31-tag-unique-check.log`） |

> 注：版本计算脚本内 `git ls-remote` 首次 ETIMEDOUT，脚本按设计降级为「仅本地 tag 校验」；
> 随后用 `gh api` 独立复核远端唯一性（404），并 `git fetch` 成功对齐，二者结论一致。

## 二、TDD 红绿证据（全部实跑，`docs/evidence/`）

| 日志 | 阶段 | 结果 |
|---|---|---|
| `21-red-intraday.log` | 红灯：新增 11 条时间对齐用例单独跑 | 5 pass / **6 fail** |
| `22-red-full.log` | 红灯：全量 | 17 pass / **6 fail**（老 12 全绿） |
| `23-green-intraday.log` | 绿灯：新增用例 | **11 / 11 pass** |
| `24-green-full.log` | 绿灯：全量 | **23 / 23 pass** |
| `25-mutation-intraday.log` | 变异：改坏 `surge === -a` → `surge === a` | 8 pass / **3 fail**（T13/T19/T21 立即失败）；还原后全量 23/23 |
| `26-smoke.log` | 语法 + 端到端装配 | 全部通过 |
| `27-callgraph.log` | 调用链单向 DAG | 8 叶渲染函数零互调 |
| `28-browser-rebound.log` | 390px 浏览器反抽场景 | **PASS**（6 卡 / 黄色警示条 / 0 error） |
| `29-offline-failsafe.log` | 断源降级 | **PASS**（7 块 / 0 JS 异常 / 不白屏） |

红灯失败的 6 条均为「时间对齐维度未实现」导致：
T13 核心反抽、T15 字段 null、T18 僵尸优先级、T21 对称场景、T22 渲染层、T23 装配层。
失败即证明测试有效，非语法错误。

### 新增用例（11 条，规范 T1 落地 + 异常边界 ≥ 6 条）

| 编号 | 场景 | 断言 |
|---|---|---|
| T13 | 规范 T1：内部日线空 + 外部日线空 + 盘中大涨 | `intraday_rebound`，含「盘中强反抽」，**绝不**判 divergence，文案无「背离」，tone=amber |
| T14 | 真背离 + 盘中大涨 | 仍是 divergence（日线冲突优先） |
| T15 | 边界：`intradayPct=null`（API 超时/缺失） | 回退日线共振，`intraday=null` |
| T16 | 向后兼容：不传 B2 | 结论与 v2.1.0 完全一致 |
| T17 | 边界：盘中 +0.3% 死区内 | 不触发反抽 |
| T18 | 边界：`stale=true` + 盘中大涨 | 僵尸数据优先，印证作废，不附盘中结论 |
| T19 | 边界：共振做空 + 盘中顺势大跌 | 不误报反抽 |
| T20 | 边界：`bMissing=true` + 盘中大涨 | 外部校验失败降级 |
| T21 | 对称：共振做多 + 盘中急跌 | 回踩预警，文案不得误用「追空」 |
| T22 | 渲染层守卫 | M2 含 `intraday_rebound` 与「盘中强反抽」分支 |
| T23 | 装配层守卫 | `app.js` 把 `B.dayPct` 喂给 `decide` |

## 三、实现清单（最小改动，向后兼容）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/core/confidence.js` | 重写 `decide()`：拆出 `INTRADAY_SURGE_PCT=1.0` 与 `intradaySurge()`；新增 `intraday_rebound` 场景；严格优先级 `degraded > risk_off > divergence > intraday_rebound > resonance > neutral`；所有分支返回 `intraday` 字段 |
| 2 | `src/config.js` | 新增 `intradaySurgePct: 1.0`（唯一可调阈值） |
| 3 | `src/app.js` | `B.dayPct` 作为 B2 盘中维度传入 `decide`；**仅实时现价可用**（`spotSource==="gold-api"`）时启用，源回退快照时不冒充 B2 |
| 4 | `src/render.js` | M0 晨报加反抽 chip 与 tail 文案；M2 中间黄色「⚠️ 盘中强反抽」标记 + amber 警示条；文案互斥不重复 |
| 5 | `index.html` | 新增 `.alert-strip.amber` 样式（复用既有组件，零外链） |
| 6 | `.gitignore` | 放行 `!docs/evidence/*.log`，保证红绿凭证可入库 |
| 7 | `tests/intraday.test.mjs` | 新增 11 条纯函数用例 |

**时间对齐关键**（规范 §3 核心）：
- 「真背离」只由【日线 aSign vs 外部日线评级 B1】比较得出，盘中价格不参与 → 消除「内部看空/外部看多」的假背离。
- 「盘中反抽」仅在【日线已共振】前提下，叠加一个反方向盘中异动（B2），是诱空/诱多预警（黄字），**不是绝对警报、不进 FOMO 锁**。
- 优先级保证：僵尸数据、外部校验失败、VIX 避险、日线真背离一律高于反抽。

## 四、回归与端到端凭证

- 全量 `node --test tests/*.test.mjs` → **23 / 23 pass**。
- 变异有效：改坏反抽方向判定后 T13/T19/T21 立即失败，还原并字节校验一致后恢复 23/23。
- 语法：`node --check` 全 `src/*.js` + `src/core/*.js` 通过。
- 调用链：8 个叶渲染函数零互调；`main.js` 唯一 `refreshAll()` → `renderAll()` 单向 DAG。
- 端到端装配（mock 五源）：`aSign=-1` / `B1=20(Sell)` / `B2 dayPct=+2.53%` → `scenario=intraday_rebound`、`headline=盘中强反抽`、`intraday.surge=1`、`risk.fomoLock=false`。
- 390px 浏览器（真实 Chromium）：6 卡全渲染、M2 黄色警示条 + 「切忌盲目追空」图标 + headline「盘中强反抽」+ `data-tone=amber`、晨报反抽 chip、`scrollWidth=390`、`PAXG=0`、**0 console error / 0 pageerror**。截图：`/workspace/xau-copilot-v2.2.0-rebound-390.png`。
- 断源降级：全部 fetch reject → 7 块内容照常渲染、降级 chip 齐备、`pageerror 0`、不白屏。

## 五、部署凭证

见下方「部署执行结果」（推送完成后回填，未伪造）。

## 六、回退预案

```bash
# 1) 回退代码到 v2.1.0（保留历史，远端 main 指回旧 tag 的 commit）
export GH_TOKEN=<PAT>
OLD=$(gh api repos/git202526/xau-copilot/git/ref/tags/v2.1.0 --jq '.object.sha')
gh api -X PATCH repos/git202526/xau-copilot/git/refs/heads/main -f sha="$OLD" -F force=true
# 2) 或按提交 revert
git revert <v2.2.0-commit> && git push origin main
```

Pages 跟随 `main` 自动重发，链接不变；`data/` 由 sync-data 独立维护，回退代码不影响云端快照。

## 七、Release Notes（v2.2.0）

**新增**
- 时间维度对齐引擎：把内部日线基准、外部日线评级(B1)、外部盘中异动(B2) 拆成独立维度，根治「内部看空 / 外部看多」的周期错配假背离。
- 「盘中强反抽」预警：日线共振但盘中反向急拉时，M2 出黄色警示「防范日线假突破，切忌盲目追空」，M0 晨报同步提示，不触发绝对警报/FOMO。
- 反向对称支持：共振做多 + 盘中急跌 → 「盘中急回踩」预警，话术自动切换为「切忌盲目追多」。
- 阈值可配 `intradaySurgePct`（默认 1.0%），死区内异动视为噪声不误报。

**风控不变**
- 僵尸数据、外部校验失败、VIX 避险、日线真背离一律优先于反抽判定。
- 反抽不进 FOMO 锁、不判纪律扣分（按规范「不触发绝对警报」）。
- 真实浮亏、资金枯竭、网格熔断、单位隔离、PAXG 全局禁用保持不变。

**工程**
- 新增 11 条用例（含 6 条异常边界），全套 23/23 绿；变异测试有效。
- 红绿/回归/浏览器/断源凭证全部入库；`.gitignore` 放行 evidence 日志。

**已知限制**
- B2 盘中异动依赖实时现价源（gold-api）；实时源不可用回退快照时，不判定反抽（避免用日内噪声冒充盘中急拉），此属有意降级。
- 技术评级为服务端预算（MA/RSI/MACD/Stoch/CCI/W%R 加权投票），非第三方付费评级 API；Yahoo `GC=F` 直连 429/无 CORS，TradingView/Alpha Vantage 无可用免鉴权 CORS 通道。

---

## 部署执行结果

（推送与 Actions 监控完成后，据实回填；若失败则如实标注失败原因与补推预案，不伪造上线）
