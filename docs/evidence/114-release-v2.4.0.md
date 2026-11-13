# XAU Copilot v2.4.0 自动化运行报告

生成时间：2026-11-13 (GMT+8)
交付范围：**7 项用户反馈（中文化 / 档位克重 / 剩余可买口径 / 数据新鲜度 / 顶部版本号）**

---

## 0. 需求与范围

用户指令（本轮）：

> 1.dxy tnk vix加中文。2.技术评级结果加中文。3.网络效率与熔断。4.档位读取加克重。5.剩余可买我已经提高持仓上限，估算不准。6.账户数据陈旧，读取数据数据不及时。7.顶部添加版本号。

逐项落地：

| # | 反馈 | 根因 / 处置 | 结果 |
|---|---|---|---|
| 1 | DXY/TNX/VIX 加中文 | `macro.js` 早有 `label` 中文字段，`render.js` 只渲染了英文 `key` | M1 显示「美元指数 DXY / 10Y 美债 TNX / 恐慌指数 VIX」 |
| 2 | 技术评级加中文 | `rating.json` 输出 `Strong Buy…Strong Sell` 英文；新增 `src/core/labels.js` 统一映射 | M0/M1/M2 全部显示「强烈买入…强烈卖出」 |
| 3 | 网格效率与熔断 | 「档距 / 高点」信息不完整，缺效率比 | 升级为「ATR / 档距 51% · 6 档 · 高点 $4696」 |
| 4 | 档位读取加克重 | `plan.levels[].grams` 已算出但渲染层未用 | 档位柱 title 带克重，新增「下一档 第 5 档 $3,275.9 · 40.0 克」 |
| 5 | 剩余可买估算不准 | `calcPlan` 按 `planBudget` 扣「未标记档位流水」，实测 `gear` 全为 `null`，`budget` 被扣成 0 | 改为 `MAX(0, TOTAL − 克重)`；真实快照 **0.00 → 72.12 克** |
| 6 | 账户数据陈旧 | GitHub scheduled workflow 实际间隔 4–8 小时（非配置错误） | 阈值分离 + 页脚分级 + cron `*/5`；根治方案见 `docs/data-freshness.md` |
| 7 | 顶部加版本号 | 无版本展示、版本号易漂移 | 顶栏显示 `v2.4.0`，单一来源 `src/version.js` 由发版脚本写入 |

**边界**：不改判断引擎逻辑、不改 `data/*` 结构、不改账户事实计算口径；继续遵守零双印证、禁用 PAXG、只做 XAUUSD、绝不白屏。

---

## 1. 版本自动计算（禁止硬编码）

- 实跑 `node scripts/release.mjs feature`：`latestTag: v2.3.1` → `newVersion: v2.4.0`，`unique: true`（本地 7 / 远端 14 个 tag）。
- 同步写入 `package.json`（`2.3.1 → 2.4.0`）与 `src/version.js`（新增，版本号单一来源）。
- P0 基线：红灯前全量 **80/80**、语法 OK、线上 `index.html http=200`。
- 凭证：`docs/evidence/107-v240-p0.log`、`108-v240-version.log`。

## 2. 红灯阶段

新增 `tests/v240.test.mjs` 28 条（A 中文 / B 档位克重 / C 剩余可买 / D 新鲜度 / E 版本号 / F 回归守卫 / G 网格效率）。

| 轮次 | 结果 | 凭证 |
|---|---|---|
| v240 单跑 | 28 条 → **10 pass / 18 fail** | `109-v240-red.log` |
| 全量 | 108 条 → **90 pass / 18 fail**（旧 80 条全绿） | `109` |

失败全部收敛为「功能未实现」，无环境性伪失败。

## 3. 绿灯阶段

| 文件 | 变更 |
|---|---|
| `src/core/labels.js` | 新增：评级 / 宏观中文映射（`ratingZh` / `ratingZhEn` / `macroZh`） |
| `src/version.js` | 新增：版本号单一来源 |
| `src/render.js` | M1 双语 pill、M0/M1 评级中文、M3 上限口径、M4 档位克重与下一档、页脚小时分级 |
| `src/core/technical.js` | 技术评级 signal 走中文映射 |
| `src/core/normalize.js` | `calcPlan` 改为 `MAX(0, TOTAL − grams)`；新增 `capGrams / unmarkedGrams / overCap` |
| `src/core/risk.js` | 额度文案改「按持仓上限」，新增 `capGrams / overCap / unmarkedGrams` |
| `src/config.js` | 新增 `accountStaleMinutes = 360` |
| `src/app.js` | 账户陈旧判定改用 `accountStaleMinutes` |
| `src/main.js` | 注入 `VERSION` 到 `#app-ver` |
| `index.html` | 顶栏版本号 + `.ver` / `.pill .k em` / `.lv-next` 样式 |
| `.github/workflows/sync-data.yml` | cron `*/15` → `*/5` |
| `scripts/release.mjs` | 发版时同步写 `src/version.js` |
| `README.md` / `CHANGELOG.md` / `docs/data-freshness.md` | 口径、用例数、新鲜度方案同步 |

