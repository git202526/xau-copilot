/**
 * 多账户再平衡
 * 找出均价最高 / 最低的有效账户（克重 > 0 且均价有效），价差超过阈值才给建议。
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function rebalance({ A, spreadPct = 3, priceCnyGram = null }) {
  const list = ((A && A.accounts) || []).filter(
    (a) => n(a.grams) > 0.01 && n(a.avgCost) > 0
  );
  if (list.length < 2) {
    return {
      ok: false, tone: "gray", text: "有效账户少于 2 个（需有持仓且成本有效），暂不生成换仓建议。",
      accounts: list, spreadPct: null, high: null, low: null,
    };
  }

  const sorted = [...list].sort((a, b) => b.avgCost - a.avgCost);
  const high = sorted[0];
  const low = sorted[sorted.length - 1];
  const spread = ((high.avgCost - low.avgCost) / low.avgCost) * 100;

  const gap = high.avgCost - low.avgCost;
  const totalGram = list.reduce((s, a) => s + a.grams, 0);
  /* 单一数据源：整体均价必须与「账户体检卡」同源（逐笔台账口径），
     不得用账户四舍五入后的克重再加权算出第二个数字，否则同页出现两个均价。 */
  const mainAvg = n(A && A.position && A.position.avgCost);
  const weighted = mainAvg != null
    ? mainAvg
    : totalGram > 0
      ? list.reduce((s, a) => s + a.avgCost * a.grams, 0) / totalGram
      : null;

  const significant = spread > spreadPct;
  const text = significant
    ? `${high.name} 成本 ${high.avgCost.toFixed(2)} 元/克，比 ${low.name} 的 ${low.avgCost.toFixed(2)} 高出 ${spread.toFixed(1)}%。建议逢高减仓 ${high.name}，逢低补入 ${low.name}，把整体均价从 ${weighted != null ? weighted.toFixed(2) : "--"} 往下压。`
    : `最高（${high.name} ${high.avgCost.toFixed(2)}）与最低（${low.name} ${low.avgCost.toFixed(2)}）价差仅 ${spread.toFixed(1)}%，低于 ${spreadPct}% 阈值，换仓收益不足以覆盖摩擦成本，暂不动。`;

  return {
    ok: true,
    tone: significant ? "amber" : "gray",
    text,
    spreadPct: +spread.toFixed(1),
    significant,
    gap: +gap.toFixed(2),
    weightedAvg: weighted != null ? +weighted.toFixed(2) : null,
    high: { name: high.name, avgCost: +high.avgCost.toFixed(2), grams: +high.grams.toFixed(2), color: high.color },
    low: { name: low.name, avgCost: +low.avgCost.toFixed(2), grams: +low.grams.toFixed(2), color: low.color },
    accounts: sorted.map((a) => ({
      name: a.name, grams: +a.grams.toFixed(2), avgCost: +a.avgCost.toFixed(2), color: a.color,
      role: a === high ? "cut" : a === low ? "add" : "",
    })),
  };
}
