# XAU Copilot · 外部技术面决策指挥中心

> 线上地址：**https://git202526.github.io/xau-copilot/**
> 老应用（只读，零侵入）：https://git202526.github.io/xau-desk/#plan

一个只做「决策」、不做 K 线主图的黄金交易副驾驶。

**v2.3.0 核心命题**：判断只依据**外部实时行情指标**——价格、MA20、RSI14、MACD、布林带、多周期均线排列、综合评级与 DXY/10Y/VIX 宏观，加权投票产生唯一方向结论。应用不再读取老应用的趋势做内部/外部交叉印证；老应用数据仅用于展示**账户事实**（真实浮亏、均价、克重、预算额度、多账户分布、网格档距）；老应用**无资金/余额字段**，额度均为预算克重派生的估算值，非账户余额。技术指标一律服务端预算、前端只读。

---

## 一、数据源

| 源 | 内容 | 通道 | 更新 | 用途 |
|---|---|---|---|---|
| **B 外部行情** | XAUUSD 现价、MA20/偏离、ATR14、日内涨跌 | 新浪 XAU 日线 + gold-api 现价 | 15 分钟 / 现价 60 秒 | **判断** |
| **B 预算指标** | RSI14、MACD、布林带、MA5/10/20/50 排列、综合评级 | `sync-xau.mjs` 服务端预算 → `data/xauusd.json.indicators` / `data/rating.json` | 15 分钟 | **判断** |
| **C 宏观** | DXY、10Y 美债、VIX | CBOE 官方 CSV + FRED DGS10 + er-api 汇率合成 | 15 分钟 | **判断**（含 VIX 避险拦截） |
| **FX 汇率** | USD/CNY | open.er-api（CORS 开放） | 60 秒 | 单位换算 / 溢价率 |
| **A 账户事实** | 持仓、账户、网格参数、今日操作 | 私有库 `data.json` → Actions 同步为 `data/live.json` | 每 10 分钟刷新（自调度链，断链 30 分钟自愈） | **仅展示**，不参与方向判断 |

> 只做 **XAUUSD 伦敦金现** 一个品种。不使用任何加密资产代币作为黄金代理——跨品种基差会让指标失真。
> 单位严格隔离：国际金 `$/oz`、国内金 `元/克`，溢价率单独成栏，绝不混算。

---

## 二、Source A 账户事实字段契约

`data.json` 是**扁平结构**，没有 `position` / `plan` / `structure` 这类嵌套对象。
v2.3.0 起这些值只用于账户体检与再平衡展示，**不再喂给任何方向判断引擎**。

| 需要的值 | 真实来源 | 计算式 |
|---|---|---|
| 持仓克重 | `buys[]` / `sells[]` | `Σbuy.gram − Σsell.gram` |
| 持仓均价 | 同上 | `Σ(buy.gram × buy.priceCny) ÷ Σbuy.gram` ← **不扣减卖出** |
| 持仓成本 | 派生 | `均价 × 克重` |
| 真实浮亏 | 派生 | `(国内现价 − 均价) × 克重` |
| 账户明细 | `accounts[]`（仅 id/name/color） | 按 `buy.acct` 分组重算克重与均价 |
| 今日操作 | `buys`/`sells` 按 `time` 过滤当日 | — |
| 档距 | `H_BASE` + `startDrop`/`endDrop` | `H × (end−start)/100 ÷ (n−1)` |
| 剩余可买（按持仓上限） | `TOTAL` − 持仓 | `MAX(0, TOTAL − 克重)` |
| 下一档金额 | `TOTAL × wPct[i]` | `计划克重 × 现价` |

> v2.4.0 口径：`TOTAL` 即用户自设的持仓上限，剩余可买直接按上限减持仓。
> v2.3.x 曾按老应用 `planBudget` 扣减「未标记档位的买入克重」，但实测 `buys[].gear` 常为 `null`，
> 会把预算扣成 0、剩余可买恒为 0；现已改为按上限计算，未标记克重仅作解释字段保留。

**为什么均价不扣卖出**：老应用 `holdStats()` 用买入总额除以买入总克重，卖出只减少克重、不改均价。按「卖出冲成本」算会得到 972.30 而非 972.01，看似差 0.29 元，实际会让 31 万的持仓成本差出近百元。

---

## 三、纯外部技术面引擎（`src/core/technical.js`）

### 十项外部指标加权投票

