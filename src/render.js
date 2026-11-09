/**
 * 渲染层：只读 state 拼 HTML，不含任何业务判断。
 * 铁律：七个 render 函数互不调用，统一由 main.js 的 refreshAll() 调度。
 */
import { BADGE, ratingLabel } from "./core/confidence.js";

const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const num = (v, d = 2) =>
  v == null || !Number.isFinite(Number(v))
    ? "--"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const cny = (v, d = 2) =>
  v == null || !Number.isFinite(Number(v)) ? "--" : `¥${Number(v).toLocaleString("zh-CN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

const pct = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? "--" : `${v > 0 ? "+" : ""}${Number(v).toFixed(d)}%`);

const wan = (v) => (v == null || !Number.isFinite(Number(v)) ? "--" : (Number(v) / 10000).toFixed(2));

const fmtTime = (ts, withDate = false) => {
  if (!ts) return "--";
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return "--";
  const p = (x) => String(x).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return withDate ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}` : hm;
};

const ico = {
  warn: `<svg viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`,
  info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
};

/* ───────────────── M0 晨报 ───────────────── */
function briefingText(s) {
  const d = s.decision;
  const A = s.A, B = s.B, C = s.C;
  const hour = new Date(s.now).getHours();
  const hi = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  const aTxt = A && A.trend && A.trend.text ? `内部日线${A.trend.text}` : "内部趋势缺失";
  const bTxt = !B.ok
    ? "外部校验失败"
    : B.trend === 1
      ? `外部站上 MA20（${num(B.ma20UsdOz)}）`
      : B.trend === -1
        ? `外部跌破 MA20（${num(B.ma20UsdOz)}）`
        : "外部贴 MA20 横走";

  const macroTxt =
    C.mode === "risk_off" ? "VIX 恐慌飙升，已切避险模式" : C.dir === 1 ? "宏观强支撑" : C.dir === -1 ? "宏观强压制" : "宏观方向分歧";

  const tail =
    d.scenario === "divergence"
      ? "多源背离，建议暂停建仓。"
      : d.scenario === "intraday_rebound"
        ? "日线共振但盘中强反抽，防范诱空，暂缓追单。"
        : d.scenario === "resonance_short"
          ? "方向共振向下，按计划减仓。"
          : d.scenario === "resonance_long"
            ? "方向共振向上，可分批建仓。"
            : d.scenario === "risk_off"
              ? "多看少动，先保命。"
              : "区间中轴，不必动手。";

  return { hi, body: `${hi}。${aTxt}，但${bTxt}；${macroTxt}。${tail}` };
}

export function renderBriefing(s) {
  const box = $("m0");
  if (!box) return;
  const { hi, body } = briefingText(s);
  const d = s.decision;
  const chips = [
    `<span class="chip">内部 ${s.A && s.A.trend ? s.A.trend.text || "--" : "--"}</span>`,
    `<span class="chip">外部 ${s.B && s.B.rating ? s.B.rating.label : "降级"}</span>`,
    `<span class="chip">宏观 ${s.C.mode === "risk_off" ? "避险" : s.C.label || "--"}</span>`,
    `<span class="chip ${d.conf === "high" ? "bad" : d.conf === "degraded" ? "" : "warn"}">置信 ${BADGE[d.conf] ? BADGE[d.conf].text : "--"}</span>`,
    d.scenario === "intraday_rebound" ? `<span class="chip warn">盘中强反抽 · 时间错配</span>` : "",
    s.meta && s.meta.staleB ? `<span class="chip bad">外部僵尸 · 印证作废</span>` : "",
    s.meta && s.meta.staleA ? `<span class="chip warn">结构数据陈旧</span>` : "",
    s.meta && s.meta.degraded ? `<span class="chip bad">源异常</span>` : "",
  ].filter(Boolean).join("");

  box.innerHTML = `<section class="bubble rise">
    <div class="b-head">
      <span class="tag">AI 研判</span>
      <span class="sep"></span>
      <time>${fmtTime(s.now, true)} · A×B×C 融合</time>
    </div>
    <p class="b-text">${esc(body)}</p>
    <div class="b-foot">${chips}</div>
  </section>`;
}

