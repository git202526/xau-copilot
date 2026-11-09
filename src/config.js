/** 全局配置：唯一可改参数的地方 */
export const CONFIG = {
  dataUrl: "data/live.json",            // GitHub 上的数据副本（由 Action 定时从私有库同步）
  fxUrl: "https://open.er-api.com/v6/latest/USD",
  fxFallback: 7.1,                      // 汇率兜底（仅外部接口失败时使用，界面会标注）
  binanceUrl: "https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=1d&limit=26",
  binanceAltUrl: "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1d&limit=26",
  coingeckoUrl: "https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=usd&days=30&interval=daily",
  maPeriod: 20,
  atrPeriod: 14,
  deadZonePct: 0.05,                    // MA20 贴线死区 ±0.05%
  stressDrop: 0.05,                     // 压力测试跌幅
  rebalanceSpreadPct: 3,                // 账户成本价差阈值
  webhookUrl: "",                       // 可在页面设置里填，存 localStorage（非业务数据）
  cacheKey: "xau_copilot_snapshot_v1",
  hookKeyPrefix: "xau_copilot_hook_",
  syncHint: "数据源：git202526/xau-desk-data（GitHub 私有库，经 Actions 每 15 分钟同步为公开快照）",
};
