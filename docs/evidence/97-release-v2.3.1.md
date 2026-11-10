# XAU Copilot v2.3.1 自动化运行报告

生成时间：2026-11-10 (GMT+8)
交付范围：**配色语义分层（红绿只表数值涨跌）+ 账户数据口径修正（老应用无资金/余额字段）**

---

## 0. 需求与范围界定

用户指令（本轮）：「我的xau desk 应用没有剩余资金，数据从哪来的？浮亏不应该用红色，应该红涨绿跌。外部技术面偏多也不应用绿色。偏多偏少其它判断应该用红绿以外的颜色」

### 0.1 数据核查结论（先查事实，再改代码）

- 核查 `data/live.json` / `data/meta.json`：老应用快照（`source: git202526/xau-desk-data/data.json`，`syncedAt: 2026-11-10T01:18:23.083Z`，`bytes: 19535`，`trades: 4`）顶层键为 `H_BASE, TOTAL, GRAMS, COST, gearsDone, takesDone, buys, sells, …, accounts, acctLast, …, noCap` 等网格计划参数，**没有任何资金 / 余额 / 可用 / cash / fund / balance / capital / reserve / remain 字段**；`accounts` 也只有名称与颜色元数据，无余额。
- 页面原「可用资金 xx 万」「资金枯竭」并非账户真实余额，而是 `src/core/normalize.js` 的 `calcPlan()` 由 `TOTAL`（预算总克重）、已持克重与现价推算出的**预算额度派生估算量**：`(TOTAL − 已持克重) × 现价 ÷ 10000`。
- 结论：把该估算量冒充账户余额属于口径错误。本版改称「剩余可买（预算估算）」（单位：克），并在 M3 明确标注「非账户余额」；告警改「预算额度不足（估算）」。真实浮亏、均价、克重、多账户、网格档距来自 Source A 的账户事实，继续保留。

### 0.2 配色规范（语义分层）

| 语义类别 | 具体场景 | 颜色 |
|---|---|---|
| 数值涨跌 | 涨 / 正（浮盈、收益率、溢价、日内涨、MA20 正偏离、MACD 柱为正） | 红 `var(--red)` `#FF5D52` |
| 数值涨跌 | 跌 / 负（浮亏、收益率负、压力测试再跌 5%、溢价负、日内跌） | 绿 `var(--green)` `#3FD68C` |
| 方向判断 | 偏多 `tech_bull` | 琥珀 `amber` `#F5A623` |
| 方向判断 | 偏空 `tech_bear` | 靛蓝 `indigo` `#8B93F8` |
| 状态 | 避险 `risk_off` | 紫 `violet` `#A78BFA` |
| 状态 | 中性 / 降级 / 不可用 | 灰 `gray` `#6B7280` |

- **红绿只表数值涨跌，且严格红涨绿跌**（国内习惯）。方向判断与状态类一律禁用红绿。
- M2 指标网格按 `signals[].kind` 分层：`change`（`ma20 / day / macd`）→ `.chg-up/.chg-dn` 红绿；`judge`（`rsi / boll / align / rating / macro`）→ `.bull/.bear` 琥珀 / 靛蓝；`neutral`（`price / atr`）→ 灰。
- 覆盖 M2 结论、置信徽章、评级信号、宏观 pill、状态色条、告警条、网格熔断、纪律复盘、FOMO 弹窗、页脚等全站判断类展示。

### 0.3 边界

- 本版只改**展示层配色**与**数据口径文案**，不改判断引擎的判定逻辑、不改 `data/*` 结构、不改账户事实计算。
- 继续遵守：零侵入老应用、禁用 PAXG、只做伦敦金 XAUUSD、运行时零双印证、任一源失败显示「源数据异常，降级处理」且不白屏。

---

## 1. 版本自动计算（禁止硬编码）

- 实跑 `node scripts/release.mjs fix` → `latestTag: "v2.3.0"`、`oldPackageVersion: "2.3.0"`、`newVersion: "v2.3.1"`、`unique: true`（校验本地 6 个 tag + 远端 12 个 ref）。
- `package.json`：`2.3.0 → 2.3.1`（由脚本写入，唯一改动）。
- P0 基线：红灯前全量 **53/53 全绿**、线上 `index.html http=200`。
- 凭证：`docs/evidence/88-version-calc.log`。

## 2. 红灯阶段（先写测试，验证失败）

新增 `tests/colors.test.mjs`（最终 27 条，A–E 组，含 6 个异常边界用例），并改写 `tests/terminal.test.mjs` 的 T5 / T6。