/* ───────────────── M1 宏观与双轨雷达 ───────────────── */
export function renderRadar(s) {
  const box = $("m1");
  if (!box) return;
  const C = s.C || { items: [] };
  const B = s.B;
  const A = s.A;

  const pills = (C.items || [])
    .map((it) => {
      const dir = it.dir;
      const cls = dir > 0 ? "up" : dir < 0 ? "dn" : "flat";
      const arrow = dir > 0 ? "↑" : dir < 0 ? "↓" : "→";
      return `<div class="pill"><span class="k">${esc(it.key)}</span><span class="v ${cls}">${it.value != null ? num(it.value, it.digits) : "--"}<span style="font-size:9px;opacity:.7">${arrow}</span></span></div>`;
    })
    .join("");

  const intlPrice = B.ok ? num(B.priceUsdOz) : "--";
  const rateLbl = B.ok && B.rating ? B.rating.label : "未评级";
  const rateCls = B.ok && B.rating ? (B.rating.score >= 55 ? "buy" : B.rating.score <= 45 ? "sell" : "mid") : "mid";

  const domPrice = s.priceCnyGram != null ? num(s.priceCnyGram) : "--";
  const aTrend = A && A.trend && A.trend.text ? A.trend.text : "数据缺失";
  const aCls = A && A.trend ? (A.trend.sign < 0 ? "sell" : A.trend.sign > 0 ? "buy" : "mid") : "mid";

  const p = s.premium || {};
  const premCls = p.frozen ? "prem frozen" : "prem";
  const premTxt =
    p.value == null
      ? `<span>溢价率 <b style="color:var(--tx-3)">--</b></span><span style="color:var(--tx-3)">缺少国内参考价</span>`
      : `<span>内外盘溢价率 <b style="color:${p.value > 0 ? "var(--red)" : "var(--green)"}">${pct(p.value)}</b></span>
         <span style="color:var(--tx-3);font-size:10.5px">国内参考 ${num(p.ref)} / 国际折算 ${num(p.intl)}</span>`;

  box.innerHTML = `<section class="card rise" data-tone="${C.mode === "risk_off" ? "violet" : C.dir !== 0 ? "gray" : "gray"}">
    <div class="c-head"><span class="c-no">01</span><span class="c-title">宏观与双轨雷达</span>
      ${C.mode === "risk_off" ? `<span class="badge b-low" style="margin-left:auto">避险模式</span>` : C.panic ? `<span class="badge b-low" style="margin-left:auto">恐慌区</span>` : ""}
    </div>
    <div class="pills">${pills || `<div class="pill"><span class="k">宏观</span><span class="v flat">--</span></div>`}</div>
    <div class="dual">
      <div>
        <div class="lbl">国际 · XAUUSD</div>
        <div class="big">${intlPrice}<span class="unit">$/oz</span></div>
        <div class="sub"><span class="sig ${rateCls}">${esc(rateLbl)}</span>${B.ok ? `<span style="color:var(--tx-3)">MA20 ${num(B.ma20UsdOz)}</span>` : ""}</div>
      </div>
      <div>
        <div class="lbl">国内 · 折算克价</div>
        <div class="big">${domPrice}<span class="unit">元/克</span></div>
        <div class="sub"><span class="sig ${aCls}">${esc(aTrend)}</span>${A && A.trend && A.trend.confidence != null ? `<span style="color:var(--tx-3)">置信 ${A.trend.confidence}</span>` : ""}</div>
      </div>
    </div>
    <div class="${premCls}">
      ${premTxt}
      ${p.frozen ? `<span class="lock">已冻结</span>` : ""}
    </div>
  </section>`;
}

