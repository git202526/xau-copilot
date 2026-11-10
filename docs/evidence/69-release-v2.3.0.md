# XAU Copilot v2.3.0 自动化运行报告

生成时间：2026-11-10 (GMT+8)
交付范围：**应用彻底去掉内外部双印证，只搜集外部实时行情指标做出判断，所有卡片同步更新**

---

## 0. 需求与范围界定

用户指令（本轮）：「算了，应用不要内外部双印证了，只搜集外部实时行情指标做出判断。影响到其它卡片同步更新。」

- 上一轮用户先选「只改 M2 决策卡」，随后本轮**扩大为全局**：所有卡片同步更新，不再保留双印证/内部字样残留。
- 指标范围（上一轮确认「1 和 2 都做」）：现有外部数据（现价 / MA20 偏离 / ATR14 / 日内涨跌 / DXY·10Y·VIX / 综合评级）**+ 新增** RSI14 / MACD / 布林带 / 多周期均线排列。指标一律「服务端算、写快照、前端只读」。
- **边界判断（已向用户声明）**：所有「判断/决策」逻辑改用纯外部指标；**账户事实数据保留**（真实浮亏 / 均价 / 克重 / 资金 / 多账户 / 档距数值）——这些是持仓事实而非双印证判断，删掉会毁掉最初「真实浮亏强制暴露」的核心诉求。

---

## 1. 版本自动计算（禁止硬编码）

- 实跑 `node scripts/release.mjs feature` → `latestTag: v2.2.0` → `newVersion: v2.3.0`，`unique: true`。
- 凭证：`docs/evidence/55-version-calc.log`
- `package.json` 版本 `2.2.0 → 2.3.0`（唯一改动）。

## 2. 红灯阶段（先写测试，验证失败）

范围扩大后重排红灯，新增/改写用例：

| 组 | 内容 | 条数 |
|---|---|---|
| A | `computeIndicators` 正确性与异常边界（含 A6 数学性质守卫） | 6 |
| B | `decideTechnical` 纯外部判断 + 去双印证守卫 + 5 个异常边界 | 9 |
| C | 服务端落盘 / 前端只读 / 装配 / M2 / 快照 / 同步脚本契约 | 6 |
| D | **全局零双印证**：运行时链路 + 静态文案 + 下游模块 + 解耦 | 6 |
| E | **端到端解耦**（内部趋势翻转不影响外部结论）+ 账户事实保留 + 指标缺失降级 | 3 |

凭证：
- 首轮红灯 `56-red-technical.log` / `57-red-full.log`：**20 条 → 1 pass / 19 fail**（模块未实现）。
- 全局重排红灯 `58-red-global-scope.log` / `59-red-global-full.log`：**53 条 → 37 pass / 16 fail**，失败全部收敛为「全局改造未实现」。
- 旧 `intraday.test.mjs` 的 T22/T23 源码守卫因需求变更退役，改写为 T22'/T23' 新契约（未删除、未放水，改写原因写入用例注释）；`terminal.test.mjs` 的 T5 把 FOMO 触发入参 `divergence` 改为 `techDir`，保留账户事实与历史引擎测点。

**红灯过程中查清的一处测试夹具缺陷（非实现 bug）**：A1/A2 用严格等差序列测 MACD 柱方向必然失败——等差序列趋势加速度为 0，`EMA12−EMA26` 收敛为常数、信号线追平后 `hist` 数学上必为 0。改用「前 35 根横盘 + 后 25 根带加速度趋势」的真实形态样本（hist 正确给出 ±8），并**新增 A6** 锁住「零加速度 → hist≈0」性质，防止实现被误改。此为收紧而非放宽。

## 3. 绿灯阶段（最小改动实现）

新增/改写文件：

