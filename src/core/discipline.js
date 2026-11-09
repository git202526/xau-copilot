/**
 * 纪律复盘
 * 规则：内部趋势偏空（或背离）时今日仍有 BUY → 扣分；否则良好。
 */

export function discipline({ A, decision }) {
  const actions = (A && A.todayActions) || [];
  const buys = actions.filter((x) => x.type === "BUY");
  const sells = actions.filter((x) => x.type === "SELL");
  const aSign = A && A.trend ? A.trend.sign : 0;
  const scenario = decision ? decision.scenario : "neutral";

  const againstTrend = aSign === -1 && buys.length > 0;
  const inDivergence = scenario === "divergence" && buys.length > 0;
  const violation = againstTrend || inDivergence;

  const items = [];
  if (!actions.length) {
    items.push({ ok: true, text: "今日无操作记录。" });
  }
  for (const b of buys) {
    items.push({
      ok: !violation,
      text:
        `买入 ${b.gram.toFixed(2)} 克 @ ${b.priceCny.toFixed(2)} 元/克` +
        (violation ? " —— 趋势偏空/背离期间加仓，属逆势接飞刀。" : " —— 与当前结构不冲突。"),
    });
  }
  for (const s of sells) {
    items.push({ ok: true, text: `卖出 ${s.gram.toFixed(2)} 克 @ ${s.priceCny.toFixed(2)} 元/克 —— 减仓方向，符合纪律。` });
  }

  let head;
  if (violation) head = "纪律扣分：逆势加仓";
  else if (!actions.length) head = "纪律良好：今日未操作";
  else head = "纪律良好：未发现违规";

  return {
    ok: true,
    state: violation ? "violation" : "clean",
    tone: violation ? "red" : "green",
    head,
    items,
    buyCount: buys.length,
    sellCount: sells.length,
    buyGrams: buys.reduce((s, x) => s + x.gram, 0),
  };
}