/* ───────────────── M2 多源共振决策 ───────────────── */
export function renderDecision(s) {
  const box = $("m2");
  if (!box) return;
  const d = s.decision;
  const badge = BADGE[d.conf] || BADGE.degraded;

  const aSign = d.aSign || 0;
  const bSign = d.bSign;
  const aTxt = aSign > 0 ? "↑ 多头" : aSign < 0 ? "↓ 空头" : "→ 中性";
  const aCls = aSign > 0 ? "up" : aSign < 0 ? "dn" : "";
  const bTxt = bSign == null ? "— 降级" : bSign > 0 ? "↑ 多头" : bSign < 0 ? "↓ 空头" : "→ 中性";
  const bCls = bSign == null ? "" : bSign > 0 ? "up" : bSign < 0 ? "dn" : "";

  const isRebound = d.scenario === "intraday_rebound";
  const midCls = d.scenario === "divergence" || isRebound ? "bad" : d.scenario.startsWith("resonance") ? "ok" : "bad";
  const midTxt =
    isRebound ? "⚠️ 盘中强反抽"
      : d.scenario === "divergence" ? "背离"
        : d.scenario.startsWith("resonance") ? "共振"
          : d.scenario === "risk_off" ? "避险" : "中轴";

  /* 盘中反抽：中间黄色图标之外，再补一条独立警示条（规范要求「切忌盲目追空」显式可见） */
  const reboundStrip = isRebound
    ? `<div class="alert-strip amber">${ico.warn}<span>${esc(d.text)}</span></div>`
    : "";

  box.innerHTML = `<section class="card rise" data-tone="${d.tone}">
    <div class="c-head"><span class="c-no">02</span><span class="c-title">多源共振决策</span>
      <span class="badge ${badge.cls}">置信 ${badge.text}</span>
    </div>
    <div class="verdict"><div class="hl ${d.tone}">${esc(d.headline)}</div></div>
    <div class="vs">
      <div class="side"><div class="k">内部结构</div><div class="v ${aCls}">${aTxt}</div></div>
      <div class="mid ${midCls}">${midTxt}</div>
      <div class="side"><div class="k">外部评级</div><div class="v ${bCls}">${bTxt}</div></div>
    </div>
    ${isRebound ? reboundStrip : `<p class="note">${esc(d.text)}</p>`}
    ${d.detail ? `<div style="margin-top:8px"><span class="chip">${esc(d.detail)}</span></div>` : ""}
  </section>`;
}

/* ───────────────── M3 账户真实体检 ───────────────── */
export function renderAccount(s) {
  const box = $("m3");
  if (!box) return;
  const r = s.risk;
  const pos = (s.A && s.A.position) || {};

  const pnlCls = r.pnlTone === "red" ? "red" : r.pnlTone === "green" ? "green" : "gray";
  const pnlShow = r.pnl == null ? "数据缺失" : `${r.pnl > 0 ? "+" : ""}${num(r.pnl)}`;

  const depleted = r.depleted;
  const stripCls = r.depletedTone === "red" ? "red" : r.depletedTone === "green" ? "green" : "gray";

  box.innerHTML = `<section class="card rise" data-tone="${depleted ? "red" : "gray"}">
    <div class="c-head"><span class="c-no">03</span><span class="c-title">账户真实体检</span>
      ${pos.grams != null ? `<span class="badge b-deg" style="margin-left:auto">${num(pos.grams)} g</span>` : ""}
    </div>
    <div class="pnl-wrap">
      <div class="pnl-cap">当前真实浮亏</div>
      <div class="pnl ${pnlCls}">${pnlShow}</div>
      <div class="pnl-sub">
        ${r.pnlPct != null ? `收益率 <b style="color:${r.pnlPct < 0 ? "var(--red)" : "var(--green)"}">${pct(r.pnlPct)}</b>` : "收益率 <b>--</b>"}
        <span style="color:var(--tx-3)"> | </span>
        均价 <b>${pos.avgCost != null ? num(pos.avgCost) : "--"}</b> 元/克
      </div>
    </div>
    <div class="grid2">
      <div>
        <div class="k">再跌 5%</div>
        <div class="v" style="color:var(--red)">${r.stressLoss != null ? `-${wan(r.stressLoss)} 万` : "--"}</div>
      </div>
      <div>
        <div class="k">可用资金</div>
        <div class="v">${r.remainingFunds != null ? `${r.remainingFunds.toFixed(2)} 万` : "--"}</div>
      </div>
    </div>
    <div class="alert-strip ${stripCls}">
      ${depleted ? ico.warn : ico.info}
      <span>${esc(r.depletedText)}</span>
    </div>
  </section>`;
}

