/** render.js —— 渲染层：只读 state 拼 HTML，不做任何业务判断，也互不调用 */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtTime = (ts) => {
  if (!ts) return "--";
  const d = new Date(Number(ts) + 8 * 3600 * 1000);
  const iso = d.toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
};

function head(no, title, tag, badge) {
  return `<header class="card-head">
    <div class="card-title"><span class="no">${no}</span><h2>${esc(title)}</h2>${badge || ""}</div>
    <span class="card-tag">${esc(tag)}</span>
  </header>`;
}

function card(id, toneClass, inner, extra = "") {
  return `<section class="card ${toneClass}" id="card-${id}"${extra}><i class="bar"></i>${inner}</section>`;
}

function gauge(price, ma20) {
  if (!price || !ma20) return "";
  const dev = (price / ma20 - 1) * 100;
  const clamp = Math.max(-6, Math.min(6, dev));
  const x = 120 + (clamp / 6) * 100;
  const up = dev >= 0;
  return `<svg class="gauge" viewBox="0 0 240 34" role="img" aria-label="价格相对 MA20 偏离 ${dev.toFixed(2)}%">
    <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#22c55e"/><stop offset=".5" stop-color="#94a3b8"/><stop offset="1" stop-color="#ef4444"/></linearGradient></defs>
    <rect x="20" y="12" width="200" height="6" rx="3" fill="url(#gg)" opacity=".55"/>
    <rect x="117" y="6" width="3" height="18" rx="1.5" fill="#e2e8f0" opacity=".7"/>
    <circle cx="${x.toFixed(1)}" cy="15" r="6" fill="${up ? "#ef4444" : "#22c55e"}" stroke="#0b0f14" stroke-width="2"/>
    <text x="20" y="31" class="g-l">MA20 ${ma20}</text>
    <text x="220" y="31" class="g-r" text-anchor="end">${dev >= 0 ? "+" : ""}${dev.toFixed(2)}%</text>
  </svg>`;
}