| 组 | 内容 | 关键断言 |
|---|---|---|
| A | 数值涨跌红涨绿跌 | A1 浮亏必须绿不得红、A2 浮盈必须红不得绿、A4 收益率/压力测试/溢价、A6 `buildSignals` 标注 `kind` |
| B | 判断 / 状态类禁用红绿 | B1 偏多不得绿、B2 偏空不得红、B3 降级/避险/指标缺失/中性、B4 徽章、B5 额度告警、B6 熔断、B7 纪律、B8 CSS、B9 文案、B10 tone 收敛、**B11 脏流水异常边界** |
| C | 数据口径事实 | C1 老应用快照顶层无资金/余额字段、C2 `assess` 暴露 `remainingGrams`、C3 不得再宣称「资金枯竭」、C4 M3 不得出现「可用资金」且标注非账户余额 |
| D | 端到端 | D3 浮亏绿 + 偏多非绿 + 额度中性可同时成立 |
| E | CSS 语义 | E1 注释不得混用「判断」与「涨跌红绿」、E2 网格按 `kind` 分层 |

凭证：

- 首轮红灯 `89-red-colors.log`：`colors.test.mjs` 26 条 → **5 pass / 21 fail**；全量 79 条 → **58 pass / 21 fail**（旧 53 条仍全绿，失败全部收敛为「配色规范与口径修正未实现」）。
- 绿灯批量替换后 `90-green-colors.log`：53 条唯一性替换全部命中（逐条校验 `from` 在目标文件恰好出现 1 次），语法 OK，但全量 79 条 → **78 pass / 1 fail**，B7 暴露真实缺陷。
- 补充红灯 `91-red-dirty-actions.log`：B7 的失败根因是 `discipline.js` 对缺 `gram / priceCny` 的脏 BUY 流水调用 `.toFixed()` 抛 `TypeError: Cannot read properties of undefined (reading 'toFixed')`。先补 B11 异常边界红灯（27 条 → 26 pass / 1 fail）捕获真实异常，**不放宽任何断言**。

## 3. 绿灯阶段（最小改动实现）

`apply-green-v231.mjs` 对 9 个文件做 53 条唯一性替换，随后针对 B11 补一处防御：

| 文件 | 变更 |
|---|---|
| `src/core/risk.js` | `pnlTone = pnl < 0 ? "green" : pnl > 0 ? "red" : "gray"`；额度文案改「预算额度不足（估算）」并改用 `amber`；暴露 `remainingGrams`、保留 `remainingFunds` 兼容；文档注明 Source A 无资金字段 |
| `src/core/technical.js` | `buildSignals()` 增加 `kind`（`change` / `judge` / `neutral`）；`tech_bull` tone `amber`、`tech_bear` tone `indigo`；文档同步 |
| `src/core/grid.js` | 熔断 tone `red → amber` |
| `src/core/discipline.js` | 违规 tone 改中性；新增 `n()` / `g()` 防御，脏流水缺字段显示 `--`、`buyGrams` 求和用 `n(x.gram) \|\| 0`，守住「绝不白屏」 |
| `src/core/normalize.js` | 文档口径修正：`TOTAL` 是预算总克重不是资金，额度为计划参数派生量、非账户余额 |
| `src/render.js` | M2 按 `kind` 分层取色；M3 改「剩余可买（预算估算）」+ `src-note` 标注「非账户余额」，收益率/压力测试红涨绿跌；M4/M6 告警条 `warn/calm/violet/gray` |
| `index.html` | 新增 `--indigo`、`.chg-up/.chg-dn/.bull/.bear`、`.alert-strip.warn/calm/violet/gray`，移除判断类红绿 CSS |
| `tests/terminal.test.mjs` | T5 断言浮亏 `pnlTone === "green"`；T6 断言琥珀预算告警 |
| `README.md` | 数据口径、剩余额度（派生估算）、用例数同步 |

凭证：

- `90-green-colors.log`：53 条替换全部 `[OK]`，`replacements=53 files=9`。
- `92-green-full.log`：B11 防御落地后全量 **80/80 全绿**，全局红绿引用只剩数值类合法位置。
- `96-preflight.log`（发版前复核）：`80/80`、`SYNTAX OK`、`README` 用例数 `80`、运行时零双印证守卫 `(none)`。

## 4. 重构回归与变异验证

