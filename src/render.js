/**
 * 渲染层：只读 state 拼 HTML，不含任何业务判断。
 * 铁律：七个 render 函数互不调用，统一由 main.js 的 refreshAll() 调度。
 *
 * v2.3.0：应用不再做内部/外部双印证，唯一判断源为 s.technical（纯外部行情指标）。
 * v2.3.1：红绿只表数值涨跌（红涨绿跌）；方向判断/状态类用 amber/violet/indigo/gray。
 * 账户事实数据（真实浮亏 / 均价 / 克重 / 预算额度 / 多账户 / 档距）仍来自 Source A 并保留展示；
 * 老应用无资金字段，「额度」为预算克重派生估算，页面已标注非账户余额。
 */
import { BADGE } from "./core/technical.js";
import { ratingZh, macroZh } from "./core/labels.js";
import { spotTickView } from "./realtime.js";

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

/* 距今时长（人话）：<1 分钟记「刚刚」，>1 天记「x 天前」 */
const ageText = (min) =>
  min == null || !Number.isFinite(min)
    ? ""
    : min < 1
      ? "刚刚"
      : min < 60
        ? `${Math.round(min)} 分钟前`
        : min < 1440
          ? `${(min / 60).toFixed(1)} 小时前`
          : `${Math.floor(min / 1440)} 天前`;

const ico = {
  warn: `<svg viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`,
  cross: `<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
};

/* 条件勾叉：独立常量，渲染时加 cond-ico 类（尺寸/描边由 CSS 控，避免被 svg 默认 300×150 撑开） */
const COND_ICO = {
  ok: `<svg class="cond-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  no: `<svg class="cond-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
};

/* ───────────────── M0 晨报 ───────────────── */
function briefingText(s) {
  const t = s.technical || {};
  const B = s.B || {}, C = s.C || {};
  const hour = new Date(s.now).getHours();
  const hi = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  /* 价格用占位符，渲染时替换成可单独更新的 <span>：15 秒 tick 只改这个数字，
     不重排整段晨报文本，读者视线不跳。 */
  const priceTxt = B.ok && B.priceUsdOz != null ? `伦敦金现 {{P}} $/oz` : "外部行情未就绪";
  const rsi = B.indicators ? B.indicators.rsi14 : null;
  const indTxt = rsi != null ? `RSI14 ${num(rsi, 1)}` : "指标预算中";
  const macroTxt =
    C.mode === "risk_off" ? "VIX 恐慌飙升，已切避险模式" : C.dir === 1 ? "宏观强支撑" : C.dir === -1 ? "宏观强压制" : "宏观方向分歧";

  const tail =
    t.scenario === "tech_bull" ? "外部指标同向偏多，可按计划分批参与。"
      : t.scenario === "tech_bear" ? "外部指标同向偏空，减少逆势补仓。"
        : t.scenario === "risk_off" ? "宏观避险，多看少动先保命。"
          : t.scenario === "degraded" ? "外部源数据异常，本次判断作废。"
            : "外部信号胶着，区间中轴不必动手。";

  return { hi, body: `${hi}。${priceTxt}，${indTxt}；${macroTxt}。${tail}` };
}

/* v2.9.0：首页从「一句话」升级为分层结论卡。
   层次：定调 → 多周期趋势 → 四层依据 → 5 日区间 → 三情景 → 失效条件。
   每一层都能单独被核，用户不需要相信一个黑箱句子。 */
const DIR_ZH = { down: "偏空", up: "偏多", flat: "中性" };

function toneOfDir(dir) {
  return dir < 0 ? "indigo" : dir > 0 ? "amber" : "gray";
}

/** 四层依据条：净票 pos/neg 各占半轴，宽度按最大绝对值归一 */
function layerRows(layers) {
  const max = Math.max(0.1, ...layers.map((l) => Math.abs(l.net)));
  return layers
    .map((l) => {
      const w = Math.min(50, (Math.abs(l.net) / max) * 50);
      const cls = l.net > 0 ? "pos" : l.net < 0 ? "neg" : "flat";
      const side = l.net >= 0 ? `left:50%;width:${w.toFixed(1)}%` : `right:50%;width:${w.toFixed(1)}%`;
      return `<div class="ly">
        <span class="ly-k">${esc(l.label)}</span>
        <span class="ly-b"><i class="${cls}" style="${side}"></i></span>
        <span class="ly-v ${cls}">${l.net > 0 ? "+" : ""}${num(l.net, 1)}</span>
        <span class="ly-s ${cls}">${esc(l.stateText)}</span>
      </div>`;
    })
    .join("");
}

