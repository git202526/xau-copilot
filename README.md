# XAU Copilot · 多源印证 AI 决策指挥中心

> 线上地址：**https://git202526.github.io/xau-copilot/**
> 老应用（只读，零侵入）：https://git202526.github.io/xau-desk/#plan

一个只做「决策」、不做 K 线主图的黄金交易副驾驶。
核心命题：**绝不盲信单一系统**——内部结构、外部评级、宏观环境三路独立信号交叉验证，冲突时降级而非硬给结论。

---

## 一、四个数据源

| 源 | 内容 | 通道 | 更新 |
|---|---|---|---|
| **A 内部结构** | 持仓、账户、网格参数、多周期趋势、今日操作 | 私有库 `data.json` → Actions 同步为 `data/live.json` | 15 分钟 |
| **B 外部行情** | XAUUSD 日线、MA20、ATR14、综合评级 | 新浪 XAU 日线 + gold-api 现价 + Actions 预算评级 | 15 分钟 / 现价 60 秒 |
| **C 宏观** | DXY、10Y 美债、VIX | CBOE 官方 CSV + FRED DGS10 + er-api 汇率合成 | 15 分钟 |
| **FX 汇率** | USD/CNY | open.er-api（CORS 开放） | 60 秒 |

> 只做 **XAUUSD 伦敦金现** 一个品种。不使用任何加密资产代币作为黄金代理——跨品种基差会让「趋势印证」本身失真。

---

## 二、Source A 真实字段契约

`data.json` 是**扁平结构**，没有 `position` / `plan` / `structure` 这类嵌套对象。

| 需要的值 | 真实来源 | 计算式 |
|---|---|---|
| 持仓克重 | `buys[]` / `sells[]` | `Σbuy.gram − Σsell.gram` |
| 持仓均价 | 同上 | `Σ(buy.gram × buy.priceCny) ÷ Σbuy.gram` ← **不扣减卖出** |
| 持仓成本 | 派生 | `均价 × 克重` |
| 真实浮亏 | 派生 | `(国内现价 − 均价) × 克重` |
| 账户明细 | `accounts[]`（仅 id/name/color） | 按 `buy.acct` 分组重算克重与均价 |
| 日线趋势 | `feed` 中 `type==='dir'` 的 `detail` | 正则提取「日线 X」与「置信 N」 |
| 今日操作 | `buys`/`sells` 按 `time` 过滤当日 | — |
| 档距 | `H_BASE` + `startDrop`/`endDrop` | `H × (end−start)/100 ÷ (n−1)` |
| 剩余额度 | `TOTAL` − 持仓 | `(TOTAL − 克重) × 现价` |
| 下一档金额 | `TOTAL × wPct[i]` | `计划克重 × 现价` |

**为什么均价不扣卖出**：老应用 `holdStats()` 用买入总额除以买入总克重，卖出只减少克重、不改均价。按「卖出冲成本」算会得到 972.30 而非 972.01，看似差 0.29 元，实际会让 31 万的持仓成本差出近百元。

---

## 三、引擎判定

### 三维置信度

| 内部 | 外部 | 宏观 | 结论 | 徽章 |
|---|---|---|---|---|
| 空 | 空 | 空 | 强共振做空 | 高（红） |
| 多 | 多 | 多 | 强共振做多 | 高（绿） |
| 空 | 多 | — | 多源背离，暂停建仓 | 低（黄） |
| — | — | VIX +20% | 强制避险模式 | 低（紫） |
| 任一源失败 | | | 外部校验失败，置信度降级 | 降级（灰） |

### 风控三防线
1. **真实浮亏强制暴露**：不隐藏、不折算、缺失时显示「数据缺失」而非 0
2. **资金枯竭**：`剩余额度 ÷ 下一档金额 < 1.5` → 红色最高级告警
3. **FOMO 锁**：背离 + 今日有买入 → 弹窗 + 10 秒倒计时才允许确认

### 数据防呆
- 僵尸数据：超 15 分钟未更新 → 标记并废弃本次印证
- 休市冻结：国内非交易时段，溢价率停止计算并标注
- 缺失语义：字段缺失一律 `null`，不当作 0

---

## 四、目录

```
index.html              骨架 + 全部内联样式（深色终端风）
src/
  config.js             唯一可改配置
  sourceB.js            XAUUSD 日线与现价
  sourceC.js            宏观与汇率
  app.js                装配层：拉数 → 跑引擎 → 输出只读 state
  render.js             七个渲染函数（互不调用）
  main.js               唯一调度入口 refreshAll()
  core/
    normalize.js        Source A 解析（真实字段映射）
    sanitize.js         僵尸数据 / 休市 / TTL
    macro.js            宏观方向与避险
    confidence.js       三维置信度
    risk.js             浮亏 / 枯竭 / FOMO
    grid.js             网格效率与熔断
    rebalance.js        账户再平衡
    discipline.js       纪律复盘
    rating.js           综合评级（仅服务端调用）
scripts/
  sync-data.mjs         私有库 → 公开快照
  sync-xau.mjs          XAUUSD 日线 + 评级
  sync-macro.mjs        DXY / 10Y / VIX
tests/terminal.test.mjs T1–T8
```

---

## 五、本地运行

```bash
npm test          # 8 条用例，必须全绿
npm run sync      # 拉老应用数据
node scripts/sync-xau.mjs
node scripts/sync-macro.mjs
npm run serve     # http://localhost:8080
```

---

## 六、发版流程

```bash
npm test                                   # 1. 必须 8/8 绿
git commit -am "feat(vX.Y.Z): ..."         # 2. 功能 +0.1，修复 +0.0.1
git tag -a vX.Y.Z -m "..."                 # 3. 打 tag 前先 git tag -l 校验唯一
git push origin main && git push origin vX.Y.Z
gh release create vX.Y.Z --notes "..."
```

Pages 跟随 `main` 自动重发，链接不变；数据由 `sync-data` 每 15 分钟自动跟进。

---

## 七、免责

数据来自公开接口与个人交易系统快照，可能存在延迟或误差。
本项目仅作决策辅助，不构成任何投资建议。交易决策与盈亏由使用者自行承担。
