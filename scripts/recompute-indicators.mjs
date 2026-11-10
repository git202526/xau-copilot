/**
 * recompute-indicators.mjs —— 离线回填 data/xauusd.json 的 indicators 字段
 *
 * 用途：
 *   1) 本地开发/测试时，无需联网重抓新浪日线，直接对现有快照的 bars 重算指标；
 *   2) Actions 首次切换新数据结构时的兜底回填；
 *   3) 指标算法升级后，对同一批 bars 重新预算。
 *
 * 与 sync-xau.mjs 共用 src/core/indicators.js，保证线上/离线口径完全一致。
 * 只改 indicators 一个字段，bars / spot / asOf 等其它字段一律不动。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { computeIndicators } from "../src/core/indicators.js";

const OUT = "data/xauusd.json";
if (!existsSync(OUT)) {
  console.error(`[recompute] 缺少 ${OUT}，请先运行 sync-xau.mjs`);
  process.exit(1);
}

const doc = JSON.parse(readFileSync(OUT, "utf8"));
const bars = Array.isArray(doc.bars) ? doc.bars : [];
/* 剔除当日未收盘 K，与 sync-xau.mjs 的 closed 口径一致 */
const today = new Date().toISOString().slice(0, 10);
const closed = bars.filter((b) => b.d !== today);
const indicators = computeIndicators(closed);

if (!indicators.ok) {
  console.error(`[recompute] 指标计算降级：${indicators.err}`);
  process.exit(1);
}

doc.indicators = indicators;
writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
console.log(`[recompute] 写入 ${closed.length} 根已收盘日线的技术指标：`);
console.log(`  RSI14=${indicators.rsi14}  MACD.hist=${indicators.macd.hist} (${indicators.macd.cross})`);
console.log(`  BOLL %B=${indicators.boll.pctB}  MA排列=${indicators.align}`);
console.log(`  MA5/10/20/50=${indicators.ma.ma5}/${indicators.ma.ma10}/${indicators.ma.ma20}/${indicators.ma.ma50}`);
