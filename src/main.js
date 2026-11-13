/**
 * main.js —— 唯一调度入口
 *
 * 调用链严格单向：init → refreshAll → (buildState → renderAll) → 副作用
 * 七个 render 函数之间零互调，任何交互都走 refreshAll 统一刷新。
 */
import { CONFIG } from "./config.js";
import { buildState } from "./app.js";
import { renderAll, renderFailSafe } from "./render.js";
import { VERSION } from "./version.js";

const $ = (id) => document.getElementById(id);
const HOOK_KEY = "xau_copilot_hook_url";
const FOMO_KEY = "xau_copilot_fomo_dismissed";

const ui = { state: null, timer: null, countdown: null, busy: false };

/* ── 骨架屏：只填充各容器内部，绝不替换容器本身（否则渲染层找不到挂载点） ── */
function paintSkeleton() {
  const sk = (h, w, mb = 7) => `<div class="skel" style="height:${h}px;width:${w};margin-bottom:${mb}px"></div>`;
  const m0 = $("m0");
  if (m0) {
    m0.innerHTML = `<section class="bubble"><div class="b-head"><span class="tag">AI 研判</span><time>加载中</time></div>${sk(16, "92%")}${sk(16, "64%", 0)}</section>`;
  }
  const titles = ["宏观雷达", "外部技术面", "账户体检", "网格效率", "再平衡", "纪律复盘"];
  titles.forEach((t, i) => {
    const el = $(`m${i + 1}`);
    if (!el) return;
    el.innerHTML = `<section class="card" style="--bar:#333">
      <div class="c-head"><span class="c-no">0${i + 1}</span><span class="c-title">${t}</span></div>
      ${sk(13, "74%")}${sk(13, "46%", 0)}</section>`;
  });
}

/* ── 统一刷新（唯一入口） ── */
async function refreshAll() {
  if (ui.busy) return;
  ui.busy = true;
  const dot = $("live-dot");
  if (dot) dot.className = "dot warn";
  try {
    const next = await buildState({});
    ui.state = next;
    renderAll(next);
    afterRender(next);
  } catch (e) {
    console.error("[copilot] refresh failed", e);
    renderFailSafe(e);
    if (dot) dot.className = "dot bad";
  } finally {
    ui.busy = false;
  }
}

/* ── 渲染后的副作用：FOMO 锁 + Webhook ── */
function afterRender(s) {
  maybeFomo(s);
  maybePush(s);
}

/* FOMO 锁：同日只弹一次，10 秒倒计时后才允许「强行买入」 */
function maybeFomo(s) {
  if (!s.risk || !s.risk.fomoLock) return;
  const today = new Date(s.now).toISOString().slice(0, 10);
  let dismissed = null;
  try {
    dismissed = localStorage.getItem(FOMO_KEY);
  } catch (_) {}
  if (dismissed === today) return;

  const modal = $("fomo");
  const txt = $("fomo-text");
  const cd = $("fomo-cd");
  const okBtn = $("fomo-ok");
  if (!modal || !txt || !cd || !okBtn) return;

  txt.textContent = s.risk.fomoText || "外部技术面偏空，今日仍有买入操作。是否确认强行买入？";
  modal.hidden = false;

  let left = s.risk.fomoCountdown || 10;
  okBtn.disabled = true;
  cd.innerHTML = `${left}<small>秒后可确认</small>`;
  if (ui.countdown) clearInterval(ui.countdown);
  ui.countdown = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(ui.countdown);
      ui.countdown = null;
      cd.innerHTML = `0<small>可确认</small>`;
      okBtn.disabled = false;
      return;
    }
    cd.innerHTML = `${left}<small>秒后可确认</small>`;
  }, 1000);

  const close = () => {
    modal.hidden = true;
    if (ui.countdown) clearInterval(ui.countdown);
    ui.countdown = null;
    try {
      localStorage.setItem(FOMO_KEY, today);
    } catch (_) {}
  };
  $("fomo-cancel").onclick = close;
  okBtn.onclick = () => close();
}

