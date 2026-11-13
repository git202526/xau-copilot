/** 全局配置：唯一可改参数的地方 */
export const CONFIG = {
  /* 数据文件（同源，由 GitHub Actions 定时落盘） */
  dataUrl: "data/live.json",       // 老应用数据快照
  xauUrl: "data/xauusd.json",      // XAUUSD 日线 + 快照现价
  ratingUrl: "data/rating.json",   // 外部技术评级（Actions 预算，前端只读）
  macroUrl: "data/macro.json",     // DXY / 10Y / VIX

  /* 实时接口（CORS 开放，无 key）
     v2.6.0：金价由前端每 15 秒直连腾讯 hf_XAU（返回 access-control-allow-origin: *，
     且与新浪 hf_XAU 同口径）；10 分钟快照降级为「首屏加载 + 断网兜底」。
     历史坑：早期用第三方聚合报价，同时刻比新浪高 3~9 美元且会跳变，已彻底弃用。 */
  xauSpotUrl: "https://qt.gtimg.cn/q=hf_XAU",
  fxUrl: "https://open.er-api.com/v6/latest/USD",
  fxFallback: 7.1,                 // 仅全部汇率源失败时使用，界面会标注

  /* 指标参数 */
  maPeriod: 20,
  atrPeriod: 14,
  deadZonePct: 0.05,               // MA20 贴线死区 ±0.05%
  stressDrop: 0.05,                // 压力测试跌幅
  rebalanceSpreadPct: 3,           // 账户成本价差阈值

  /* 纯外部技术面判断阈值（v2.3.0，供 decideTechnical 使用） */
  techBullScore: 60,               // 加权得分 ≥ 60 → 偏多
  techBearScore: 40,               // 加权得分 ≤ 40 → 偏空
  techRsiHigh: 70,                 // RSI 超买线
  techRsiLow: 30,                  // RSI 超卖线
  techPctBHigh: 0.8,               // 布林上轨触顶线
  techPctBLow: 0.2,                // 布林下轨触底线

  /* 风控阈值 */
  staleMinutes: 15,                // 外部行情超过即判僵尸数据
  accountStaleMinutes: 360,        // 账户快照容忍（GitHub 调度可达数小时，避免误报陈旧）
  fomoCountdownSec: 10,
  depletedRatio: 1.5,              // 剩余额度 / 下一档 < 1.5 → 枯竭
  vixSpikePct: 20,                 // VIX 单日涨幅阈值

  /* 可选：Webhook（本地配置，不落云端） */
  webhookUrl: "",
  cacheKey: "xau_copilot_snapshot_v2",
  hookKeyPrefix: "xau_copilot_hook_",
  syncHint: "数据源：git202526/xau-desk-data（私有库，经 Actions 定时同步为公开快照）",
};
