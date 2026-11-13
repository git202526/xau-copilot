# v2.6.0 运行报告 — 金价 15 秒实时通道

- 交付时间：2026-11-13 23:47 GMT+8
- 提交：`905fe94`（rebase 自 `6de69fa`，因远端被数据提交推进 4 条）
- 标签：`v2.6.0`
- Release：`444419002` — https://github.com/git202526/xau-copilot/releases/tag/v2.6.0
- 线上：https://git202526.github.io/xau-copilot/

## 0. 需求与判断

> 用户：「10 分钟够用吗？金价单独换成免费的 15 秒的源」

分两问答：

| 指标 | 10 分钟够不够 | 处置 |
|---|---|---|
| 10Y / DXY / VIX | **够**。三者本身是分钟级慢变量，源侧（CNBC）也是分钟级，10 分钟一档不会丢掉有效变化 | 不动 |
| XAUUSD | **不够**。10 分钟走 5~20 美元很常见，用户对照行情软件会认为「卡住」 | 单开 15 秒通道 |

## 1. 版本计算（非硬编码）

```
$ node scripts/release.mjs feature
{ "kind": "feature", "latestTag": "v2.5.3", "newVersion": "v2.6.0",
  "unique": true, "localTagCount": 12 }
```

原始输出：`docs/evidence/144-version-calc.log`。
注：脚本本次读远端 tag 超时（`spawnSync /bin/sh ETIMEDOUT`），仅用本地 12 个 tag 校验；远端唯一性随后由 `git push v2.6.0` 成功（`[new tag]`）反证。

## 2. 选源实测（先量后写，不拍脑袋）

```
$ curl -D - "https://qt.gtimg.cn/q=hf_XAU" -H "Origin: https://git202526.github.io"
HTTP/2 200
content-type: text/html; charset=GBK
access-control-allow-origin: *

v_hf_XAU="3888.93,0.30,3888.93,3889.28,3922.99,3872.91,23:11:00,3877.43,3877.21,0,0,0,2026-11-13,伦敦金（现货黄金）";
```

| 候选 | CORS | 结果 |
|---|---|---|
| `hq.sinajs.cn/list=hf_XAU` | **无（403 Forbidden）** | 只能服务端抓 |
| `api.gold-api.com/price/XAU` | `*` | 3891.87，比新浪高约 3 美元（v2.5.2 已判口径漂移） |
| `data-asg.goldprice.org/dbXRates/USD` | **403** | 不可用 |
| `qt.gtimg.cn/q=hf_XAU` | **`*`** | 3893.54；**高 3922.99 / 低 3872.91 / 昨收 3877.43 与新浪快照逐字段一致** |

刷新率（12 秒采样 ×7，`docs/evidence` 外的一次现场采样）：

```
23:13:19 | 3893.54 ... 23:12:00
23:13:56 | 3893.48 ... 23:13:00   ← 同一分钟内价格已变
23:14:08 | 3891.51 ... 23:13:00
23:14:32 | 3891.51 ... 23:13:00
```

结论：底层刷新快于 15 秒，源时间戳只到分钟，所以前端显示「本次收到时刻」而不是源时间。

## 3. 红灯（骨架实现，断言级失败）

```
$ npm test        # 骨架 realtime.js：只声明形状不实现
# tests 171  # pass 154  # fail 17
```

原始输出：`docs/evidence/145-red-v260.log`（44 KB，逐条 `not ok` 带断言差异）。
不是「模块不存在」式崩溃，是每条用例真的断言了、真的失败了。

红灯期间暴露并修正的两个**用例自身**问题（记录在案，不掩盖）：

- 初版 `L1/L2/L3` 用 `mkBars()`（数组格式）造快照，而 `loadB` 吃 `{d,o,h,l,c}` 对象 → 改成对象格式的 `bars40()`。
- 初版 `T12`／`Q6` 断言的是 v2.5.2 的「xauSpotUrl 必须置空」，与本版需求直接冲突 → 迁移为「tick 新鲜不判僵尸」「不得残留 gold-api，必须指向腾讯」。

## 4. 绿灯

```
$ npm test
# tests 171  # pass 171  # fail 0
```

原始输出：`docs/evidence/146-green-v260.log`。

## 5. 变异测试（验证用例真能抓 bug）

10 个变异，改完立即字节级还原：

| 变异 | 结果 | 被哪条抓 |
|---|---|---|
| M1 节拍 15s→60s | KILL | K1、K4 |
| M2 去掉 GBK 解码 | KILL | F1 |
| M3 非 200 不抛错 | KILL | F2 |
| M4 tick 不看新鲜度 | KILL | L2 |
| M5 红绿写反 | KILL | V1 |
| M6 去掉重叠保护 | KILL | K5 |
| M7 最高/最低字段互换 | KILL | P1 |
| M8 快照也冒充实时 | KILL | V2 |
| M9 报价时刻不标时区 | KILL | P1、P2 |
| M10 涨跌幅用原始值格式化 | KILL | V6 |