| 项 | 结果 | 凭证 |
|---|---|---|
| 全量语法检查（src / core / scripts / tests） | 通过 | `90` / `92` / `96` |
| 调用链 DAG（10 个渲染函数零互调，`refreshAll` 唯一入口） | 互调违规 **0** | `93-e2e-callgraph.log` |
| 真实快照端到端装配 | `tech_bull / tone amber / score 100 / 10 signals`；`pnl -27,680.74 / pnlTone green / remainingGrams 2.1152 / depletedTone amber / 预算额度不足（估算）`；10 项 `signals` 全带 `kind` | `93` |
| **变异 M1** 浮亏翻回红 | A1 / A2 / D3 捕获 | `94-mutation.log` |
| **变异 M2** 偏多翻回绿 | B1 / B3 / B10 / D3 捕获 | `94` |
| **变异 M3** M3 文案改回「可用资金」 | B9 / C4 捕获 | `94` |
| **变异 M4** 判断类 CSS 回流绿色 | B8 捕获 | `94` |
| 变异还原 | 4 次全部 `[CAUGHT]` 且 `restored=true`，4 个文件字节级还原，还原后 80/80 | `94` |
| 390px 真实浏览器配色终验 | 浮亏 `rgb(63,214,140)` 绿、M2 偏多 `rgb(245,166,35)` 琥珀、`judgeAllNeutral=true`、`chgAllRedGreen=true`、`toneHasRedGreen=false`、`stripHasRedGreen=false`、`hasBudgetNote=true`、`noFakeFunds=true`、`scrollWidth=390`、0 console error、0 个 4xx | `95-browser-offline.log` |
| 断源降级（全部 fetch reject） | 不白屏、M2 明确降级、0 JS 异常、无双印证残留 | `95` |
| 发版前基线复核 | 80/80、README `80 条用例`、运行时零双印证 | `96` |

> **如实记录的工具层勘误（非应用缺陷）**：E2E 脚本把 `s.grid.tone / s.disc.tone / s.rebal.tone` 误写成 `s.gridTone / s.discTone / s.rebalTone`，逐项检查全 true 但结论链引用旧字段导致误报 FAIL；`93` 完整保留了两次勘误补跑过程，第三次清理残留 `&&` 条件链后 `[E2E PASS]`，应用代码未改动、断言未放宽。
>
> **如实记录的凭证标签**：`95` 中断源降级段落标题沿用 v2.3.0 脚本标签，实际执行对象为 v2.3.1 构建产物（输出含 v2.3.1 配色语义终验结果），未影响结论。

## 5. 部署执行结果

> 本节在报告生成时刻为**占位**：Tag / 推送 / Release / Actions / 线上资源与浏览器终验尚未执行。按与 `69-release-v2.3.0.md` 相同的流程，上线后将据实回填本节并补齐 `98+` 凭证索引。**未执行即不填写结果，不伪造任何步骤。**

**状态：部署执行中（报告生成时刻 2026-11-10 13:02 GMT+8）。**

## 6. 回退预案

- 代码回退：`git revert <v2.3.1 功能提交>` 或 `git checkout v2.3.0`，Pages 自动重发。
- 数据兼容：本版**未改动** `data/live.json` / `data/xauusd.json` / `data/macro.json` / `data/meta.json` 的结构，仅改展示层与判断 tone，v2.3.0 前端可直接回退，无数据迁移成本。
- 配色回退：改动全部集中在 CSS 变量、`.chg-*/ .bull / .bear` 类名与 `tone` 取值，属纯展示层，无持久化数据。
- 账户数据零改动：`normalizeA` 的计算逻辑未动，仅修正文档口径；持仓事实无迁移成本。

## 7. Release Notes（摘要）

- **红绿只表数值涨跌（红涨绿跌）**：浮亏由红改绿、浮盈由绿改红；收益率、压力测试「再跌 5%」、国内溢价、日内涨跌、MA20 偏离、MACD 柱同步。
- **方向判断 / 状态类禁用红绿**：偏多琥珀、偏空靛蓝、避险紫、中性 / 降级灰；覆盖 M2 结论、指标网格、置信徽章、评级、宏观 pill、状态色条、告警条、熔断、纪律、FOMO 弹窗。
- **数据口径修正**：老应用无资金 / 余额字段；M3 改「剩余可买（预算估算）」并标注「非账户余额」，告警改「预算额度不足（估算）」。
- **健壮性**：`discipline.js` 对缺 `gram / priceCny` 的脏流水防御，守住「绝不白屏」。
- **TDD**：新增 `tests/colors.test.mjs` 27 条（含 6 个异常边界），全套 **80/80 绿**；红灯 21 条失败 + B11 真实 TypeError；4 次变异全部捕获且字节级还原；390px 浏览器计算样式终验 + 断源降级均 PASS。

---

## 附：全流程凭证索引

`88` 版本计算与 P0 基线 · `89` 首轮红灯 · `90` 绿灯 53 条替换 · `91` B11 补充红灯 · `92` 绿灯收口 80/80 · `93` 调用链 DAG + E2E · `94` 变异测试 · `95` 390px 浏览器 + 断源 · `96` 发版前基线复核 · 本报告 `97` · 部署阶段 `98+` 待回填
