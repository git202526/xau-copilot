/**
 * Source C：宏观黑天鹅与共振引擎
 * DXY（美元指数）、10Y（美债收益率）、VIX（恐慌指数）
 *
 * 判定规则：
 *   DXY↓ + 10Y↓ → 强支撑（+1，利好金）
 *   DXY↑ + 10Y↑ → 强压制（−1）
 *   其余          → 中性（0，方向不明）
 *   VIX 单日 >+20% → 强制「避险模式」（优先级最高，压过一切方向判定）
 */

const n = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** 变化方向：±0.1% 死区，防抖动 */
function dirOf(cur, prev, deadPct = 0.1) {
  if (cur == null || prev == null) return 0;
  if (!prev) return 0;
  const chg = ((cur - prev) / Math.abs(prev)) * 100;
  if (chg > deadPct) return 1;
  if (chg < -deadPct) return -1;
  return 0;
}

export function judgeMacro(input = {}) {
  const dxy = n(input.dxy), dxyPrev = n(input.dxyPrev);
  const tnx = n(input.tnx), tnxPrev = n(input.tnxPrev);
  const vix = n(input.vix), vixPrev = n(input.vixPrev);

  const dxyDir = dirOf(dxy, dxyPrev);
  const tnxDir = dirOf(tnx, tnxPrev);

  let dir = 0;
  let label = "中性";
  if (dxyDir === -1 && tnxDir === -1) { dir = 1; label = "强支撑"; }
  else if (dxyDir === 1 && tnxDir === 1) { dir = -1; label = "强压制"; }
  else if (dxyDir !== 0 || tnxDir !== 0) { dir = 0; label = "分歧"; }

  const vixChg = vix != null && vixPrev > 0 ? (vix - vixPrev) / vixPrev : null;
  const spike = vixChg != null && vixChg > 0.2;
  const panic = vix != null && vix >= 25;

  return {
    ok: dxy != null || tnx != null || vix != null,
    dir,
    label,
    mode: spike ? "risk_off" : "normal",
    vixChg,
    panic,
    riskOffText: spike
      ? `VIX 单日 +${(vixChg * 100).toFixed(1)}%，恐慌飙升 → 避险模式：乱世买黄金，但波动极大，多看少动。`
      : "",
    dxyDir,
    tnxDir,
    items: [
      { key: "DXY", label: "美元指数", value: dxy, prev: dxyPrev, dir: dxyDir, unit: "", digits: 2 },
      { key: "TNX", label: "10Y 美债", value: tnx, prev: tnxPrev, dir: tnxDir, unit: "%", digits: 2 },
      { key: "VIX", label: "恐慌指数", value: vix, prev: vixPrev, dir: dirOf(vix, vixPrev, 0.5), unit: "", digits: 2, chg: vixChg },
    ].filter((x) => x.value != null),
  };
}

/** 三维置信度用：宏观符号直接复用 dir */
export function macroSign(m) {
  return m && Number.isFinite(m.dir) ? m.dir : 0;
}
