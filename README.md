# XAU Copilot · 多源印证 AI 决策指挥中心

> 线上地址：**https://git202526.github.io/xau-copilot/**
> 老应用（只读，不修改）：https://git202526.github.io/xau-desk/#plan

XAU Copilot 是 XAU Desk 的**决策副驾**，不含 K 线主图，只回答四件事：**结论是否可信、压力有多大、网格还划不划算、今天有没有违反纪律。**

核心前提：**不盲信老应用的内部分析**。所有结论都必须由「内部结构」与「外部独立行情 MA20」交叉印证后才输出。

## 一、它怎么防盲信

| 源 | 内容 | 口径 |
|---|---|---|
| Source A | 私有库 `xau-desk-data/data.json`：持仓、买入记录、账户、支撑位、档位参数、`feed` 方向记录 | 日线趋势取 `feed` 最近一条 `dir` 明细里的「日线 X」 |
| Source B | **XAUUSD 伦敦金现**：日线来自新浪全球期货（XAU，Actions 剪成最近 60 根落盘），现价来自 `api.gold-api.com/price/XAU` | 独立算 MA20 / ATR14，只吃**已收盘**日线 |
| 兜底 | Binance PAXG（标签明确写「PAXG 代理」，不冒充 XAUUSD） | 同上 |

- `A.sign == B.trend` → 置信度 **高**（强共振，红/绿卡）
- `A.sign != B.trend` → 置信度 **低**（背离警报，黄卡，建议暂停建仓）
- 任一侧失败 → **降级**（灰卡 + 顶部降级提示），页面绝不白屏

关键细节：

- **只做同品种比较**。XAUUSD 的现价与它的 MA20 来自同一品种，不会拿 PAXG 的价格去比 GC=F 的均线（基差不同会算错方向）。PAXG 只当最后一层兜底，且必须自报家门。
- MA20 只用「已收盘」日线：当日未收盘 K 直接剔除，避免盘中假信号；贴线 ±0.05% 设死区，避免来回翻转。
- **同花顺黄金技能用于口径核对**：`伦敦金现 4116.86 @20:41`、新浪 XAU `4118.40`、gold-api `4119.30`，三者偏差 <0.1%，确认公开源与技能同品种同量级。静态页面无法在浏览器里调用技能（技能需要服务端凭据），所以运行时用同品种公开接口，技能作为校验基准。

## 二、七个模块

| # | 模块 | 输出 |
|---|---|---|
| 0 | AI 研判（晨报/晚报） | 深色气泡，融合 A/B 的一段自然语言 + 四枚溯源 chips |
| 1 | What-If 推演 | 结论 + 置信度徽章（高/低/降级）+ MA20 偏离标尺 + 四格数据 |
| 2 | 支撑验证 | 内部支撑 × 外部现价，判断「等待回踩 / 已失效」 |
| 3 | 压力测试 | -5% 极端情形浮亏、可覆盖档位、杠杆 0 |
| 4 | 网格效率 | ATR14 vs 档距，`ATR < 档距×0.7` 报效率下降；单边下跌报熔断 |
| 5 | 账户再平衡 | 成本最高/最低账户、克重条、价差 >3% 给换仓建议 |
| 6 | 纪律复盘 | 趋势向下且今日有 BUY → 红色扣分 |
| 7 | Webhook（后台） | 强共振/熔断时静默 POST，同事件同日去重，失败不打扰 |

## 三、界面（v2 视觉重构）

- 顶部 **XAUUSD 大字报价** + 日涨跌 chip + MA20 与偏离 + 30 日收盘/MA20 迷你走势（面积图，不是 K 线）
- 卡片走「机构终端」语言：发丝分隔线、等宽数字、左侧 2px 状态脊、来源脚注（源 A / 源 B）
- 无 emoji 当图标，全部内联 SVG；零外部字体 / CDN
- 390px 单列优先，`≥640px` 数据格转 4 列；触控区 ≥44px；`prefers-reduced-motion` 下关闭动效

## 四、数据怎么上云（换设备一致）

```
私有仓库 xau-desk-data/data.json        新浪 XAU 日线 + gold-api 现价
        │ (PAT 只在 Actions Secret)              │
        ▼                                        ▼
GitHub Actions  每 15 分钟 / 手动触发（scripts/sync-data.mjs + sync-xau.mjs）
        ▼
本仓库 main：data/live.json · data/xauusd.json · data/meta.json
        ▼
GitHub Pages → 浏览器 fetch 同源快照 + 实时拉 gold-api 现价
```

- **业务数据 100% 在 GitHub**，浏览器只留断网只读快照（并标注「离线快照」）。
- **令牌不进前端、不进仓库**：页面只读公开快照，读私有库由 Actions 代劳。
- 日线一天只变一次，所以 `xauusd.json` 只在日线变化时提交；现价由前端实时取，不吃 15 分钟延迟。
- Webhook URL 只存本机 `localStorage`（本机偏好，不是业务数据）。

## 五、工程与验证

```
index.html            单页外壳 + 全部内联样式
src/config.js         唯一配置点（数据地址、行情通道、阈值）
src/sourceA.js        老应用只读适配（GET only，绝不写）
src/sourceB.js        XAUUSD 优先 → PAXG 兜底，MA20 / ATR14
src/engine.js         纯计算：置信度矩阵、压测、网格、再平衡、纪律、文案
src/render.js         只读 state → HTML 字符串（渲染函数互不调用）
src/app.js            装配：取数 → 归一化 → 引擎
src/webhook.js        静默推送 + 去重
src/main.js           唯一调度入口（boot → refresh → paint → push）
scripts/              云端同步脚本（老应用账本 / XAUUSD 日线）
tests/                node --test，12 条用例，fetch 全量拦截
docs/evidence/        红灯 / 绿灯 / 变异 / 回归 / 部署 日志
```

```bash
npm test          # node --test tests/*.test.mjs
npm run serve     # http://127.0.0.1:8080
```

测试证据（`docs/evidence/`）：

1. `01-red.log` —— 实现前的红灯：测试文件全部 `ERR_MODULE_NOT_FOUND`
2. `02-green.log` —— 全绿
3. `03-mutation-red.log` —— 故意把背离置信度改成 high，T2 立刻失败（证明用例不是摆设）
4. `04-regression.log` —— 还原后再次全绿
5. `05-deploy-and-live.md` —— 部署与线上端到端凭证

## 六、回退预案

| 故障 | 处理 |
|---|---|
| 同步 Action 挂了 | 站点仍读上一个快照，页面显示同步时间；本地 `npm run sync` 可手动补 |
| 快照写坏 | `git revert <sync commit>` |
| 行情源全线不可用 | 自动降级（灰卡 + 置信度降级），其他卡片照常 |
| 页面改版出问题 | Pages 跟随 main；`git push origin v2.0.0^{commit}:main` 即回滚 |

## 七、发版流程

```bash
npm test                                   # 1. 必须全绿
git commit -am "feat(vX.Y.Z): ..."         # 2. 功能 +0.1，修复 +0.0.1，禁止硬编码版本
git tag -a vX.Y.Z -m "..."                 # 3. 打 tag 前先 git tag -l 校验唯一
git push origin main && git push origin vX.Y.Z
gh release create vX.Y.Z --notes "..."     # 4. Release Notes
```

Pages 跟随 `main` 自动重发，链接不变；数据由 `sync-data` 每 15 分钟自动跟进。

## 八、免责

本页只做多源印证与纪律复核，不构成投资建议。页面公开可访问，持仓金额按「模拟数据」对待。
