/** render.js —— 渲染层：只读 state 拼 HTML，不做业务判断，渲染函数之间互不调用 */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtTime = (ts) => {
  if (!ts) return "--";
  const d = new Date(Number(ts) + 8 * 3600 * 1000);
  const iso = d.toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
};
const n2 = (v, d = 2) => (Number.isFinite(+v) ? (+v).toFixed(d) : "--");
const thousands = (v, d = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

function head(no, title, tag, badge) {
  return `<div class="c-head">
    <span class="c-no">${no}</span>
    <h2 class="c-title">${esc(title)}</h2>
    ${badge || ""}
    <span class="c-tag">${esc(tag)}</span>
  </div>`;
}
function card(id, toneClass, inner) {
  return `<section class="card ${toneClass} rise" id="card-${id}">${inner}</section>`;
}
function kv(rows) {
  const items = rows.filter(Boolean);
  if (!items.length) return "";
  return `<div class="kv">${items.map(([k, v]) => `<div class="kv-i"><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>`;
}
function src(...parts) {
  return `<div class="src">${parts.filter(Boolean).map((p) => `<span>${p}</span>`).join("<span>·</span>")}</div>`;
}

/* ── 顶部报价条 + 30 日迷你走势（收盘线 + MA20 虚线，不是 K 线） ── */
function sparkline(closes, maSeries) {
  const vals = (closes || []).filter((x) => Number.isFinite(x));
  if (vals.length < 5) return "";
  const ma = (maSeries || []).filter((x) => Number.isFinite(x));
  const all = vals.concat(ma);
  const min = Math.min(...all), max = Math.max(...all);
  const W = 118, H = 52, pad = 3;
  const x = (i, len) => pad + (i * (W - pad * 2)) / Math.max(1, len - 1);
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i, vals.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(vals.length - 1, vals.length).toFixed(1)},${H} L${pad},${H} Z`;
  const offset = vals.length - ma.length;
  const maPath = ma.length
    ? ma.map((v, i) => `${i ? "L" : "M"}${x(i + offset, vals.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
    : "";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="近 ${vals.length} 日收盘与 MA20">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9a84e" stop-opacity=".26"/><stop offset="1" stop-color="#d9a84e" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#sg)"/>
    ${maPath ? `<path class="ma" d="${maPath}"/>` : ""}
    <path class="ln" d="${line}"/>
  </svg>`;
}

export function quoteHTML(state) {
  const B = state.B;
  if (!B || !B.ok) {
    return `<div class="quote"><div class="q-main">
      <div class="q-sym"><b>XAUUSD</b><span>外部行情不可用</span></div>
      <div class="q-price" style="color:#5d6b7a">--</div>
      <div class="q-sub">外部校验中断 · 置信度降级</div>
    </div></div>`;
  }
  const dev = Number(B.devPct) || 0;
  const day = Number(B.dayPct) || 0;
  const dcls = day > 0 ? "up" : day < 0 ? "down" : "flat";
  const cls = dev > 0 ? "up" : dev < 0 ? "down" : "flat";
  const sub = B.instrument === "XAUUSD" ? "伦敦金现" : "PAXG 代理";
  return `<div class="quote">
    <div class="q-main">
      <div class="q-sym"><b>XAUUSD</b><span>${esc(sub.trim()) || "伦敦金现"}</span></div>
      <div class="q-price">${thousands(B.priceUsdOz, 2)}</div>
      <div class="q-sub">
        <span class="q-dev ${dcls}">${day > 0 ? "+" : ""}${n2(day)}%</span>
        <span>MA20 <b style="color:#c7d2de;font-family:var(--mono)">${thousands(B.ma20UsdOz, 2)}</b> <b style="color:${dev >= 0 ? "#ffb3ad" : "#8ce8bb"};font-family:var(--mono);font-weight:600">${dev > 0 ? "+" : ""}${n2(dev)}%</b></span>
      </div>
    </div>
    ${sparkline(B.closes, B.maSeries)}
  </div>`;
}

/* ── MA20 偏离标尺 ── */
function gauge(price, ma20, devPct) {
  if (!price || !ma20) return "";
  const dev = Number(devPct) || 0;
  const clamp = Math.max(-6, Math.min(6, dev));
  const x = 120 + (clamp / 6) * 96;
  const up = dev >= 0;
  return `<svg class="gauge" viewBox="0 0 240 44" role="img" aria-label="价格相对 MA20 偏离 ${dev.toFixed(2)}%">
    <defs><linearGradient id="gg" x1="0" x2="1">
      <stop offset="0" stop-color="#1ec27b" stop-opacity=".55"/><stop offset=".5" stop-color="#8b98a7" stop-opacity=".45"/><stop offset="1" stop-color="#ff5d52" stop-opacity=".55"/>
    </linearGradient></defs>
    <rect x="24" y="13" width="192" height="4" rx="2" fill="url(#gg)"/>
    ${[-6, -3, 0, 3, 6].map((t) => `<rect x="${(120 + (t / 6) * 96).toFixed(1)}" y="9" width="1" height="12" fill="rgba(255,255,255,.16)"/>`).join("")}
    <circle cx="${x.toFixed(1)}" cy="15" r="5.5" fill="${up ? "#ff5d52" : "#1ec27b"}" stroke="#0a0e13" stroke-width="2"/>
    <text x="24" y="36">−6%</text>
    <text x="216" y="36" text-anchor="end">+6%</text>
    <text x="120" y="36" text-anchor="middle" style="fill:#8b98a7">MA20 ${thousands(ma20, 2)}</text>
  </svg>`;
}

export function sectionsHTML(state) {
  const { A, B, decision: d, briefing, tradePlan, stress, grid, rebalance, discipline, meta } = state;

  /* M0 晨报 */
  const briefingHTML = `<section class="bubble rise" id="card-briefing">
    <div class="b-head">
      <span class="tag">AI 研判</span><span class="sep"></span>
      <span style="font-size:10px;color:#4f5b69;letter-spacing:.08em">A × B 融合</span>
      <time>${fmtTime(state.now)}</time>
    </div>
    <p class="b-text">${esc(briefing)}</p>
    <div class="b-foot">
      <span class="chip ${meta.degraded.length ? "warn" : "ok"}">${meta.degraded.length ? "降级模式" : "双源在线"}</span>
      <span class="chip">内部 ${A.ok ? esc(A.trend.label) : "异常"}</span>
      <span class="chip">外部 ${B.ok ? (B.trend === 1 ? "站上 MA20" : B.trend === -1 ? "跌破 MA20" : "贴线震荡") : "异常"}</span>
      <span class="chip">置信 ${esc(d.badge)}</span>
    </div>
  </section>`;

  /* M1 决策 */
  const badgeCls = d.confidence === "high" ? "badge--high" : d.confidence === "low" ? "badge--low" : "badge--degraded";
  const decisionHTML = card("decision", d.toneClass, `
    ${head("01", "What-If 推演", "多源决策", `<span class="badge ${badgeCls}" id="conf-badge">置信度 ${esc(d.badge)}</span>`)}
    <p class="verdict">${esc(d.body)}</p>
    ${B.ok ? gauge(B.priceUsdOz, B.ma20UsdOz, B.devPct) : `<div class="strip">${A.ok ? "外部行情不可用 · 置信度降级，仅内部单源展示" : "内部与外部均不可用 · 全量降级，请稍后重试"}</div>`}
    ${kv([
      ["内部日线", `${esc(A.trend.label)}<em> 置信 ${A.trend.conf ?? "--"}</em>`],
      ["外部现价", `${thousands(B.priceUsdOz, 2)}<em> $/oz</em>`],
      ["MA20", `${B.ok ? thousands(B.ma20UsdOz, 2) : "--"}<em> ${B.ok && B.instrument === "PAXG" ? "PAXG 代理" : "$/oz"}</em>`],
      ["折合", `${B.ok ? thousands(B.priceCnyGram, 2) : "--"}<em> 元/克</em>`],
    ])}
    ${src(A.ok ? "源 A · feed 最近 dir" : "源 A 缺失", B.ok ? `源 B · ${esc(B.sourceLabel)}` : "源 B 缺失")}
  `);

  /* M2 计划 */
  const planHTML = card("trade-plan", tradePlan.toneClass, `
    ${head("02", "支撑验证", tradePlan.state === "watch" ? "等待回踩" : tradePlan.state === "invalid" ? "已失效" : "数据不足")}
    <p class="verdict">${esc(tradePlan.text)}</p>
    ${kv([
      ["内部支撑", tradePlan.support ? `${thousands(tradePlan.support.cny, 2)}<em> ${esc(tradePlan.support.name)}</em>` : "--"],
      ["距现价", B.ok && tradePlan.support ? `${n2(((B.priceCnyGram - tradePlan.support.cny) / tradePlan.support.cny) * 100)}%` : "--"],
      ["支撑口径", tradePlan.support ? `$${thousands(tradePlan.support.usdOz, 0)}<em> /oz</em>` : "--"],
      ["状态", tradePlan.state === "watch" ? "验证中" : tradePlan.state === "invalid" ? "已击穿" : "--"],
    ])}
    ${src("源 A · marks / takePlan", B.ok ? "源 B · 实时现价" : null)}
  `);

  /* M3 压测 */
  const price = Number(stress.price) || 0;
  const drain = price && stress.target ? Math.max(4, Math.min(100, ((price - stress.target) / price) * 100 * 8)) : 0;
  const stressHTML = card("stress", stress.toneClass, `
    ${head("03", "压力测试", "−5% 极端情形")}
    <p class="verdict">${esc(stress.text)}</p>
    ${stress.lossWan != null ? `<div class="meter"><span class="fill" style="width:100%"></span>
      <span class="txt"><span>${thousands(stress.price, 2)}</span><span style="opacity:.75">−5%</span><span>${thousands(stress.target, 2)}</span></span></div>` : ""}
    ${kv([
      ["持仓", stress.gram ? `${thousands(stress.gram, 2)}<em> g</em>` : "--"],
      ["极端浮亏", stress.lossWan != null ? `<span class="txt-red">−${n2(stress.lossWan)}<em> 万</em></span>` : "--"],
      ["可覆盖", stress.levels != null ? `${stress.levels}<em> 档</em>` : "--"],
      ["杠杆", `0<em> 无融资</em>`],
    ])}
    ${src("源 A · 账户聚合", B.ok ? "源 B · 现价锚定" : null)}
  `);

  /* M4 网格 */
  const gridHTML = card("grid", grid.toneClass, `
    ${head("04", "网格效率", grid.state === "fuse" ? "熔断" : grid.state === "low" ? "触发频率低" : "节奏正常")}
    <p class="verdict ${grid.state === "fuse" ? "txt-red" : ""}">${esc(grid.text)}</p>
    <div class="trio">
      <div class="trio-i"><span>ATR14</span><b>${grid.atrUsd != null ? Math.round(grid.atrUsd) : "--"}<em> $</em></b></div>
      <div class="trio-i"><span>档距</span><b>${grid.spacing != null ? Math.round(grid.spacing) : "--"}<em> $</em></b></div>
      <div class="trio-i"><span>效率比</span><b>${grid.ratio != null ? (grid.ratio * 100).toFixed(0) + "%" : "--"}</b></div>
    </div>
    ${src("源 A · H_BASE / 档位百分比", "源 B · ATR14 自算")}
  `);

  /* M5 再平衡 */
  const maxG = Math.max(...(A.ok && A.accounts.length ? A.accounts.map((a) => a.gram || 0) : [1]), 1);
  const rebHTML = card("rebalance", rebalance.toneClass, `
    ${head("05", "账户再平衡", rebalance.spreadPct != null ? `价差 ${rebalance.spreadPct}%` : "账户聚合")}
    <p class="verdict">${esc(rebalance.text)}</p>
    ${A.ok && A.accounts.length ? `<div class="accts">${A.accounts.map((a) => `
      <div class="row ${rebalance.high && a.id === rebalance.high.id ? "hi" : ""} ${rebalance.low && a.id === rebalance.low.id ? "lo" : ""}">
        <span class="nm">${esc(a.name)}</span>
        <span class="bar-mini"><i style="width:${Math.round(((a.gram || 0) / maxG) * 100)}%"></i></span>
        <span class="cost">${thousands(a.avgCost, 2)}</span>
        <span class="g">${thousands(a.gram, 1)} g</span>
      </div>`).join("")}</div>` : ""}
    ${src("源 A · buys/sells 按 acct 聚合")}
  `);

  /* M6 纪律 */
  const disHTML = card("discipline", discipline.toneClass, `
    ${head("06", "纪律复盘", `今日 ${discipline.items.length} 笔`)}
    <p class="verdict ${discipline.state === "violation" ? "txt-red" : ""}">${esc(discipline.text)}</p>
    ${discipline.items.length ? `<ul class="ops">${discipline.items.slice(0, 4).map((o) => `
      <li><span class="k ${o.type === "BUY" ? "buy" : "sell"}">${o.type === "BUY" ? "买入" : "卖出"}</span>
      <span class="v">${thousands(o.gram, 1)} g @ ${thousands(o.price, 2)}</span>
      <time>${fmtTime(new Date(o.time).getTime())}</time></li>`).join("")}</ul>` : ""}
    ${src("源 A · today_actions", "源 B · 方向判定")}
  `);

  return { briefing: briefingHTML, decision: decisionHTML, tradePlan: planHTML, stress: stressHTML, grid: gridHTML, rebalance: rebHTML, discipline: disHTML };
}

export function statusHTML(state) {
  const m = state.meta;
  const items = [
    m.syncAt ? `同步 <b>${fmtTime(m.syncAt)}</b>` : "",
    m.dataUpdatedAt ? `账本 <b>${fmtTime(m.dataUpdatedAt)}</b>` : "",
    m.bSourceLabel ? `行情 <b>${esc(m.bSourceLabel)}</b>` : `行情 <b class="warn">离线</b>`,
    m.fxFallbackUsed ? `汇率 <b class="warn">兜底 ${Number(m.fx).toFixed(2)}</b>` : `汇率 <b>${Number(m.fx).toFixed(3)}</b>`,
    m.dataStale ? `<b class="warn">离线快照</b>` : "",
  ].filter(Boolean);
  return items.map((t) => `<span>${t}</span>`).join("");
}

export function paint(doc, state) {
  const html = sectionsHTML(state);
  const nodes = {
    quote: quoteHTML(state),
    briefing: html.briefing,
    decision: html.decision,
    "trade-plan": html.tradePlan,
    stress: html.stress,
    grid: html.grid,
    rebalance: html.rebalance,
    discipline: html.discipline,
  };
  Object.keys(nodes).forEach((id) => {
    const el = doc.getElementById(id);
    if (el) el.innerHTML = nodes[id];
  });
  const st = doc.getElementById("status");
  if (st) st.innerHTML = statusHTML(state);

  const live = doc.getElementById("live");
  const liveTxt = doc.getElementById("live-txt");
  const bad = state.meta.degraded.length > 0;
  if (live) live.dataset.degraded = String(bad);
  if (liveTxt) liveTxt.textContent = bad ? "降级" : "双源在线";

  doc.body.classList.add("ready");
  doc.body.dataset.scenario = state.decision.scenario;
  doc.body.dataset.degraded = String(bad);
}