| 指标 | 来源 | 方向映射 |
|---|---|---|
| 现价 `$/oz` | gold-api 实时 | 展示位（权重 0） |
| MA20 偏离 | 服务端日线 | 站上/跌破 → ±1 |
| 日内涨跌 | 现价 / 昨收 | ±1 |
| ATR14 | 服务端日线 | 展示位（权重 0） |
| RSI14 | 服务端预算 | >70 超买 −1 / <30 超卖 +1 / 其余按 50 分界 |
| MACD 柱与金叉死叉 | 服务端预算 | 柱向 ±1 |
| 布林 %B | 服务端预算 | 上轨 −1 / 下轨 +1 / 其余按 0.5 分界 |
| MA5/10/20/50 排列 | 服务端预算 | 多头 +1 / 空头 −1 / 纠缠 0 |
| 综合技术评级 | `data/rating.json` | ≥55 +1 / ≤45 −1（非必需项） |
| 宏观风向 | DXY / 10Y / VIX | 顺风 +1 / 逆风 −1 |

得分 `bull/(bull+bear)×100`：`≥60` 偏多、`≤40` 偏空、其余胶着。置信度按有效信号数与得分偏离度给高/中/低。

### 降级优先级（单向，从高到低）

1. 外部行情源不可用 / 僵尸数据 / 服务端指标缺失 → **降级**，不出方向、不白屏
2. VIX 单日暴涨 >20% → **避险模式**，技术面失效
3. 加权投票 → 偏多 / 偏空 / 胶着

### 风控三防线（判断源均为外部方向 `technical.dir`）

1. **真实浮亏强制暴露**：不隐藏、不折算、缺失时显示「数据缺失」而非 0
2. **额度不足**（估算值，非账户余额）：`剩余可买 ÷ 下一档克重 < 1.5` → 琥珀告警（判断类不用红绿）
3. **FOMO 锁**：外部技术面偏空 + 今日有买入 → 弹窗 + 10 秒倒计时才允许确认

### 数据防呆

- 僵尸数据：超新鲜度阈值 → 标记并废弃本次判断
- 休市冻结：国内非交易时段，溢价率停止计算并标注
- 缺失语义：字段缺失一律 `null`，不当作 0
- 指标计算异常：服务端显式 `ok:false`，前端判降级，绝不泄漏 NaN

---

## 四、目录

```
index.html              骨架 + 全部内联样式（深色卡片流，390px 手机端）
src/
  config.js             唯一可改配置（含 tech* 判断阈值）
  sourceB.js            XAUUSD 日线/现价 + 只读透出服务端指标
  sourceC.js            宏观与汇率
  app.js                装配层：拉数 → decideTechnical → 输出只读 state.technical
  render.js             七个渲染函数（互不调用，统一消费 s.technical）
  main.js               唯一调度入口 refreshAll()
  core/
    indicators.js       RSI14/MACD/布林/多周期均线（仅服务端调用）
    technical.js        纯外部技术面判断引擎 + BADGE
    normalize.js        Source A 账户事实解析
    sanitize.js         僵尸数据 / 休市 / TTL
    macro.js            宏观方向与避险
    risk.js             浮亏 / 枯竭 / FOMO
    grid.js             网格效率与熔断
    rebalance.js        账户再平衡
    discipline.js       纪律复盘
    rating.js           综合评级（仅服务端调用）
    confidence.js       历史双印证引擎（v2.3.0 起运行时不再 import，仅作测试夹具/回退参考）
scripts/
  sync-data.mjs             私有库 → 公开快照
  sync-xau.mjs              XAUUSD 日线 + 评级 + 服务端指标落盘
  sync-macro.mjs            DXY / 10Y / VIX
  recompute-indicators.mjs  离线对现有快照重算指标（无需联网）
tests/
  technical.test.mjs    纯外部引擎 / 指标 / 全局零双印证守卫 / 端到端解耦
  intraday.test.mjs     v2.2.0 时间对齐引擎历史用例（纯函数夹具）
  terminal.test.mjs     账户事实 / 风控 / 宏观基础用例
```

---

## 五、本地运行

```bash
npm test          # 123 条用例，必须全绿
npm run sync      # 拉老应用账户数据
node scripts/sync-xau.mjs            # 抓日线 + 服务端预算指标/评级
node scripts/recompute-indicators.mjs # 离线回填指标（可选）
node scripts/sync-macro.mjs
npm run serve     # http://localhost:8080
```

---

## 六、发版流程

```bash
node scripts/release.mjs feature     # 1. 读最新 Tag 自动 +0.1，校验本地/远端唯一
npm test                             # 2. 必须全绿
git commit -am "feat(vX.Y.Z): ..."   # 3. 功能 +0.1，修复 +0.0.1
git tag -a vX.Y.Z -m "..."           # 4. 打 tag 前校验唯一
git push origin main && git push origin vX.Y.Z
gh release create vX.Y.Z --notes "..."
```

Pages 跟随 `main` 自动重发，链接不变；数据由 `sync-data` 每 15 分钟自动跟进。

---

## 七、免责

数据来自公开接口与个人交易系统快照，可能存在延迟或误差。
综合评级为服务端预算/本地合成，非第三方付费评级。
本项目仅作决策辅助，不构成任何投资建议。交易决策与盈亏由使用者自行承担。