/** 5 日 1σ 区间：一条横向带，2σ 更浅、1σ 更实、现价一个针 */
function coneSvg(range, price) {
  if (!range || !range.d5w || !(price > 0)) return "";
  const lo = range.d5w.lo;
  const hi = range.d5w.hi;
  const X = (p) => Math.max(0, Math.min(300, ((p - lo) / (hi - lo)) * 300));
  const y = 20;
  const h = 14;
  return `<svg class="cone-svg" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
    <rect class="cn-2" x="0" y="${y}" width="300" height="${h}" rx="3"/>
    <rect class="cn-1" x="${X(range.d5.lo).toFixed(1)}" y="${y}" width="${Math.max(1, X(range.d5.hi) - X(range.d5.lo)).toFixed(1)}" height="${h}" rx="3"/>
    <line class="cn-mid" x1="${X(price).toFixed(1)}" y1="${y - 5}" x2="${X(price).toFixed(1)}" y2="${y + h + 5}"/>
    <circle class="cn-px" cx="${X(price).toFixed(1)}" cy="${y + h / 2}" r="3.4"/>
  </svg>`;
}

function scenarioRows(scenarios) {
  return scenarios
    .map((x) => {
      const cls = x.key === "down" ? "dn" : x.key === "up" ? "up" : "mid";
      return `<div class="sc">
        <div class="sc-top">
          <b class="${cls}">${esc(x.label)}</b>
          <span class="sc-p">${x.probPct}%</span>
          <span class="sc-t">${num(x.targetUsd, 0)}<em>$/oz</em></span>
        </div>
        <div class="sc-bar"><i class="${cls}" style="width:${Math.max(2, x.probPct)}%"></i></div>
        <div class="sc-c">${esc(x.cond)}</div>
      </div>`;
    })
    .join("");
}

export function renderBriefing(s) {
  const box = $("m0");
  if (!box) return;
  const t = s.technical || {};
  const o = s.outlook || null;
  const B = s.B || {};
  const chips = [
    `<span class="chip">技术面 ${t.headline ? esc(t.headline) : "--"}</span>`,
    `<span class="chip">评级 ${B.rating ? esc(ratingZh(B.rating.label)) : "未评级"}</span>`,
    `<span class="chip">宏观 ${s.C && s.C.mode === "risk_off" ? "避险" : esc((s.C && s.C.label) || "--")}</span>`,
    t.score != null ? `<span class="chip">指标得分 ${t.score}</span>` : "",
    s.meta && s.meta.staleB ? `<span class="chip bad">外部行情陈旧 · 判断作废</span>` : "",
    s.meta && s.meta.staleA ? `<span class="chip warn">账户数据陈旧</span>` : "",
    s.meta && s.meta.degraded ? `<span class="chip bad">源异常</span>` : "",
  ].filter(Boolean).join("");

  /* ── 降级：不装样子。只说明为什么不出结论，不摆情景与概率 ── */
  if (!o || !o.ok) {
    const why = (o && o.reason) || "外部指标尚未就绪，本次不出趋势与区间结论";
    box.innerHTML = `<section class="bubble rise">
      <div class="b-head">
        <span class="tag">AI 研判</span>
        <span class="sep"></span>
        <time>${fmtTime(s.now, true)} · 外部指标融合</time>
      </div>
      <div class="bl-top"><span class="bl-stance gray">降级</span><span class="bl-meta">不出方向 · 不给区间</span></div>
      <p class="b-text">${esc(why)}。判断链需要「行情可用 + 指标就绪」两条同时成立，缺一条就宁可不说。</p>
      <div class="b-foot">${chips}</div>
    </section>`;
    return;
  }

  const price = o.priceUsd;
  const dirZh = t.scenario === "risk_off" ? "避险" : DIR_ZH[o.dir < 0 ? "down" : o.dir > 0 ? "up" : "flat"];
  const strength = o.score == null ? "—" : Math.abs(o.score - 50) >= 35 ? "强" : Math.abs(o.score - 50) >= 20 ? "中" : "弱";
  const tone = t.scenario === "risk_off" ? "violet" : toneOfDir(o.dir);
  const badge = BADGE[t.conf] || BADGE.degraded;

  /* 一句人话：先给「现在在哪」，再给「接下来大概率怎么走」，最后给「所以怎么做」 */
  const rsi = B.indicators ? B.indicators.rsi14 : null;
  const devTxt =
    B.devPct == null ? "MA20 偏离不可测"
      : Math.abs(B.devPct) < 0.05 ? "贴住 MA20"
        : `比 MA20 ${B.devPct > 0 ? "高" : "低"} ${Math.abs(B.devPct).toFixed(2)}%`;
  const trendWord = o.trend[0] && o.trend[1]
    ? o.trend[0].dir !== 0 && o.trend[0].dir === o.trend[1].dir
      ? `短线与中线同向${o.trend[0].dir > 0 ? "走强" : "走弱"}`
      : "短中期方向不一致，属于分歧市"
    : "多周期不可测";
  const rngTxt = o.range.d5
    ? `未来 ${o.horizon} 个交易日 68% 概率落在 ${num(o.range.d5.lo, 0)}–${num(o.range.d5.hi, 0)} $/oz（模型值，非保证）`
    : "波动率不可测，本期不给区间";
  const hour = new Date(s.now).getHours();
  const greet = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const body = `${greet}。伦敦金现 {{P}} $/oz，${devTxt}，RSI14 ${rsi == null ? "--" : num(rsi, 1)}；${trendWord}。${rngTxt}。${o.stance.text}。`;

  const trendRows = o.trend
    .map(
      (x) => `<div class="tr">
        <span class="tr-h">${esc(x.h)}</span>
        <span class="tr-d ${toneOfDir(x.dir)}">${esc(x.text)}</span>
        <span class="tr-b">${esc(x.basis)}</span>
      </div>`,
    )
    .join("");

  const inv = o.invalidate
    .map(
      (x) => `<div class="inv-i">
        <span class="inv-m ${x.met ? "on" : ""}">${x.met ? "已触发" : "未触发"}</span>
        <span class="inv-t">${esc(x.text)}</span>
      </div>`,
    )
    .join("");

  box.innerHTML = `<section class="bubble rise">
    <div class="b-head">
      <span class="tag">AI 研判</span>
      <span class="sep"></span>
      <time>${fmtTime(s.now, true)} · 外部指标融合</time>
      <span class="bl-badge ${badge.cls}">置信 ${badge.text}</span>
    </div>

    <div class="bl-top">
      <span class="bl-stance ${tone}">${esc(dirZh)} · ${strength}</span>
      <span class="bl-meta">未来 ${o.horizon} 个交易日 · ${esc(o.regime ? o.regime.label : "")}</span>
    </div>

    <p class="b-text">${esc(body).replace("{{P}}", `<span id="brief-spot">${num(price)}</span>`)}</p>

    <div class="trend-row">${trendRows}</div>

    <div class="ly-wrap">
      <div class="sec-h">四层依据<span class="sec-n">净票 = 多票 − 空票</span></div>
      ${layerRows(o.layers)}
    </div>

    ${o.range.d5
      ? `<div class="cone">
          <div class="sec-h">未来 ${o.horizon} 个交易日波动区间<span class="sec-n">σ₁ ${num(o.range.sigma1Pct, 2)}% · ${o.range.src === "atr" ? "ATR 换算" : "20 日实测"}</span></div>
          ${coneSvg(o.range, price)}
          <div class="cone-f">
            <span>${num(o.range.d5.lo, 0)}</span>
            <span class="mid">${num(price, 0)}<em>现价</em></span>
            <span>${num(o.range.d5.hi, 0)}</span>
          </div>
          <div class="cone-n">内带 = 1σ（68%），浅带 = 2σ（95%）</div>
        </div>`
      : ""}

    ${o.scenarios.length
      ? `<div class="scen">
          <div class="sec-h">三情景<span class="sec-n">按得分偏移切分 · 概率为模型值</span></div>
          ${scenarioRows(o.scenarios)}
        </div>`
      : ""}

    ${inv
      ? `<div class="inv">
          <div class="sec-h">什么会推翻它</div>
          ${inv}
        </div>`
      : ""}

    <div class="b-foot">${chips}</div>
  </section>`;
}