| 文件 | 变更 |
|---|---|
| `src/core/indicators.js` | 新增：RSI14 / MACD / 布林 / 多周期均线，纯函数、脏数据清洗、异常降级 |
| `src/core/technical.js` | 新增：纯外部加权判断引擎 + BADGE + 阈值解析 |
| `scripts/sync-xau.mjs` | 落盘 `indicators`；`sameBars` 纳入指标缺失判断 |
| `scripts/recompute-indicators.mjs` | 新增：离线对现有快照重算指标（`60-recompute-indicators.log`） |
| `data/xauusd.json` | 回填真实指标：RSI 48.63 / MACD 柱 +18.01 / 均线纠缠 |
| `src/sourceB.js` | 只读透出 `snap.indicators`，不 import 计算模块 |
| `src/app.js` | 移除 `decide()`，装配 `s.technical`，外部方向下发各模块 |
| `src/render.js` | 7 卡全部改为消费 `s.technical`，账户事实卡保留 |
| `src/core/risk.js` / `grid.js` / `discipline.js` | 判断源改 `techDir` / `technical.dir` |
| `src/main.js` / `index.html` / `src/config.js` | 文案、骨架屏、Webhook、指标网格 CSS、tech* 阈值 |
| `README.md` / `CHANGELOG.md` / `package.json` | 现状描述同步重写 |

绿灯凭证：`61-green-global.log` / `62-green-full.log` → **53/53 全绿**。

## 4. 重构回归与变异验证

| 项 | 结果 | 凭证 |
|---|---|---|
| 语法检查（src/scripts/tests 全量） | 通过 | `63-smoke-syntax.log` |
| 调用链 DAG（8 叶渲染函数零互调，refreshAll 唯一入口） | 通过 | `64-callgraph.log` |
| 真实快照端到端装配 | `tech_bull / 得分 84 / 10 项指标`，浮亏 -29,546.83 元保留 | `65-e2e-real-snapshot.log` |
| **变异 1** 双印证回流（内部趋势污染 stale） | E1 被捕获 | `66-mutation-global.log` |
| **变异 2** M2 回退 `s.decision` | C3 / C4 / T22' 被捕获 | 同上 |
| **变异 3** runtime 注入双印证字样 | D1 被捕获 | 同上 |
| **变异 4** 方向阈值反转 | B1 / B2 被捕获 | 同上 |
| 还原后全量回归 | 53/53 全绿，4 文件字节级一致 | 同上 |
| 390px 真实浏览器终验 | 7 模块、M2 十格指标网格、零双印证字样、0 报错、无溢出 | `67-browser-global.log` |
| 断源降级（全 fetch reject） | 不白屏、M2 明确降级、0 JS 异常 | `68-offline-global.log` |
| PAXG 全局守卫 | 0 处 | 终查命令 |

> 浏览器验证脚本曾因断言写错（M0 是 `.bubble` 而非 `.card`，`.card` 正确值为 6）误报一次失败，已改为精确断言「6 卡 + 1 气泡 = 7 模块」后 PASS，未放宽任何应用侧检查。

## 5. 部署执行结果

（推送与 Actions 监控完成后据实回填；若失败则如实标注失败原因与补推预案，不伪造上线）

## 6. 回退预案

- 代码回退：`git revert <v2.3.0 commit>` 或 `git checkout v2.2.0`，Pages 自动重发。
- 数据兼容：`data/xauusd.json` 仅**新增** `indicators` 字段，`bars` / `spot` / `asOf` 结构未变，v2.2.0 前端读到新字段会忽略，可直接回退。
- 历史引擎保留：`src/core/confidence.js` 未删除，v2.2.0 的 `decide()` 与其测试夹具完整，可快速恢复双印证链路。
- 账户数据零改动：`normalizeA` / `rebalance` 逻辑未动，持仓事实无迁移成本。

## 7. Release Notes（摘要）

- 判断源统一为纯外部实时行情指标，全局清除内外部双印证。
- 新增 RSI14 / MACD / 布林带 / 多周期均线排列（服务端预算、前端只读）。
- 7 张卡片、晨报、网格熔断、纪律复盘、FOMO、Webhook、页脚全部同步更新。
- 账户真实浮亏等事实数据完整保留。
- TDD 53/53 绿，四次变异有效，390px 浏览器 + 断源降级均 PASS。

---

## 附：全流程凭证索引

`55` 版本计算 · `56/57` 首轮红灯 · `58/59` 全局重排红灯 · `60` 指标回填 · `61/62` 绿灯 · `63` 语法 · `64` 调用链 · `65` 端到端 · `66` 变异 · `67` 浏览器 · `68` 断源 · 本报告 `69` · 后续部署凭证 `70+`