/* ───────────────── M4 网格效率与熔断 ───────────────── */
export function renderGrid(s) {
  const box = $("m4");
  if (!box) return;
  const g = s.grid;
  const fuse = g.fuse;
  const barTone = fuse ? "red" : g.tone;

  const levels = (g.levels || [])
    .map((lv) => {
      const h = 8 + (lv.weightPct || 0) * 1.1;
      const cls = lv.isNext ? "next" : lv.filled ? "on" : "";
      return `<i class="${cls}" style="height:${h.toFixed(0)}px" title="第${lv.i}档 ${lv.priceUsd || "--"}"></i>`;
    })
    .join("");

  box.innerHTML = `<section class="card rise ${fuse ? "fuse" : ""}" data-tone="${barTone}">
    <div class="c-head"><span class="c-no">04</span><span class="c-title">网格效率与熔断</span>
      ${fuse ? `<span class="badge b-high" style="margin-left:auto">熔断</span>` : g.ratioPct != null ? `<span class="badge ${g.ratioPct < 70 ? "b-low" : "b-deg"}" style="margin-left:auto">${g.ratioPct}%</span>` : ""}
    </div>
    <div class="rows">
      <div class="row"><span class="k">外部 ATR14</span><span class="v">${g.atrCny != null ? `${num(g.atrCny)} <span class="mini">元/克</span>` : "--"}</span></div>
      <div class="row"><span class="k">当前档距</span><span class="v">${g.spacingCny != null ? `${num(g.spacingCny)} <span class="mini">元/克</span>` : "--"}</span></div>
      <div class="row"><span class="k">档距 / 高点</span><span class="v" style="color:var(--tx-2);font-size:11px">${g.gearCount ? `${g.gearCount} 档 · 高点 $${g.highBase}` : "--"}</span></div>
    </div>
    ${levels ? `<div class="levels">${levels}</div>` : ""}
    <div class="alert-strip ${fuse ? "red" : g.tone === "amber" ? "red" : "gray"}" style="${fuse ? "" : "background:rgba(255,255,255,.04);border-color:var(--line);color:var(--tx-2)"}">
      ${fuse ? ico.warn : ico.info}
      <span>${esc(g.text)}</span>
    </div>
  </section>`;
}

/* ───────────────── M5 多账户再平衡 ───────────────── */
export function renderRebalance(s) {
  const box = $("m5");
  if (!box) return;
  const rb = s.rebal;

  const accounts = (rb.accounts || [])
    .map((a) => {
      const maxCost = Math.max(...rb.accounts.map((x) => x.avgCost));
      const w = Math.max(8, (a.avgCost / maxCost) * 100);
      const tag =
        a.role === "cut"
          ? `<span class="tag2 cut">减仓</span>`
          : a.role === "add"
            ? `<span class="tag2 add">补仓</span>`
            : "";
      return `<div class="acct">
        <div class="top">
          <span class="nm">${esc(a.name)}</span>${tag}
          <span class="cost">${num(a.avgCost)} · ${num(a.grams)}g</span>
        </div>
        <div class="bar"><i style="width:${w.toFixed(1)}%;background:${a.color || "var(--gold)"}"></i></div>
      </div>`;
    })
    .join("");

  box.innerHTML = `<section class="card rise" data-tone="${rb.tone || "gray"}">
    <div class="c-head"><span class="c-no">05</span><span class="c-title">多账户再平衡</span>
      ${rb.spreadPct != null ? `<span class="badge ${rb.significant ? "b-low" : "b-deg"}" style="margin-left:auto">价差 ${rb.spreadPct}%</span>` : ""}
    </div>
    ${accounts || `<div class="deg">${ico.info}<span>${esc(rb.text)}</span></div>`}
    ${accounts ? `<p class="note" style="margin-top:10px">${esc(rb.text)}</p>` : ""}
  </section>`;
}