/* ───────────────── M1 宏观与双轨雷达 ───────────────── */
export function renderRadar(s) {
  const box = $("m1");
  if (!box) return;
  const C = s.C || { items: [] };
  const B = s.B || {};
  const t = s.technical || {};

  const pills = (C.items || [])
    .map((it) => {
      const dir = it.dir;
      const cls = dir > 0 ? "up" : dir < 0 ? "dn" : "flat";
      const arrow = dir > 0 ? "↑" : dir < 0 ? "↓" : "→";
      const zh = it.label || macroZh(it.key);
      return `<div class="pill"><span class="k">${esc(zh)}<em>${esc(it.key)}</em></span><span class="v ${cls}">${it.value != null ? num(it.value, it.digits) : "--"}<span style="font-size:9px;opacity:.7">${arrow}</span></span></div>`;
    })
    .join("");

  const intlPrice = B.ok ? num(B.priceUsdOz) : "--";
  /* 15 秒实时通道视图：涨跌幅与时效能单点更新，整块渲染时也用同一份口径，避免两处数字打架 */
  const spot = spotTickView(s);
  const rateLbl = B.ok && B.rating ? ratingZh(B.rating.label) : "未评级";
  const rateCls = B.ok && B.rating ? (B.rating.score >= 55 ? "buy" : B.rating.score <= 45 ? "sell" : "mid") : "mid";

  /* 宏观数据时刻：CNBC 实时源带 last_time；回退到 FRED/CBOE 时只有日期。
     用最旧的一项判滞后（保守），显示最新的一项时刻（用户要看的是「多久前的数据」）。 */
  const times = (C.times) || {};
  const tss = ["dxy", "tnx", "vix"]
    .map((k) => Date.parse(times[k] || ""))
    .filter((x) => Number.isFinite(x) && x > 0);
  const newestTs = tss.length ? Math.max(...tss) : null;
  const oldestTs = tss.length ? Math.min(...tss) : null;
  const macroLate = oldestTs != null && s.now - oldestTs > 60 * 60 * 1000;
  let macroAt = "";
  if (newestTs != null) {
    const mins = Math.max(0, (s.now - newestTs) / 60000);
    macroAt = `数据 ${fmtTime(newestTs)} · ${ageText(mins)}${macroLate ? " · 源滞后" : ""}`;
  } else {
    const dl = ["dxy", "tnx", "vix"].map((k) => ((C.dates) || {})[k]).filter(Boolean).sort();
    if (dl.length) macroAt = `数据日期 ${dl[dl.length - 1]} · 源为日频，非实时`;
  }

  const domPrice = s.priceCnyGram != null ? num(s.priceCnyGram) : "--";
  const techTxt = t.headline || "外部判断未就绪";
  const techCls = t.dir < 0 ? "sell" : t.dir > 0 ? "buy" : "mid";
  const techScore = t.score != null ? `得分 ${t.score}` : "";

  const p = s.premium || {};
  const premCls = p.frozen ? "prem frozen" : "prem";
  const premTxt =
    p.value == null
      ? `<span>国内溢价 <b style="color:var(--tx-3)">--</b></span><span style="color:var(--tx-3)">缺少国内参考价</span>`
      : `<span>国内溢价 <b style="color:${p.value > 0 ? "var(--red)" : "var(--green)"}">${pct(p.value)}</b></span>
         <span style="color:var(--tx-3);font-size:10.5px">国内参考 ${num(p.ref)} / 国际折算 ${num(p.intl)}</span>`;

  box.innerHTML = `<section class="card rise" data-tone="${C.mode === "risk_off" ? "violet" : "gray"}">
    <div class="c-head"><span class="c-no">01</span><span class="c-title">宏观与双轨雷达</span>
      ${C.mode === "risk_off" ? `<span class="badge b-low" style="margin-left:auto">避险模式</span>` : C.panic ? `<span class="badge b-low" style="margin-left:auto">恐慌区</span>` : ""}
    </div>
    <div class="pills">${pills || `<div class="pill"><span class="k">宏观</span><span class="v flat">--</span></div>`}</div>
    ${macroAt ? `<div class="macro-at${macroLate ? " late" : ""}">${esc(macroAt)}</div>` : ""}
    <div class="dual">
      <div>
        <div class="lbl"><span>国际 · XAUUSD</span><span id="spot-chg" class="spot-chg ${spot.chgTone}">${esc(spot.chgText)}</span></div>
        <div class="big"><span id="spot-price">${intlPrice}</span><span class="unit">$/oz</span></div>
        <div class="sub"><span class="sig ${rateCls}">${esc(rateLbl)}</span>${B.ok ? `<span style="color:var(--tx-3)">MA20 ${num(B.ma20UsdOz)}</span>` : ""}</div>
      </div>
      <div>
        <div class="lbl">国内 · 折算克价</div>
        <div class="big">${domPrice}<span class="unit">元/克</span></div>
        <div class="sub"><span class="sig ${techCls}">${esc(techTxt)}</span>${techScore ? `<span style="color:var(--tx-3)">${techScore}</span>` : ""}</div>
      </div>
    </div>
    <div class="spot-at${spot.live ? " live" : ""}" id="spot-at">${esc(spot.atText)}</div>
    <div class="${premCls}">
      ${premTxt}
      ${p.frozen ? `<span class="lock">已冻结</span>` : ""}
    </div>
  </section>`;
}

