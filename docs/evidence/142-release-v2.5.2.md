# v2.5.2 运行报告 — 金价口径与宏观时效

> 触发：用户反馈「金价获取和别的行情软件差太多」「10Y 和美元指数为什么截止 11.11，今天都 13 号了，为什么不能自动更新」
> 版本规则：fix → `v2.5.1 → v2.5.2`
> 执行时间：2026-11-13 21:53–22:30 GMT+8

## 1. 问题定位

### 1.1 金价差太多

| 项 | 事实 |
|---|---|
| 前端现价源 | `https://api.gold-api.com/price/XAU`（`src/config.js: xauSpotUrl`） |
| 同时刻偏差（21:53–21:58 连测三次） | sina 3880.18 / 3880.98 / 3881.13；gold-api 3885.77 / 3884.17 / 3889.72 → **高 3.2~8.6 且跳动** |
| 快照错值 | `data/xauusd.json` 曾写 `spot=3909.22`（13:35Z），而当时新浪约 3880 |
| 用户对照物 | XAU Desk 截图 `3894.35 / 昨收 3876.49 / 今开 3877.82 / 高 3923.22 / 低 3874.89` |
| 与新浪 `hf_XAU` 对照 | `3882.48,3877.430,3882.48,3882.83,3922.99,3872.91,21:53:00,3877.43,3877.21,...,2026-11-13` → **逐项吻合** |

结论：不是「不够实时」，而是**源不同、口径不同**。用户的行情软件用新浪伦敦金现，必须同源。

### 1.2 宏观停在 11.10

| 项 | 事实 |
|---|---|
| 主源 | FRED `DGS10`（日频、T+1 发布）、CBOE `VIX_History.csv`（每交易日收盘） |
| 11-11 | 美国退伍军人节，债市休市 → 无 DGS10 |
| 本地快照 | `tnx=4.98, date=2026-11-10`；`vix=18.7, date=11/12/2026` |
| CNBC 实时对照 | `US10Y 5.141 (prev 5.103, last_time 2026-11-13T08:54 EST, realTime=true)` |

结论：日频源永远追不上「今天」，必须换实时源，并把数据时刻显式展示出来。

## 2. 改动

| 文件 | 改动 |
|---|---|
| `scripts/sync-xau.mjs` | 现价改抓 `hq.sinajs.cn/list=hf_XAU`；新增导出 `parseSinaQuote` / `parseSinaKline`；写 `quote` 对象；`barsSame && quoteSame` 才跳过 |
| `scripts/sync-macro.mjs` | 主源改 CNBC（`US10Y%7C.DXY%7C.VIX`）；FRED/CBOE/er-api 降为回退；写 `times` / `sources`；新增导出 `parseCnbc` / `normalizeAt` |
| `src/config.js` | `xauSpotUrl: ""`（前端不再直连任何第三方金价） |
| `src/sourceB.js` | 读 `snap.quote` 作为主通道；`ts` 取 `quote.at`；旧快照回退 `snap.spot` |
| `src/sourceC.js` | 透出 `times` / `dates` / `sources` |
| `src/render.js` | M1 新增「数据 HH:MM · x 分钟前」；>60 分钟标「源滞后」；日频回退时写「源为日频，非实时」 |
| `index.html` | 新增 `.macro-at` 样式 |
| `tests/v252.test.mjs` | 新增 17 条（Q/M/T/R 四组） |

## 3. 红灯

`docs/evidence/129-v252-red.log`（在 `v2.5.1` 工作树上复现）

```
# tests 17
# pass 3
# fail 14
```

3 条通过的是旧版本已具备的守卫行为（R1 回退链、R2 失败不覆盖、R3 旧快照兼容）。

## 4. 绿灯

`docs/evidence/130-v252-green.log`

```
## v252 专项
# tests 17
# pass 17
# fail 0
## 全量
# tests 140
# pass 140
# fail 0
```

## 5. 端到端（真实快照）

`docs/evidence/131-v252-e2e.log`

```json
{ "price": { "spot": 3882.8, "source": "sina:hf_XAU", "stale": false },
  "quote": { "price": 3882.8, "prevClose": 3877.43, "open": 3877.21, "high": 3922.99, "low": 3872.91 },
  "macro": { "dxy": 103.21, "tnx": 5.14, "vix": 18.04,
             "sources": { "vix": "cnbc", "tnx": "cnbc", "dxy": "cnbc" },
             "tnxAgeMin": 0.3 } }
[E2E PASS]
```