批量替换脚本 `apply-green-v240` 共 10 条，逐条校验 `from` 恰好命中 1 次，`10/10` 成功。

**旧用例同步（口径变更，非放宽）**：

- `colors.test.mjs` C4 的 `/预算估算/` → `/持仓上限/`（`非账户余额`、`可用资金 0 处` 断言保留）；
- `terminal.test.mjs` T6 的 `/预算额度/` → `/额度不足|剩余可买/`（`depleted=true`、`amber` 断言保留）。

凭证：`110-v240-green.log` → **108/108 全绿**，语法 OK。

## 4. 回归、变异与端到端

| 项 | 结果 | 凭证 |
|---|---|---|
| 全量回归 | **108/108** | `110` / `112` |
| 调用链 DAG | 10 个渲染函数互调违规 **0**；`renderAll` 仅被 `refreshAll` 调用 1 次 | `111` |
| 真实快照 E2E | 剩余可买 **72.1152 克**（上限 400）、`overCap=false`、档位克重 `20/20/120/200/40/0`、评级「强烈卖出 11」、宏观全中文、版本 2.4.0 | `111` |
| 变异 M1 | 剩余可买退回扣减未标记流水 → C1 捕获 | `112` |
| 变异 M2 | 评级回退英文 label → A5 捕获 | `112` |
| 变异 M3 | cron 退回 15 分钟 → D5 捕获 | `112` |
| 变异 M4 | 页脚丢弃小时分级 → D4 捕获 | `112` |
| 变异还原 | 4 次全部 `[CAUGHT]` 且 `restored=true`，字节级一致 | `112` |
| 390px 浏览器 | 版本号 `v2.4.0`；pills 三中文；评级「强烈卖出 11」；M4「51% · 6 档」「下一档 … 40.0 克」；M3 72.12 克；配色合规；6 卡+1 气泡=7 模块；0 报错、0 个 4xx、`scrollWidth=390` | `113` |
| 断源降级 | 不白屏、M2 明确降级、版本号仍显示、0 JS 异常、无双印证 | `113` |
| 视觉确认 | 截图逐项核对，无溢出/重叠 | `/workspace/xau-copilot-v2.4.0-390.png` |

## 5. 部署执行结果

> 本节在报告生成时刻为**占位**：Tag / 推送 / Release / Actions / 线上终验尚未执行。上线后据实回填并补齐 `115+` 凭证。**未执行即不填写结果。**

**状态：部署执行中（报告生成时刻 2026-11-13 14:30 GMT+8）。**

## 6. 回退预案

- 代码回退：`git revert <v2.4.0 功能提交>` 或 `git checkout v2.3.1`，Pages 自动重发。
- 数据兼容：本版未改 `data/*` 结构；`src/version.js` 为新增文件；`plan` 新增字段为只增不改，v2.3.1 前端可忽略。
- 口径回退：剩余可买恢复旧算法只需还原 `calcPlan` 中 `budget` 扣减逻辑（不建议，旧算法实测恒为 0）。
- 账户数据零改动：`normalizeA` 的均价/克重口径未变。

## 7. Release Notes（摘要）

- 宏观指标与外部技术评级全面中文化，保留英文缩写。
- 网格档位补充每档克重与「下一档」摘要，新增 ATR / 档距效率比。
- 剩余可买改按持仓上限计算，真实快照由 0.00 修正为 72.12 克。
- 账户快照新鲜度分级显示，同步 cron 提升到每 5 分钟，附根治方案文档。
- 顶栏显示版本号，版本单一来源自动同步。
- TDD 108/108，4 次变异全捕获，390px 浏览器 + 断源降级 PASS。

---

## 附：全流程凭证索引

`107` P0 基线 · `108` 版本计算 · `109` 红灯 · `110` 绿灯 108/108 · `111` 调用链 + 真实快照 E2E · `112` 变异测试 · `113` 390px 浏览器 + 断源 · 本报告 `114` · 部署阶段 `115+` 待回填