/* ── 价格位置尺：把均线 / 布林 / 20 日高低排成一列，现价插在中间 ──
   为什么不用横向刻度：黄金的均线常常挤在 1–2% 的区间里，横轴标签必然打架；
   纵列按价格排序，挤在一起也能一行一行读清。 */
function priceRuler(B, price) {
  const ind = B.indicators || {};
  const ma = ind.ma || {};
  const boll = ind.boll || {};
  const closes = (Array.isArray(B.closes) ? B.closes : []).map(Number).filter((v) => Number.isFinite(v));
  const win = closes.slice(-20);
  const cand = [
    ["MA50", ma.ma50, "均线"],
    ["MA20", ma.ma20, "均线"],
    ["MA10", ma.ma10, "均线"],
    ["MA5", ma.ma5, "均线"],
    ["布林上轨", boll.upper, "通道"],
    ["布林下轨", boll.lower, "通道"],
    ["20 日高", win.length ? Math.max(...win) : null, "区间"],
    ["20 日低", win.length ? Math.min(...win) : null, "区间"],
  ]
    .map(([label, v, src]) => ({ label, v: Number(v), src }))
    .filter((x) => Number.isFinite(x.v) && x.v > 0)
    .filter((x) => Math.abs(x.v / price - 1) > 0.0008);

  /* 同价位去重（0.15% 内），留先出现的 */
  const uniq = [];
  for (const x of cand) {
    if (uniq.some((y) => Math.abs(y.v / x.v - 1) * 100 < 0.15)) continue;
    uniq.push(x);
  }
  const now = `<div class="mr-row now">
    <span class="mr-px">${num(price, 1)}</span>
    <span class="mr-k">现价</span>
    <span class="mr-d">—</span>
  </div>`;
  /* 现价插到正确的价格位置：上方阻力在前，下方支撑在后 */
  const above = uniq.filter((x) => x.v > price).sort((a, b) => a.v - b.v);
  const below = uniq.filter((x) => x.v < price).sort((a, b) => b.v - a.v);
  const rowOf = (x) => {
    const d = (x.v / price - 1) * 100;
    return `<div class="mr-row ${x.v > price ? "res" : "sup"}">
      <span class="mr-px">${num(x.v, 1)}</span>
      <span class="mr-k">${esc(x.label)}</span>
      <span class="mr-d">${d > 0 ? "+" : ""}${num(d, 1)}%</span>
    </div>`;
  };
  return `<div class="ma-ruler">
    <div class="mr-rail"></div>
    ${above.reverse().map(rowOf).join("")}
    ${now}
    ${below.map(rowOf).join("")}
  </div>`;
}