/* Webhook：外部技术面转空 / 转多 / 熔断时静默推一次，同日同事件去重 */
async function maybePush(s) {
  const url = (() => {
    try {
      return localStorage.getItem(HOOK_KEY) || CONFIG.webhookUrl || "";
    } catch (_) {
      return CONFIG.webhookUrl || "";
    }
  })();
  if (!url) return;

  const t = s.technical || {};
  const events = [];
  if (t.scenario === "tech_bear") events.push("TECH_BEAR");
  if (t.scenario === "tech_bull") events.push("TECH_BULL");
  if (t.scenario === "risk_off") events.push("RISK_OFF");
  if (s.grid && s.grid.fuse) events.push("GRID_FUSE");
  if (!events.length) return;

  const day = new Date(s.now).toISOString().slice(0, 10);
  for (const ev of events) {
    const key = `xau_copilot_hook_${ev}_${day}`;
    try {
      if (localStorage.getItem(key)) continue;
      localStorage.setItem(key, "1");
    } catch (_) {}
    const payload = {
      app: "XAU Copilot",
      event: ev,
      ts: new Date(s.now).toISOString(),
      price: s.B && s.B.priceUsdOz,
      ma20: s.B && s.B.ma20UsdOz,
      rating: s.B && s.B.rating ? s.B.rating.score : null,
      rsi14: s.B && s.B.indicators ? s.B.indicators.rsi14 : null,
      macro: s.C ? s.C.label : null,
      confidence: t.conf,
      headline: t.headline,
      techScore: t.score,
      pnl: s.risk ? s.risk.pnl : null,
    };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: ctl.signal,
          mode: "no-cors",
        });
      } finally {
        clearTimeout(t); // 成功或异常都必须释放超时器
      }
    } catch (e) {
      console.warn("[copilot] webhook 静默失败：", e.message);
    }
  }
}

/* ── 设置抽屉 ── */
function bindUI() {
  const drawer = $("drawer");
  const hookInput = $("set-hook");

  $("btn-refresh")?.addEventListener("click", () => refreshAll());

  $("btn-settings")?.addEventListener("click", () => {
    try {
      hookInput.value = localStorage.getItem(HOOK_KEY) || "";
    } catch (_) {}
    drawer.hidden = false;
  });

  $("drawer-close")?.addEventListener("click", () => {
    drawer.hidden = true;
  });
  drawer?.addEventListener("click", (e) => {
    if (e.target === drawer) drawer.hidden = true;
  });

  hookInput?.addEventListener("change", () => {
    const v = hookInput.value.trim();
    try {
      if (v) localStorage.setItem(HOOK_KEY, v);
      else localStorage.removeItem(HOOK_KEY);
    } catch (_) {}
  });

  $("btn-export")?.addEventListener("click", () => {
    if (!ui.state) return;
    const blob = new Blob([JSON.stringify(ui.state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `xau-copilot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("btn-clear")?.addEventListener("click", () => {
    if (!confirm("清除本地缓存（Webhook 配置与 FOMO 记录）？云端数据不受影响。")) return;
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("xau_copilot_"))
        .forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
    alert("已清除。");
  });

  // 页面重新可见时刷新（手机切回来不会看到过期数据）
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshAll();
  });
}

/* ── 启动 ── */
function init() {
  const ver = $("app-ver");
  if (ver) ver.textContent = `v${VERSION}`;
  paintSkeleton();
  bindUI();
  refreshAll();
  // 现价 60 秒刷新；页面隐藏时暂停，省电省流量
  ui.timer = setInterval(() => {
    if (document.visibilityState === "visible") refreshAll();
  }, 60 * 1000);

  // 页面卸载 / 进入 bfcache：清理全部定时器，防后台泄漏
  window.addEventListener("pagehide", () => {
    if (ui.timer) clearInterval(ui.timer);
    if (ui.countdown) clearInterval(ui.countdown);
    ui.timer = null;
    ui.countdown = null;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
