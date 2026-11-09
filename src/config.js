/** 全局配置：唯一可改参数的地方 */
export const CONFIG = {
  /* 数据文件（同源，由 GitHub Actions 定时落盘） */
  dataUrl: "data/live.json",       // 老应用数据快照
  xauUrl: "data/xauusd.json",      // XAUUSD 日线 + 快照现价
  ratingUrl: "data/rating.json",   // 外部技术评级（Actions 预算，前端只读）
  macroUrl: "data/macro.json",     // DXY / 10Y / VIX

  /* 实时接口（CORS 开放，无 key） */
  xauSpotUrl: "https://api.gold-api.com/price/XAU",
  fxUrl: "https://open.er-api.com/v6/latest/USD",
  fxFallback: 7.1,                 // 仅全部汇率源失败时使用，界面会标注

  /* 指标参数 */
  maPeriod: 20,
  atrPeriod: 14,
  deadZonePct: 0.05,               // MA20 贴线死区 ±0.05%
  stressDrop: 0.05,                // 压力测试跌幅
  rebalanceSpreadPct: 3,           // 账户成本价差阈值

  /* 风控阈值 */
  staleMinutes: 15,                // 超过即判僵尸数据
  fomoCountdownSec: 10,
  depletedRatio: 1.5,              // 剩余额度 / 下一档 < 1.5 → 枯竭
  vixSpikePct: 20,                 // VIX 单日涨幅阈值

  /* 可选：Webhook（本地配置，不落云端） */
  webhookUrl: "",
  cacheKey: "xau_copilot_snapshot_v2",
  hookKeyPrefix: "xau_copilot_hook_",
  syncHint: "数据源：git202526/xau-desk-data（私有库，经 Actions 定时同步为公开快照）",
};
