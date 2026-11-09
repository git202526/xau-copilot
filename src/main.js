/** main.js —— 唯一入口：load → paint → 静默推送。渲染函数之间不互调。 */
import { loadAll } from "./app.js";
import { paint } from "./render.js";
import { sendAlert } from "./webhook.js";

const HOOK_KEY = "xau_copilot_hook_url";
const state = { loading: false, last: null, timer: null };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("on"), 2200);
}

function failSafe(err) {
  document.body.classList.add("ready");
  const box = $("briefing");
  if (!box) return;
  box.innerHTML = `<section class="bubble rise" id="card-briefing">
    <div class="b-head"><span class="tag">降级处理</span><span class="sep"></span><time>本地兜底</time></div>
    <p class="b-text">源数据异常，降级处理：${esc((err && err.message) || err)}。页面未中断，点右上角刷新可重试。</p>
    <div class="b-foot"><span class="chip warn">降级模式</span><span class="chip">七张卡暂停</span></div>
  </section>`;
}

async function refreshAll(reason) {
  if (state.loading) return;
  state.loading = true;
  document.body.classList.add("is-loading");
  const btn = $("btn-refresh");
  if (btn) btn.disabled = true;
  try {
    const st = await loadAll({});
    state.last = st;
    paint(document, st);
    const hook = safeGet(HOOK_KEY);
    if (hook) {
      // 静默：失败不影响任何 UI
      sendAlert(st, { webhookUrl: hook, storage: localStorage }).catch(() => {});
    }
    if (reason === "manual") toast(st.meta.degraded.length ? "已刷新（降级模式）" : "已刷新");
  } catch (e) {
    failSafe(e);
  } finally {
    state.loading = false;
    document.body.classList.remove("is-loading");
    if (btn) btn.disabled = false;
  }
}

function safeGet(k) {
  try { return localStorage.getItem(k) || ""; } catch (_) { return ""; }
}
function safeSet(k, v) {
  try { localStorage.setItem(k, v); } catch (_) {}
}

function exportSnapshot() {
  if (!state.last) return toast("还没有可取的数据");
  const blob = new Blob([JSON.stringify(state.last, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `xau-copilot-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("已导出当前决策快照");
}

function boot() {
  const hook = $("hook-url");
  if (hook) hook.value = safeGet(HOOK_KEY);
  const btnHook = $("btn-hook");
  if (btnHook) btnHook.addEventListener("click", () => {
    const v = (hook.value || "").trim();
    if (v && !/^https?:\/\//i.test(v)) return toast("Webhook 需以 http(s):// 开头");
    safeSet(HOOK_KEY, v);
    toast(v ? "已保存，触发时静默推送" : "已清空 Webhook");
  });
  const bExp = $("btn-export");
  if (bExp) bExp.addEventListener("click", exportSnapshot);
  const bRe = $("btn-reload");
  if (bRe) bRe.addEventListener("click", () => refreshAll("manual"));
  const bRe2 = $("btn-refresh");
  if (bRe2) bRe2.addEventListener("click", () => refreshAll("manual"));

  refreshAll("boot");

  // 5 分钟自动刷新（可见时才拉，省流量）
  state.timer = setInterval(() => {
    if (document.visibilityState === "visible") refreshAll("auto");
  }, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshAll("auto");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