/* ── 因子贡献：得分 13 是怎么来的，一条一条摆出来 ── */
function factorRows(signals) {
  const voted = (signals || []).filter((x) => x.weight > 0 && x.dir !== 0);
  if (!voted.length) return "";
  const max = Math.max(...voted.map((x) => Math.abs(x.contrib != null ? x.contrib : x.dir * x.weight)));
  return voted
    .map((x) => {
      const c = x.contrib != null ? x.contrib : x.dir * x.weight;
      const w = Math.min(50, (Math.abs(c) / max) * 50);
      const cls = c > 0 ? "pos" : "neg";
      const side = c >= 0 ? `left:50%;width:${w.toFixed(1)}%` : `right:50%;width:${w.toFixed(1)}%`;
      return `<div class="fx" data-f="${esc(x.key)}">
        <span class="fx-k">${esc(x.label)}</span>
        <span class="fx-bar"><i class="${cls}" style="${side}"></i></span>
        <span class="fx-v ${cls}">${c > 0 ? "+" : ""}${num(c, 1)}</span>
      </div>`;
    })
    .join("");
}

/* ── RSI 刻度：30 / 70 两条线必须有，否则「33.5」读者没有参照 ── */
function rsiGauge(B) {
  const rsi = B.indicators ? Number(B.indicators.rsi14) : NaN;
  if (!Number.isFinite(rsi)) return "";
  const X = (v) => (Math.max(0, Math.min(100, v)) / 100) * 300;
  const tone = rsi >= 70 ? "hot" : rsi <= 30 ? "cold" : "mid";
  const note = rsi >= 70 ? "超买区" : rsi <= 30 ? "超卖区，仍在下行" : rsi > 50 ? "偏强区" : "偏弱区";
  return `<div class="rsi-gauge">
    <div class="rg-top"><span class="rg-k">RSI14</span><b class="${tone}">${num(rsi, 1)}</b><span class="rg-n">${note}</span></div>
    <svg class="rg-svg" viewBox="0 0 300 14" preserveAspectRatio="none" aria-hidden="true">
      <rect class="rg-bg" x="0" y="5" width="300" height="4" rx="2"/>
      <rect class="rg-cold" x="0" y="5" width="${X(30)}" height="4" rx="2"/>
      <rect class="rg-hot" x="${X(70)}" y="5" width="${300 - X(70)}" height="4" rx="2"/>
      <line class="rg-mark" x1="${X(rsi)}" y1="1" x2="${X(rsi)}" y2="13"/>
    </svg>
    <div class="rg-l">
      ${[[0, 0], [30, 30], [50, 50], [70, 70], [100, 100]]
        .map(([v, p]) => `<span style="left:${p}%${p === 0 ? ";transform:none" : p === 100 ? ";transform:translateX(-100%)" : ""}">${v}</span>`)
        .join("")}
    </div>
  </div>`;
}

