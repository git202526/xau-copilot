# XAU Copilot · 多源印证 AI 决策指挥中心

> 线上地址：**https://git202526.github.io/xau-copilot/**
> 老应用（只读，不修改）：https://git202526.github.io/xau-desk/#plan

XAU Copilot 是 XAU Desk 的**决策副驾**，不含 K 线主图，只回答四件事：**结论是否可信、压力有多大、网格还划不划算、今天有没有违反纪律。**

核心前提：**不盲信老应用的内部分析**。所有结论都必须由「内部结构」与「外部独立行情 MA20」交叉印证后才输出。

## 一、它怎么防盲信

| 源 | 内容 | 口径 |
|---|---|---|
| Source A | 私有库 `xau-desk-data/data.json`：持仓、买入记录、账户、支撑位、档位参数、`feed` 方向记录 | 日线趋势取 `feed` 最近一条 `dir` 明细里的「日线 X」 |
| Source B | `data-api.binance.vision` PAXG/USDT 日线（备：`api.binance.com` → CoinGecko） | 独立抓 20+ 根**已收盘**日线，自算 MA20 / ATR14 |

- `A.sign == B.trend` → 置信度 **高**（强共振，红/绿卡）
- `A.sign != B.trend` → 置信度 **低**（背离警报，黄卡，建议暂停建仓）
- 任一侧失败 → **降级**（灰卡 + 顶部降级提示），页面绝不白屏

关键细节：**只做同源内比较**。价格与其 MA20 一定来自同一通道；PAXG 与 GC=F 的基差不会被混算。MA20 用「已收盘」日线，最后一根未收盘 K 直接丢弃，避免盘中假信号；贴线 ±0.05% 设死区，避免来回翻转。

## 二、七个模块

| # | 模块 | 输出 |
|---|---|---|
| 0 | AI 晨报/晚报 | 深色气泡，融合 A/B 的一段自然语言 |
| 1 | What-If 推演 | 大结论 + 置信度徽章（高/低/降级）+ MA20 偏离标尺 |
| 2 | 交易计划与支撑验证 | 内部支撑 × 外部现价，判断「可买 / 已失效」 |
| 3 | 账户压力测试 | -5% 极端情形浮亏、可覆盖档位、杠杆 0 |
| 4 | 网格效率与熔断 | ATR14 vs 档距，`ATR < 档距×0.7` 报效率下降；单边下跌报熔断 |
| 5 | 多账户再平衡 | 成本最高/最低账户，价差 >3% 给换仓建议 |
| 6 | 纪律复盘教练 | 趋势向下且今日有 BUY → 红色扣分 |
| 7 | Webhook 推送（后台） | 强共振/熔断时静默 POST，同事件同日去重，失败不打扰 |

## 三、数据怎么上云（换设备一致）

```
私有仓库 xau-desk-data/data.json
        │  （只读，PAT 只存在于 Actions Secret）
        ▼
GitHub Actions  每 15 分钟 / 手动触发
   scripts/sync-data.mjs  → 校验字段 → 写 data/live.json + data/meta.json → commit
        ▼
本仓库 main 分支（公开快照）
        ▼
GitHub Pages → 浏览器 fetch('./data/live.json')
```

- **业务数据 100% 在 GitHub**，浏览器只留一份离线快照（断网时兜底并标注「离线快照」）。
- **令牌不进前端、不进仓库**：前端只读公开快照，读私有库这件事由 Actions 代劳。
- Webhook URL 只存本机 `localStorage`（属于本机偏好，不是业务数据）。

## 四、工程与验证

```
index.html            单页外壳 + 全部内联样式（无 CDN / 无图表库 / 图标全内联 SVG）
src/config.js         唯一配置点（数据地址、行情通道、阈值）
src/sourceA.js        老应用只读适配（GET only，绝不写）
src/sourceB.js        外部日线 + MA20 / ATR14
src/engine.js         纯计算：置信度矩阵、压测、网格、再平衡、纪律、文案
src/render.js         只读 state → HTML 字符串（渲染函数互不调用）
src/app.js            装配：取数 → 归一化 → 引擎
src/webhook.js        静默推送 + 去重
src/main.js           唯一调度入口（boot → refresh → paint → push）
tests/                node --test，10 条用例，fetch 全量拦截
docs/evidence/        红灯 / 绿灯 / 变异 / 回归日志
```

```bash
npm test          # node --test tests/*.test.mjs
npm run serve     # http://127.0.0.1:8080
```

测试证据（`docs/evidence/`）：

1. `01-red.log` —— 实现前的红灯：4 个测试文件全部 `ERR_MODULE_NOT_FOUND`
2. `02-green.log` —— 10/10 通过
3. `03-mutation-red.log` —— 把背离的置信度故意改成 high，T2 立刻失败（证明用例不是摆设）
4. `04-regression.log` —— 还原后 10/10 再次通过

## 五、回退预案

| 故障 | 处理 |
|---|---|
| 同步 Action 挂了 | 站点仍可读上一个 `data/live.json`，页面显示快照时间；本地 `npm run sync` 可手动补 |
| 快照写坏 | `git revert <sync commit>` 或 `git checkout <上一个 commit> -- data/live.json` |
| 行情源全线不可用 | 自动降级（灰卡 + 置信度降级），不影响其他卡片 |
| 页面改版出问题 | Pages 跟随 main；`git revert` 到上一个 tag（`git tag -l`）即回滚 |

## 六、发版流程（以后每次更新都走这里）

```bash
npm test                                   # 1. 必须 10/10 绿
git commit -am "feat(vX.Y.Z): ..."         # 2. 功能 +0.1，修复 +0.0.1，禁止硬编码版本
git tag -a vX.Y.Z -m "..."                 # 3. 打 tag 前先 git tag -l 校验唯一
git push origin main && git push origin vX.Y.Z
gh release create vX.Y.Z --notes "..."     # 4. Release Notes
```

Pages 跟随 `main` 自动重发，链接不变；数据由 `sync-data` 每 15 分钟自动跟进，无需手动发版。

## 七、免责

本页只做多源印证与纪律复核，不构成投资建议。页面公开可访问，持仓金额按「模拟数据」对待。
