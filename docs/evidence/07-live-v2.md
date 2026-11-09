# v2.0.0 线上验证（视觉重构 + XAUUSD 行情源）

> 实际执行结果，非示意。

## 1. 行情口径交叉核对（同品种三源）

| 源 | 值 | 时间 |
|---|---|---|
| 同花顺黄金技能 · 伦敦金现 | 4116.86 | 2026-11-09 20:41 |
| 新浪全球期货 XAU 收盘 | 4118.40 | 2026-11-09 日线 |
| gold-api `price/XAU` | 4119.30 | 实时 |

最大偏差 0.06%，确认公开源与技能同为 XAU/USD 量级；页面运行时用前两者，技能作校验基准。

## 2. Actions 实跑（run 42622186951）

```
[xau] 写入 60 根日线，现价 4124.100098（gold-api）
[main 688055e] chore(data): sync snapshot 2026-11-09T13:04Z
   4793603..688055e  main -> main
```
即 GitHub Runner 可直连新浪与 gold-api，不需要任何凭据；PAT 只用于读私有账本。

## 3. 线上端到端（390×844）

```
QUOTE : XAUUSD | 伦敦金现 | 4,124.40 | +1.32% | MA20 4,066.96 +1.41%
BADGE : 置信度 低
CARDS : 6   scrollWidth=390 / innerWidth=390
ERRS  : []（无 pageerror、无 console error）
```

- 单位一致性已修：正文、标尺、数据格统一美元/盎司，`折合` 行单列元/克。
- 日涨跌（+1.32%）与距 MA20（+1.41%）分列，不再混为一谈。

## 4. 回退

```bash
git push origin v1.0.1^{commit}:main   # 回到重构前
git push origin v2.0.0^{commit}:main   # 回到重构后
```