## 6. 变异测试

`docs/evidence/132-v252-mutation.log`

```
[CAUGHT] M1 昨收错取今开字段 → fail=1 restored=true
[CAUGHT] M2 现价变了也不落盘 → fail=1 restored=true
[CAUGHT] M3 10Y 取错标的 → fail=2 restored=true
[CAUGHT] M4 恢复前端直连口径不符的源 → fail=1 restored=true
[CAUGHT] M5 宏观时刻不再展示 → fail=1 restored=true
[MUTATION PASS]
```

首轮 M5 曾 `MISSED`（T1 断言里 `/数据\s/` 被页脚「源数据」误匹配），收紧为 `class="macro-at"` + `esc(macroAt)` 后捕获。

## 7. 浏览器

本地 `docs/evidence/133-v252-local-browser.log`

```
version   : v2.5.2
pills     : 美元指数DXY 103.21→ ｜ 10Y 美债TNX 5.14↑ ｜ 恐慌指数VIX 18.04↓
macro-at  : 数据 22:09 · 8 分钟前
gold-api  : 未再请求（OK）
[LOCAL PASS]
```

线上 `docs/evidence/136-v252-live-browser.log`

```
version  : v2.5.2
pills    : 美元指数DXY 103.25→ ｜ 10Y 美债TNX 5.16↑ ｜ 恐慌指数VIX 18.10↓
macro-at : 数据 22:27 · 7 分钟前
[LIVE PASS] / [LIVE OFFLINE PASS]
```

## 8. 部署执行结果

### 8.1 发布

| 项 | 值 |
|---|---|
| 提交 | `805b10b`（变基到 `3094abe` 之上，`-X theirs` 保留新版数据格式） |
| Tag | `v2.5.2` → `6515aa8d`（annotated），解引用 `805b10b` |
| 推送 | `9db4132..805b10b main -> main`；`[new tag] v2.5.2` |
| Release | `id=444322302`，`draft=false`、`prerelease=false` |

推送过程中 `github.com:443` 出现两次连接失败（`Failed to connect ... after 133048 ms`、`Operation too slow`），第 3 次成功；日志已脱敏 `ghp_[REDACTED]`。

### 8.2 工作流

| run | 事件 | 结论 | 说明 |
|---|---|---|---|
| `43442027707` | push | **cancelled** | 与 chain run 抢同一并发组，排队 5 分钟后被新 run 顶替 → 这是 v2.5.3 修的缺陷 |
| `43442828955` | workflow_dispatch | success（在跑） | chain 接力，用 `805b10b` 新代码同步，推送 `4b83d88` |
| Pages | dynamic | success | 基于 `4b83d88` 构建 |

> push run 被取消**不影响数据生效**：chain run 用的已经是新代码，线上数据在 14:27 即为新口径。但红叉本身是流程缺陷，v2.5.3 修复。

### 8.3 线上终验

`docs/evidence/135-v252-live-bytes.log`

```
15 个代码文件：HTTP 200 + sha256 全部一致，FAIL_FLAG=0
data 结构校验：
  macro sources = {vix: cnbc, tnx: cnbc, dxy: cnbc}
  macro times   = {tnx: 2026-11-13T09:27:19-05:00, dxy: ...09:27:22, vix: ...09:25:01}
  xau quote     = {price: 3889.42, prevClose: 3877.43, open: 3877.21,
                   high: 3922.99, low: 3872.91, source: "sina:hf_XAU"}
  现价在当日高低区间内
[BYTES PASS]
```

`docs/evidence/136-v252-live-browser.log`

```
version  : v2.5.2
pills    : 美元指数DXY 103.25→ ｜ 10Y 美债TNX 5.16↑ ｜ 恐慌指数VIX 18.10↓
macro-at : 数据 22:27 · 7 分钟前
[LIVE PASS] 版本/金价口径/宏观中文与时刻/0报错/无溢出
[LIVE OFFLINE PASS] 不白屏 / 明确降级 / 版本号仍显示 / 0 JS 异常
```

### 8.4 回退

`git checkout v2.5.1` + 重新部署即可整站回退。本版未删除任何字段，`data/xauusd.json` 与 `data/macro.json` 均为**新增** `quote` / `times` / `sources`，旧前端读新数据不会崩（`sourceB.js` 保留 `snap.spot` 回退）。