/* ───────────────── M6 纪律复盘 ───────────────── */
export function renderDiscipline(s) {
  const box = $("m6");
  if (!box) return;
  const d = s.disc;

  const items = (d.items || [])
    .map((x) => `<div class="disc ${x.ok ? "ok" : "bad"}"><span class="b"></span><span>${esc(x.text)}</span></div>`)
    .join("");

  box.innerHTML = `<section class="card rise" data-tone="${d.tone}">
    <div class="c-head"><span class="c-no">06</span><span class="c-title">纪律复盘教练</span>
      <span class="badge ${d.state === "violation" ? "b-high" : "b-mid"}" style="margin-left:auto">${d.state === "violation" ? "扣分" : "良好"}</span>
    </div>
    <div class="alert-strip ${d.state === "violation" ? "red" : "green"}">
      ${d.state === "violation" ? ico.warn : ico.check}
      <span>${esc(d.head)}</span>
    </div>
    <div style="margin-top:8px">${items}</div>
  </section>`;
}

/* ───────────────── 顶栏状态 ───────────────── */
export function renderTopbar(s) {
  const dot = $("live-dot");
  if (dot) {
    dot.className = "dot";
    if (s.meta.degraded) dot.classList.add("bad");
    else if (s.meta.staleA || s.meta.staleB || s.meta.fxFallback) dot.classList.add("warn");
  }
  const foot = $("foot-src");
  if (foot) {
    const bits = [];
    bits.push(`A 结构 ${s.meta.aOk ? "ok" : "失败"}`);
    bits.push(`B 行情 ${s.meta.bOk ? (s.B.spotSource === "gold-api" ? "实时" : "快照") : "失败"}`);
    bits.push(`C 宏观 ${s.meta.cOk ? "ok" : "失败"}`);
    bits.push(`汇率 ${s.meta.fx ? Number(s.meta.fx).toFixed(4) : "--"}${s.meta.fxFallback ? "(兜底)" : ""}`);
    bits.push(`数据 ${s.meta.dataAgeMin != null ? s.meta.dataAgeMin + " 分钟前" : "--"}${s.meta.staleA ? "（结构陈旧）" : ""}`);
    if (s.meta.syncAgeMin != null) bits.push(`云端同步 ${s.meta.syncAgeMin} 分钟前`);
    if (s.meta.staleB) bits.push("外部僵尸 · 印证作废");
    if (s.meta.staleA) bits.push("同步超 15 分钟");
    foot.textContent = bits.join("  ·  ");
  }
}

/* ───────────────── 统一出口（唯一被 main 调用的函数） ───────────────── */
export function renderAll(s) {
  renderBriefing(s);
  renderRadar(s);
  renderDecision(s);
  renderAccount(s);
  renderGrid(s);
  renderRebalance(s);
  renderDiscipline(s);
  renderTopbar(s);
}

/* 降级兜底：全量失败时也要有内容，不白屏 */
export function renderFailSafe(err) {
  const app = $("app");
  if (!app) return;
  const msg = esc((err && err.message) || err || "未知错误");
  app.innerHTML = `<section class="bubble rise">
    <div class="b-head"><span class="tag">降级处理</span><time>本地兜底</time></div>
    <p class="b-text">源数据异常，已进入降级模式。页面未中断：${msg}。点右上角刷新可重试。</p>
    <div class="b-foot"><span class="chip bad">降级模式</span><span class="chip">七张卡暂停</span></div>
  </section>`;
}