/* ───────────────── M2 外部技术面决策 ───────────────── */
export function renderDecision(s) {
  const box = $("m2");
  if (!box) return;
  const t = s.technical || {
    scenario: "degraded", conf: "degraded", tone: "gray", dir: 0, score: null,
    headline: "外部指标不可用", text: "外部行情指标尚未就绪，本次不出方向结论，请稍后刷新。", detail: "", signals: [],
  };
  const badge = BADGE[t.conf] || BADGE.degraded;
  const B = s.B || {};
  const price = Number(B.priceUsdOz);

  const cells = (t.signals || [])
    .map((it) => {
      const cls = it.kind === "change"
        ? (it.dir > 0 ? "chg-up" : it.dir < 0 ? "chg-dn" : "flat")
        : (it.dir > 0 ? "bull" : it.dir < 0 ? "bear" : "flat");
      return `<div class="tc"><div class="k">${esc(it.label)}</div><div class="v ${cls}">${esc(it.value)}</div><div class="n">${esc(it.note)}</div></div>`;
    })
    .join("");

  const strip =
    t.scenario === "degraded" || t.scenario === "risk_off"
      ? `<div class="alert-strip ${t.scenario === "risk_off" ? "warn" : "gray"}">${ico.warn}<span>${esc(t.text)}</span></div>`
      : `<p class="note">${esc(t.text)}</p>`;

  const factors = factorRows(t.signals);
  const ruler = Number.isFinite(price) && price > 0 && B.indicators ? priceRuler(B, price) : "";
  const rsi = rsiGauge(B);

  box.innerHTML = `<section class="card rise" data-tone="${t.tone}">
    <div class="c-head"><span class="c-no">02</span><span class="c-title">外部技术面决策</span>
      <span class="badge ${badge.cls}">置信 ${badge.text}</span>
    </div>
    <div class="verdict"><div class="hl ${t.tone}">${esc(t.headline)}</div></div>
    ${ruler ? `<div class="sec-h">价格位置<span class="sec-n">均线 · 通道 · 20 日区间</span></div>${ruler}` : ""}
    ${cells ? `<div class="tech-grid">${cells}</div>` : `<div class="deg">${ico.info}<span>外部指标清单暂不可用</span></div>`}
    ${factors ? `<div class="sec-h">因子贡献<span class="sec-n">权重 × 方向，右多左空</span></div><div class="factors">${factors}</div>` : ""}
    ${rsi}
    ${strip}
    ${t.detail ? `<div style="margin-top:8px"><span class="chip">${esc(t.detail)}</span></div>` : ""}
  </section>`;
}

/* ───────────────── M3 账户真实体检（账户事实，保留） ───────────────── */
export function renderAccount(s) {
  const box = $("m3");
  if (!box) return;
  const r = s.risk;
  const pos = (s.A && s.A.position) || {};

  const pnlCls = r.pnlTone === "red" ? "red" : r.pnlTone === "green" ? "green" : "gray";
  const pnlShow = r.pnl == null ? "数据缺失" : `${r.pnl > 0 ? "+" : ""}${num(r.pnl)}`;

  const depleted = r.depleted;
  const stripCls = r.depletedTone === "amber" ? "warn" : r.depletedTone === "indigo" ? "calm" : "gray";

  box.innerHTML = `<section class="card rise" data-tone="${r.depletedTone}">
    <div class="c-head"><span class="c-no">03</span><span class="c-title">账户真实体检</span>
      ${pos.grams != null ? `<span class="badge b-deg" style="margin-left:auto">${num(pos.grams)} g</span>` : ""}
    </div>
    <div class="pnl-wrap">
      <div class="pnl-cap">当前真实浮亏</div>
      <div class="pnl ${pnlCls}">${pnlShow}</div>
      <div class="pnl-sub">
        ${r.pnlPct != null ? `收益率 <b style="color:${r.pnlPct < 0 ? "var(--green)" : "var(--red)"}">${pct(r.pnlPct)}</b>` : "收益率 <b>--</b>"}
        <span style="color:var(--tx-3)"> | </span>
        均价 <b>${pos.avgCost != null ? num(pos.avgCost) : "--"}</b> 元/克
      </div>
    </div>
    <div class="grid2">
      <div>
        <div class="k">再跌 5%</div>
        <div class="v" style="color:var(--green)">${r.stressLoss != null ? `-${wan(r.stressLoss)} 万` : "--"}</div>
      </div>
      <div>
        <div class="k">剩余可买（按持仓上限）</div>
        <div class="v">${r.remainingGrams != null ? `${num(r.remainingGrams)} <span class="mini">克</span>` : "--"}</div>
      </div>
    </div>
    <div class="src-note">持仓上限 ${r.capGrams != null ? num(r.capGrams) : "--"} 克 − 已持克重估算；为计划参数派生值，非账户余额</div>
    <div class="alert-strip ${stripCls}">
      ${depleted ? ico.warn : ico.info}
      <span>${esc(r.depletedText)}</span>
    </div>
  </section>`;
}

/* ───────────────── M4 网格效率与熔断 ───────────────── */
/* v2.7.0：档位表与老应用同口径（价 / 计划克重 / 待补 / 距现价），
   每档都是 button，点开看该档分配了多少克、多少钱 —— 用户此前只能看到一根柱子。 */
