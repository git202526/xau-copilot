/**
 * 纪律复盘（v2.3.0）
 *
 * 规则：外部技术面偏空（techDir<0）时今日仍有 BUY → 逆势加仓，扣分；否则良好。
 * 判断源只取外部方向 technical.dir；今日操作流水属于账户事实数据，仍来自 Source A。
 * 不再读取内部趋势，也不再消费双印证结论。
 */

/* 防御性数值：老应用流水可能缺 gram/priceCny，缺失一律显示占位符，绝不抛异常（不白屏） */
const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const g = (v) => (n(v) == null ? "--" : n(v).toFixed(2));

export function discipline({ A, techDir = 0, technical = null } = {}) {
  const actions = (A && A.todayActions) || [];
  const buys = actions.filter((x) => x.type === "BUY");
  const sells = actions.filter((x) => x.type === "SELL");
  const dir = technical && typeof technical.dir === "number" ? technical.dir : techDir;
  const adverse = dir < 0 && buys.length > 0;

  const items = [];
  if (!actions.length) {
    items.push({ ok: true, text: "今日无操作记录。" });
  }
  for (const b of buys) {
    items.push({
      ok: !adverse,
      text:
        `买入 ${g(b.gram)} 克 @ ${g(b.priceCny)} 元/克` +
        (adverse ? " —— 外部技术面偏空期间加仓，属逆势接飞刀。" : " —— 与当前外部技术面不冲突。"),
    });
  }
  for (const s of sells) {
    items.push({ ok: true, text: `卖出 ${g(s.gram)} 克 @ ${g(s.priceCny)} 元/克 —— 减仓方向，符合纪律。` });
  }

  let head;
  if (adverse) head = "纪律扣分：逆势加仓";
  else if (!actions.length) head = "纪律良好：今日未操作";
  else head = "纪律良好：未发现违规";

  return {
    ok: true,
    state: adverse ? "violation" : "clean",
    tone: adverse ? "amber" : "gray",
    head,
    items,
    buyCount: buys.length,
    sellCount: sells.length,
    buyGrams: buys.reduce((s, x) => s + (n(x.gram) || 0), 0),
  };
}
