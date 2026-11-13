/**
 * 展示层中文标签：技术评级 + 宏观指标。
 * 只做「英文原值 → 中文」的展示映射，不参与任何判断逻辑。
 */

const RATING_ZH = {
  "strong buy": "强烈买入",
  buy: "买入",
  neutral: "中性",
  sell: "卖出",
  "strong sell": "强烈卖出",
};

/** 评级中文；未知值原样返回，空值归「未评级」 */
export function ratingZh(label) {
  if (label == null || String(label).trim() === "") return "未评级";
  const raw = String(label).trim();
  return RATING_ZH[raw.toLowerCase()] || raw;
}

/** 中英并列：「强烈卖出 Strong Sell」；无法映射时只返回中文或原值 */
export function ratingZhEn(label) {
  const zh = ratingZh(label);
  const raw = label == null ? "" : String(label).trim();
  if (!raw || zh === raw || zh === "未评级") return zh;
  return `${zh} ${raw}`;
}

const MACRO_ZH = { DXY: "美元指数", TNX: "10Y 美债", VIX: "恐慌指数" };

/** 宏观指标中文名；未知 key 原样返回 */
export function macroZh(key) {
  const raw = key == null ? "" : String(key).trim();
  if (!raw) return "--";
  return MACRO_ZH[raw.toUpperCase()] || raw;
}