export function renderGrid(s) {
  const box = $("m4");
  if (!box) return;
  const g = s.grid;
  const fuse = g.fuse;
  const barTone = fuse ? "amber" : g.tone;
  const openIdx = Number.isInteger(g.openIdx) ? g.openIdx : -1;

  const levels = g.levels || [];
  const rows = levels
    .map((lv, idx) => {
      const open = idx === openIdx;   // openIdx 是数组下标（0 起），与 data-lv（1 起）差 1
      const cls = ["lv-row", lv.isNext ? "next" : "", lv.boughtGrams > 0 ? "on" : "", open ? "open" : ""]
        .filter(Boolean)
        .join(" ");
      const gd = lv.planGrams != null && Number.isInteger(lv.planGrams) ? 0 : 2;
      const grams = lv.planGrams != null ? `${num(lv.planGrams, gd)} 克` : "--";
      const dist = lv.distPct != null ? pct(lv.distPct, 1) : "--";
      const detail = open
        ? `<div class="lv-detail" id="lv-d-${lv.i}">
            <div class="kv"><span>该档计划</span><b>${num(lv.planGrams, 2)} 克</b></div>
            <div class="kv"><span>已补 / 待补</span><b>${num(lv.boughtGrams, 2)} / ${num(lv.pendingGrams, 2)} 克</b></div>
            <div class="kv"><span>该档金额</span><b>${lv.amountCny != null ? `¥${(lv.amountCny / 10000).toFixed(2)} 万` : "--"}${lv.amountUsd != null ? `<i class="mini">≈ $${lv.amountUsd}</i>` : ""}</b></div>
            <div class="kv"><span>距现价</span><b>${dist}</b></div>
            <div class="kv"><span>触发价</span><b>${num(lv.priceUsd, 1)} $/oz${lv.priceCny != null ? `<i class="mini">¥${num(lv.priceCny, 2)}/克</i>` : ""}</b></div>
          </div>`
        : "";
      return `<button type="button" class="${cls}" data-lv="${lv.i}" aria-expanded="${open ? "true" : "false"}" aria-controls="lv-d-${lv.i}">
          <span class="lv-no">${lv.i}</span>
          <span class="lv-px">${num(lv.priceUsd, 1)}</span>
          <span class="lv-g">${grams}</span>
          <span class="lv-dp">${dist}</span>
          <svg class="lv-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        </button>${detail}`;
    })
    .join("");

  const nextLv = levels.find((lv) => lv.isNext);
  const nextTxt = nextLv
    ? `下一档 第${nextLv.i}档 ${num(nextLv.priceUsd, 1)} · 待补 ${num(nextLv.pendingGrams, 2)} 克`
    : levels.length
      ? "现价已在最低档下方或各档均已买满"
      : "";

  /* 口径行：把「档距怎么来的」写在卡面上，用户能拿它跟老应用设置页逐项核 */
  const modeTxt =
    g.mode === "alpha"
      ? `α ${num(g.alpha, 2)} × ATR14 ${num(g.atrBase, 2)} $/oz`
      : g.mode === "target"
        ? `目标 ${num(g.target, 0)} 反解 · 前段重心 ${num(g.targetEff != null ? g.targetEff : g.target, 0)}${g.spanSrc === "target-fallback" ? "（目标不可达，回退 α）" : ""}`
        : `起 ${num(g.startDrop, 0)}% → 止 ${num(g.endDrop, 1)}% 均分`;
  const clampTxt = g.clamped ? ` · 已按终止跌幅夹到 ${num(g.capD, 1)}` : "";
  const budgetTxt =
    g.budget != null
      ? ` · 可分配 ${num(g.budget, 2)} 克${g.unmarked ? `（已扣未标档 ${num(g.unmarked, 1)} 克）` : ""}`
      : "";

  /* v2.8.0：熔断条只说「等转为中性」，没给门槛。这里按用户要求，
     在提醒条下方把「空 / 中性 / 多」的成立条件逐条列出来并打 ✔ / ✗。 */
  const L = g.ladder;
  const ladderBlock = L && Array.isArray(L.tiers) && L.tiers.length
    ? `<div class="tech-ladder">
        <div class="tl-head">
          <span class="tl-title">技术面三档成立条件</span>
          <span class="tl-sum">${esc(L.summary || "")}</span>
        </div>
        ${L.tiers
          .map(
            (tier) => `<div class="tl-tier ${tier.active ? "on" : ""}">
          <div class="tl-trow">
            <span class="tl-name">${esc(tier.label)}</span>
            <span class="tl-flag">${tier.active ? "成立" : "不成立"}</span>
          </div>
          ${(tier.conds || [])
            .map(
              (c) => `<div class="cond ${c.ok ? "ok" : "no"}" data-k="${c.id === "score" ? "gate" : "pre"}">
            ${c.ok ? COND_ICO.ok : COND_ICO.no}
            <span class="cond-t">${esc(c.text)}</span>${c.note ? `<span class="cond-n">${esc(c.note)}</span>` : ""}
          </div>`,
            )
            .join("")}
        </div>`,
          )
          .join("")}
        ${L.hint ? `<div class="tl-hint">${esc(L.hint)}</div>` : ""}
      </div>`
    : "";

  box.innerHTML = `<section class="card rise ${fuse ? "fuse" : ""}" data-tone="${barTone}">
    <div class="c-head"><span class="c-no">04</span><span class="c-title">网格效率与熔断</span>
      ${fuse ? `<span class="badge b-high" style="margin-left:auto">熔断</span>` : g.ratioPct != null ? `<span class="badge ${g.ratioPct < 70 ? "b-low" : "b-deg"}" style="margin-left:auto">${g.ratioPct}%</span>` : ""}
    </div>
    <div class="rows">
      <div class="row"><span class="k">外部 ATR14</span><span class="v">${g.atrCny != null ? `${num(g.atrCny)} <span class="mini">元/克</span>` : "--"}</span></div>
      <div class="row"><span class="k">当前档距</span><span class="v">${g.spacingCny != null ? `${num(g.spacingCny)} <span class="mini">元/克</span>` : "--"}</span></div>
      <div class="row"><span class="k">ATR / 档距</span><span class="v" style="color:var(--tx-2);font-size:11px">${g.ratioPct != null ? `${g.ratioPct}%` : "--"}${g.gearCount ? `<span class="mini"> · ${g.gearCount} 档 · 高点 ${g.highBase}</span>` : ""}</span></div>
    </div>
    ${g.mode ? `<div class="lv-mode">口径 ${esc(modeTxt)} · 档距 ${num(g.spacingUsd, 1)} $/oz${esc(clampTxt)}${esc(budgetTxt)}</div>` : ""}
    ${rows ? `<div class="lv-list" role="list">${rows}</div>` : `<div class="deg">${ico.info}<span>${esc(g.text)}</span></div>`}
    ${nextTxt ? `<div class="lv-next">${esc(nextTxt)}</div>` : ""}
    <div class="alert-strip ${fuse || g.tone === "amber" ? "warn" : "gray"}">
      ${fuse ? ico.warn : ico.info}
      <span>${esc(g.text)}</span>
    </div>
    ${ladderBlock}
  </section>`;
}