function kv(rows) {
  return `<div class="kv">${rows.filter(Boolean).map(([k, v]) => `<div class="kv-i"><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>`;
}

export function sectionsHTML(state) {
  const { A, B, decision, briefing, tradePlan, stress, grid, rebalance, discipline, meta } = state;
  const d = decision;

  /* M0 晨报 */
  const briefingHTML = `<section class="bubble" id="card-briefing">
    <div class="bubble-top"><span class="dot"></span><span class="bubble-label">AI 多源播报</span><span class="bubble-time">${fmtTime(state.now)}</span></div>
    <p class="bubble-text">${esc(briefing)}</p>
    <div class="bubble-foot">
      <span class="chip ${meta.degraded.length ? "chip--warn" : "chip--ok"}">${meta.degraded.length ? "降级模式" : "双源在线"}</span>
      <span class="chip">A：${A.ok ? "内部 " + esc(A.trend.label) : "异常"}</span>
      <span class="chip">B：${B.ok ? "外部 " + (B.trend === 1 ? "多头" : B.trend === -1 ? "空头" : "震荡") : "异常"}</span>
      <span class="chip">置信：${esc(d.badge)}</span>
    </div>
  </section>`;

  /* M1 决策 */
  const badgeCls = d.confidence === "high" ? "badge--high" : d.confidence === "low" ? "badge--low" : "badge--degraded";
  const decisionHTML = card("decision", d.toneClass, `
    ${head("01", "What-If 推演", "多源决策", `<span class="badge ${badgeCls}" id="conf-badge">置信度 ${esc(d.badge)}</span>`)}
    <p class="verdict">${esc(d.body)}</p>
    ${B.ok ? gauge(B.priceCnyGram, B.ma20CnyGram) : `<div class="degraded-strip">${A.ok ? "外部行情不可用 · 置信度降级，仅内部单源展示" : "内部与外部均不可用 · 全量降级，请稍后重试"}</div>`}
    ${kv([
      ["内部日线", `${esc(A.trend.label)}${A.trend.conf != null ? ` <em>内部置信 ${A.trend.conf}</em>` : ""}`],
      B.ok ? ["外部现价", `${B.priceCnyGram} <em>元/克</em>`] : null,
      B.ok ? ["MA20", `${B.ma20CnyGram} <em>${B.ma20UsdOz}$/oz</em>`] : null,
      B.ok ? ["偏离", `${B.devPct > 0 ? "+" : ""}${B.devPct}%`] : null,
      ["行情源", B.ok ? esc(B.sourceLabel || B.source) : "--"],
    ])}
  `);

  /* M2 计划 */
  const planHTML = card("trade-plan", tradePlan.toneClass, `
    ${head("02", "交易计划与支撑验证", "内部支撑 × 外部现价")}
    <p class="verdict">${esc(tradePlan.text)}</p>
    ${kv([
      ["内部支撑", tradePlan.support ? `${tradePlan.support.cny} <em>${esc(tradePlan.support.name)}</em>` : "--"],
      B.ok && tradePlan.support ? ["距支撑", `${(((B.priceCnyGram - tradePlan.support.cny) / tradePlan.support.cny) * 100).toFixed(2)}%`] : null,
      ["状态", tradePlan.state === "watch" ? "等待回踩验证" : tradePlan.state === "invalid" ? "已失效" : "数据不足"],
    ])}
  `);

  /* M3 压测 */
  const lossPct = stress.price && stress.target ? ((stress.price - stress.target) / stress.price) * 100 : 0;
  const stressHTML = card("stress", stress.toneClass, `
    ${head("03", "账户压力测试仪", `-${Math.round(lossPct)}% 极端情形`)}
    <p class="verdict">${esc(stress.text)}</p>
    ${stress.lossWan != null ? `<div class="stress-bar"><span style="width:${Math.min(100, 100 - lossPct * 4)}%"></span><i>${stress.price} → ${stress.target}</i></div>` : ""}
    ${kv([
      ["持仓克重", stress.gram ? `${stress.gram} g` : "--"],
      ["极端浮亏", stress.lossWan != null ? `<b class="loss">-${stress.lossWan} 万</b>` : "--"],
      ["可覆盖档位", stress.levels != null ? `${stress.levels} 档` : "--"],
      ["杠杆", "0（无融资）"],
    ])}
  `);

  /* M4 网格 */
  const gridHTML = card("grid", grid.toneClass, `
    ${head("04", "网格效率与熔断", "ATR × 档距")}
    <p class="verdict ${grid.state === "fuse" ? "txt-red" : ""}">${esc(grid.text)}</p>
    <div class="duo">
      <div class="duo-i"><span>ATR14</span><b>${grid.atrUsd != null ? Math.round(grid.atrUsd) + " <em>$/oz</em>" : "--"}</b></div>
      <div class="duo-i"><span>档距</span><b>${grid.spacing != null ? Math.round(grid.spacing) + " <em>$/oz</em>" : "--"}</b></div>
      <div class="duo-i"><span>效率比</span><b>${grid.ratio != null ? (grid.ratio * 100).toFixed(0) + "%" : "--"}</b></div>
    </div>
  `);

  /* M5 再平衡 */
  const rebHTML = card("rebalance", rebalance.toneClass, `
    ${head("05", "多账户再平衡", rebalance.spreadPct != null ? `成本价差 ${rebalance.spreadPct}%` : "账户聚合")}
    <p class="verdict">${esc(rebalance.text)}</p>
    ${A.ok && A.accounts.length ? `<div class="acct">${A.accounts.map((a) => `<div class="acct-i ${rebalance.high && a.id === rebalance.high.id ? "hi" : ""} ${rebalance.low && a.id === rebalance.low.id ? "lo" : ""}">
        <span>${esc(a.name)}</span><b>${a.avgCost ?? "--"}</b><em>${a.gram} g</em></div>`).join("")}</div>` : ""}
  `);

  /* M6 纪律 */
  const disHTML = card("discipline", discipline.toneClass, `
    ${head("06", "纪律复盘教练", `今日 ${discipline.items.length} 笔操作`)}
    <p class="verdict ${discipline.state === "violation" ? "txt-red" : ""}">${esc(discipline.text)}</p>
    ${discipline.items.length ? `<ul class="ops">${discipline.items.slice(0, 4).map((o) => `<li><span class="op ${o.type === "BUY" ? "buy" : "sell"}">${o.type === "BUY" ? "买" : "卖"}</span>${o.gram} g @ ${o.price} <em>${fmtTime(new Date(o.time).getTime())}</em></li>`).join("")}</ul>` : ""}
  `);

  return { briefing: briefingHTML, decision: decisionHTML, tradePlan: planHTML, stress: stressHTML, grid: gridHTML, rebalance: rebHTML, discipline: disHTML };
}

/** 状态条（数据来源 / 同步时间 / 降级提示） */
export function statusHTML(state) {
  const m = state.meta;
  const items = [
    `数据快照 <b>${fmtTime(m.dataUpdatedAt)}</b>`,
    m.bSource ? `行情源 <b>${m.bSourceLabel || m.bSource}</b>` : `行情源 <b class="warn">离线</b>`,
    m.fxFallbackUsed ? `汇率 <b class="warn">兜底 ${Number(m.fx).toFixed(2)}</b>` : `汇率 <b>${Number(m.fx).toFixed(4)}</b>`,
    m.dataStale ? `<b class="warn">离线快照</b>` : "",
  ].filter(Boolean);
  return items.map((t) => `<span>${t}</span>`).join("");
}

export function paint(doc, state) {
  const html = sectionsHTML(state);
  const map = {
    briefing: "briefing",
    decision: "decision",
    tradePlan: "trade-plan",
    stress: "stress",
    grid: "grid",
    rebalance: "rebalance",
    discipline: "discipline",
  };
  Object.keys(map).forEach((k) => {
    const el = doc.getElementById(map[k]);
    if (el) el.innerHTML = html[k];
  });
  const st = doc.getElementById("status");
  if (st) st.innerHTML = statusHTML(state);
  doc.body.dataset.scenario = state.decision.scenario;
  doc.body.dataset.degraded = String(state.meta.degraded.length > 0);
}