**10/10 捕获**。原始输出：`docs/evidence/147-mutation-v260.log`。
注：M4 的锚点在 `src/sourceB.js` 而非 `src/realtime.js`，第一轮脚本 `[SKIP]`，第二轮改对文件后 `[KILL]`，日志两行都保留。

顺带修正：M10 初版写成「删掉 `Math.abs(chg) < 0.005` 归零」，但 `-0` 经 `toFixed(2)` 恰好输出 `"0.00"`，变异存活——说明那个变异本身不构成 bug。改成「用原始 `chg` 格式化」后立刻被抓。

## 6. 真实浏览器验证（本地 390px / Chromium）

`docs/evidence/148-e2e-v260.log`

### 6.1 15 秒通道

```
{"t": 3.1,  "price": "3,876.20", "chg": "-0.03%", "at": "实时 · 23:37:56 更新"}
{"t": 12.1, "price": "3,876.20", "chg": "-0.03%", "at": "实时 · 23:37:56 更新"}
{"t": 21.1, "price": "3,876.20", "chg": "-0.03%", "at": "实时 · 23:38:10 更新"}
{"t": 30.2, "price": "3,876.20", "chg": "-0.03%", "at": "实时 · 23:38:10 更新"}
qt 请求数: 4 状态: [200,200,200,200]
控制台错误: []
scrollWidth: 390
```

首屏 3.1 秒出实时价（`Promise.race` 900ms 预热生效），时刻每 15 秒跳一次。

### 6.2 源全断

```
断源后 spot-at: 快照 · 10 分钟同步
断源后 price : 3,896.24      ← 回退快照，仍可读
断源后 chg   : +0.49%
页面有内容   : True
```

控制台只有浏览器必打的 `net::ERR_FAILED`，无 JS 异常。

### 6.3 停顿（先正常 4 秒，再断，观察 75 秒）

```
正常:  实时 · 23:38:46 更新
+45s:  实时 · 23:38:46 更新
+60s:  实时停顿 · 已 60 秒未更新
+75s:  实时停顿 · 已 60 秒未更新
```

45 秒阈值在 60 秒整刷时被判出来（tick 失败不主动重渲染，避免无意义重排）。

## 7. 部署

| 项 | 值 |
|---|---|
| push | `77c2d7c..905fe94 main -> main` |
| tag | `[new tag] v2.6.0 -> v2.6.0`（第 3 次尝试成功，前两次 `Operation too slow`） |
| sync-data（push） | `43456140952` **success** |
| pages build | `43456180596` **success** |
| 中间被取消的 pages run | `43456139386` cancelled —— 新部署顶掉排队中的旧部署，属 Pages 并发正常行为 |

## 8. 线上核验

### 8.1 运行时

```
版本: v2.6.0
{'t': 7.4,  'price': '3,880.03', 'chg': '+0.07%', 'at': '实时 · 23:50:13 更新'}
{'t': 22.5, 'price': '3,880.03', 'chg': '+0.07%', 'at': '实时 · 23:50:27 更新'}
{'t': 37.5, 'price': '3,880.03', 'chg': '+0.07%', 'at': '实时 · 23:50:42 更新'}
qt 请求: [(200, ...), (200, ...), (200, ...), (200, ...), (200, ...)]
控制台错误: []
scrollWidth: 390
```

从 `git202526.github.io` 出发 5 次全部 200 —— **CORS 在真实站源下确认可用**，不需要自建转发代理。

### 8.2 文件一致性（sha256 逐文件比对本地 vs 线上）

```
OK  index.html / src/{app,config,main,realtime,render,sourceB,sourceC,version}.js
OK  src/core/{confidence,discipline,grid,indicators,labels,macro,normalize,rating,rebalance,risk,sanitize,technical}.js
不一致: 0（21/21）
```

## 9. 回退预案

| 层级 | 动作 | 生效时间 | 影响面 |
|---|---|---|---|
| L1 秒级止血 | 无（前端静态，无服务端可关） | — | — |
| L2 代码回退 | `git revert 905fe94 && git push` | Pages 重建约 1~2 分钟 | 回到 v2.5.3 纯快照形态，10 分钟一档 |
| L3 只停实时通道 | 把 `src/config.js` 的 `xauSpotUrl` 置空 | 同上 | tick 取不到 URL 立即失败，整页自动回退快照，不报错 |
| L4 数据层 | 无需处理 | — | 快照链（`sync-xau.mjs` / `sync-data.yml`）本版未改，数据不受影响 |

## 10. 遗留与观察项

1. **tick 与整页判断的时间差**：15 秒只改价格显示，`m3 账户体检`的浮亏仍按 60 秒整刷的价重算，最大 60 秒口径差。刻意为之——15 秒重算 `buildState`（4 源 + 6 引擎）会让决策卡与 FOMO 弹窗抖动。
2. **腾讯接口无 SLA**：免费公开接口，可能限频或改字段。已做三重兜底（5 秒超时、失败不清 latest、整页回退快照）；若日后频繁失败，把 `SPOT_INTERVAL_MS` 调到 30 秒即可降压力。
3. **页面隐藏时不轮询**：手机切后台回来会先看到旧价，`visibilitychange` 会立即补一拍（实测有效）。