/* ───────────────── M5 多账户再平衡（账户事实，保留） ───────────────── */
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
    <div class="alert-strip ${d.state === "violation" ? "warn" : "calm"}">
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
    bits.push(`账户数据 ${s.meta.aOk ? "ok" : "失败"}`);
    bits.push(`外部行情 ${s.meta.bOk ? (String(s.B.spotSource || "").startsWith("tencent:") ? "15 秒实时" : "快照") : "失败"}`);
    bits.push(`宏观 ${s.meta.cOk ? "ok" : "失败"}`);
    bits.push(`汇率 ${s.meta.fx ? Number(s.meta.fx).toFixed(4) : "--"}${s.meta.fxFallback ? "(兜底)" : ""}`);
    const ageText = (min) => {
      if (min == null) return "--";
      return min < 60 ? `${min} 分钟前` : `${(min / 60).toFixed(1)} 小时前`;
    };
    bits.push(`源数据 ${ageText(s.meta.dataAgeMin)}`);
    if (s.meta.syncAgeMin != null) bits.push(`账户快照 ${ageText(s.meta.syncAgeMin)}${s.meta.staleA ? "（陈旧）" : ""}`);
    if (s.meta.staleB) bits.push("外部行情陈旧 · 判断作废");
    foot.textContent = bits.join("  ·  ");
  }
}

/* ───────────────── 价格单点刷新（15 秒 tick 专用） ─────────────────
   只改 4 个叶子节点，不重建卡片、不重放动画、不调任何其它渲染函数。
   这样 15 秒的高频更新不会打断阅读，也不会把决策卡刷得乱跳。 */
export function renderSpotTick(s) {
  const v = spotTickView(s);
  const price = $("spot-price");
  if (price) price.textContent = v.priceText;
  const chg = $("spot-chg");
  if (chg) {
    chg.textContent = v.chgText;
    chg.className = `spot-chg ${v.chgTone}`;
  }
  const at = $("spot-at");
  if (at) {
    at.textContent = v.atText;
    at.className = `spot-at${v.live ? " live" : ""}`;
  }
  const brief = $("brief-spot");
  if (brief) brief.textContent = v.priceText;
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
  renderSpotTick(s);
}

/* 降级兜底：全量失败时也要有内容，不白屏 */
export function renderFailSafe(err) {
  const app = $("app");
  if (!app) return;
  const msg = esc((err && err.message) || err || "未知错误");
  app.innerHTML = `<section class="bubble rise">
    <div class="b-head"><span class="tag">降级处理</span><time>本地兜底</time></div>
    <p class="b-text">外部行情指标读取失败，已切降级模式：${msg}。请检查网络后刷新。</p>
    <div class="b-foot"><span class="chip bad">源异常</span><span class="chip">不输出方向结论</span></div>
  </section>`;
}
