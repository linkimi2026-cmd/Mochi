import type { RailSurface } from "./protocol";

/**
 * [Mochi 2026-09-18] 常驻条 / 喊人弹窗的自包含页面。
 *
 * 为什么是字符串而不是打包静态资源：
 * - 不走 Harness 静态路由，不需要新增 CSP 放行，也不需要进插件白名单与快照清单；
 * - 与 main.ts 里既有的启动页/错误页同一个路子（data: URL）。
 *
 * 安全约定：页面里显示的数据全部来自 renderer 经 IPC 送来的字符串，因此一律用
 * textContent 建 DOM，绝不拼 innerHTML。此文件不加载任何外部字体/脚本/图片。
 */

/** 两块屏共用的一套配色：深绿画布 + 纸白文字 + 琥珀强调（对齐 calm-tokens）。 */
const PALETTE = [
  "--mochi-canvas:#2a3931",
  "--mochi-canvas-raised:#33463c",
  "--mochi-line:rgba(255,255,255,.14)",
  "--mochi-paper:#f1f4ee",
  "--mochi-paper-dim:#b7c6bb",
  "--mochi-accent:#d9973e",
  "--mochi-ok:#67a879",
  "--mochi-bad:#d9776b",
].join(";");

const BASE_CSS = [
  "*{box-sizing:border-box}",
  "html,body{margin:0;block-size:100%;overflow:hidden;background:transparent}",
  "body{color:var(--mochi-paper);font:400 13px/1.5 'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',system-ui,sans-serif;-webkit-font-smoothing:antialiased}",
  ".drag{-webkit-app-region:drag}",
  ".nodrag{-webkit-app-region:no-drag}",
  ".shell{display:flex;flex-direction:column;block-size:100%;border:1px solid var(--mochi-line);border-radius:14px;overflow:hidden;background:var(--mochi-canvas)}",
  "header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-block-end:1px solid var(--mochi-line);background:var(--mochi-canvas-raised)}",
  "header h1{margin:0;font-size:14px;font-weight:500}",
  ".count{margin-inline-start:auto;padding:1px 8px;border-radius:999px;background:var(--mochi-accent);color:#1d2a23;font-size:11px;font-weight:500}",
  "button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid var(--mochi-line);background:transparent;color:var(--mochi-paper)}",
  "button:focus-visible{outline:2px solid var(--mochi-accent);outline-offset:1px}",
  ".icon{inline-size:22px;block-size:22px;padding:0;line-height:1;font-size:15px;flex:none}",
  ".list{flex:1;min-block-size:0;overflow:auto;padding:8px;display:grid;gap:6px;align-content:start}",
  ".row{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:start;padding:8px 9px;border:1px solid var(--mochi-line);border-radius:11px;background:var(--mochi-canvas-raised);cursor:pointer}",
  ".row:hover{border-color:var(--mochi-paper-dim)}",
  ".row[data-tone='attention']{border-color:rgba(217,151,62,.55)}",
  ".row[data-tone='ok']{border-color:rgba(103,168,121,.5)}",
  ".row[data-tone='bad']{border-color:rgba(217,119,107,.6)}",
  ".seq{inline-size:20px;block-size:20px;border-radius:6px;display:grid;place-items:center;background:rgba(255,255,255,.1);font-size:11px;font-weight:500}",
  ".row[data-tone='attention'] .seq{background:var(--mochi-accent);color:#1d2a23}",
  ".row[data-tone='bad'] .seq{background:var(--mochi-bad);color:#2a1a18}",
  ".row[data-tone='ok'] .seq{background:var(--mochi-ok);color:#16241b}",
  ".name{font-weight:500;overflow-wrap:anywhere}",
  ".meta{margin-block-start:1px;color:var(--mochi-paper-dim);font-size:11px;overflow-wrap:anywhere}",
  ".note{margin-block-start:3px;color:var(--mochi-paper);font-size:12px;overflow-wrap:anywhere}",
  ".badge{align-self:start;padding:2px 7px;border-radius:999px;font-size:11px;background:rgba(255,255,255,.1);white-space:nowrap}",
  ".row[data-tone='attention'] .badge{background:rgba(217,151,62,.22);color:#f0c78c}",
  ".row[data-tone='bad'] .badge{background:rgba(217,119,107,.24);color:#f0b3aa}",
  ".row[data-tone='ok'] .badge{background:rgba(103,168,121,.24);color:#a9d8b8}",
  ".empty{margin:auto;padding:14px;color:var(--mochi-paper-dim);font-size:12px;text-align:center}",
  "footer{display:flex;align-items:center;gap:8px;padding:7px 10px;border-block-start:1px solid var(--mochi-line);color:var(--mochi-paper-dim);font-size:11px}",
  "footer .grow{margin-inline-start:auto}",
  "footer button{padding:4px 10px;font-size:11px}",
  "@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}",
].join("");

/** 教室屏要给一整个班看，整体放大一档、对比更高。 */
const BOARD_CSS = [
  "body{font-size:15px}",
  "header h1{font-size:17px}",
  ".row{padding:11px 12px}",
  ".seq{inline-size:26px;block-size:26px;font-size:13px}",
  ".name{font-size:16px}",
  ".meta{font-size:13px}",
  ".note{font-size:14px}",
  ".badge{font-size:12px}",
].join("");

const POPUP_CSS = [
  "body{font-size:14px}",
  ".pop{display:flex;flex-direction:column;block-size:100%;border:1px solid rgba(217,151,62,.55);border-radius:16px;overflow:hidden;background:var(--mochi-canvas)}",
  ".pop__bar{display:flex;align-items:center;padding:9px 12px;background:var(--mochi-accent);color:#231a0d;font-size:12px;font-weight:500}",
  ".pop__body{flex:1;min-block-size:0;display:flex;flex-direction:column;justify-content:center;gap:7px;padding:18px}",
  ".pop__title{margin:0;font-size:22px;font-weight:500}",
  ".pop__subject{font-size:17px;font-weight:500;overflow-wrap:anywhere}",
  ".pop__detail{color:var(--mochi-paper-dim);font-size:13px;overflow-wrap:anywhere}",
  ".pop__actions{display:flex;gap:8px;padding:0 18px 16px}",
  ".pop__actions button{padding:9px 14px;font-size:13px}",
  ".pop__actions .primary{background:var(--mochi-accent);border-color:var(--mochi-accent);color:#231a0d;font-weight:500}",
].join("");

/** 页面里最小的一层工具函数。刻意不用模板字符串，避免与外层字符串冲突。 */
const PAGE_HELPERS = [
  "var bridge = window.mochiRail || null;",
  "function el(tag, className, value){",
  "  var node = document.createElement(tag);",
  "  if (className) node.className = className;",
  "  if (value !== undefined && value !== null) node.textContent = String(value);",
  "  return node;",
  "}",
  "function pad(n){ return String(n).padStart(2, '0'); }",
  "function stamp(value){",
  "  var ms = Date.parse(String(value || ''));",
  "  if (!isFinite(ms)) return '';",
  "  var d = new Date(ms);",
  "  return pad(d.getHours()) + ':' + pad(d.getMinutes());",
  "}",
  "function act(action){ if (bridge && bridge.act) bridge.act(action); }",
].join("\n");

const RAIL_SCRIPT = [
  PAGE_HELPERS,
  "var SURFACE = document.body.dataset.surface;",
  "function renderRow(row){",
  "  var node = el('article', 'row');",
  "  node.dataset.tone = row.tone;",
  "  node.appendChild(el('span', 'seq', row.seq));",
  "  var main = el('div');",
  "  main.appendChild(el('div', 'name', row.name));",
  "  if (row.meta) main.appendChild(el('div', 'meta', row.meta));",
  "  if (row.note) main.appendChild(el('div', 'note', row.note));",
  "  node.appendChild(main);",
  "  if (row.badge) node.appendChild(el('span', 'badge', row.badge));",
  "  node.addEventListener('click', function(){ act({ type: 'open', id: row.id }); });",
  "  return node;",
  "}",
  "function render(snapshot){",
  "  document.getElementById('heading').textContent = snapshot.heading || '待办';",
  "  document.getElementById('detail').textContent = snapshot.detail || '';",
  "  var count = document.getElementById('count');",
  "  count.textContent = String(snapshot.rows.length);",
  "  count.hidden = snapshot.rows.length === 0;",
  "  var list = document.getElementById('list');",
  "  list.replaceChildren();",
  "  if (snapshot.rows.length === 0) {",
  "    list.appendChild(el('p', 'empty', SURFACE === 'classroom-board' ? '当前没有需要展示的名单。' : '当前没有待处理的学生预约。'));",
  "  } else {",
  "    for (var i = 0; i < snapshot.rows.length; i++) list.appendChild(renderRow(snapshot.rows[i]));",
  "  }",
  "  document.getElementById('updated').textContent = snapshot.updatedAt ? ('更新于 ' + stamp(snapshot.updatedAt)) : '';",
  "}",
  "document.getElementById('hide').addEventListener('click', function(){ act({ type: 'hide' }); });",
  "document.getElementById('open').addEventListener('click', function(){ act({ type: 'open', id: '' }); });",
  "if (bridge && bridge.onSnapshot) bridge.onSnapshot(render);",
  "act({ type: 'sync' });",
].join("\n");

const POPUP_SCRIPT = [
  PAGE_HELPERS,
  "var current = null;",
  "function render(payload){",
  "  current = payload;",
  "  document.getElementById('p-title').textContent = payload.title || '有人喊你';",
  "  document.getElementById('p-subject').textContent = payload.subject || '';",
  "  document.getElementById('p-detail').textContent = payload.detail || '';",
  "  document.getElementById('p-stamp').textContent = payload.at ? stamp(payload.at) : '';",
  "}",
  "document.getElementById('p-ack').addEventListener('click', function(){",
  "  act({ type: 'acknowledge', id: current ? current.id : '' });",
  "});",
  "document.getElementById('p-open').addEventListener('click', function(){",
  "  act({ type: 'open', id: current ? current.id : '' });",
  "});",
  "document.addEventListener('keydown', function(event){",
  "  if (event.key !== 'Escape' || !current) return;",
  "  act({ type: 'acknowledge', id: current.id });",
  "});",
  "if (bridge && bridge.onPopup) bridge.onPopup(render);",
  "act({ type: 'sync' });",
].join("\n");

function document_(title: string, surface: RailSurface | "popup", extraCss: string, body: string, script: string): string {
  return [
    "<!doctype html>",
    "<html lang='zh-CN'><head><meta charset='utf-8'>",
    "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'\">",
    "<title>", title, "</title>",
    "<style>", PALETTE, ";", BASE_CSS, ";", extraCss, "</style>",
    "</head>",
    "<body data-surface='", surface, "'>",
    body,
    "<script>", script, "</script>",
    "</body></html>",
  ].join("");
}

const RAIL_BODY = [
  "<div class='shell'>",
  "<header class='drag'>",
  "<h1 id='heading'>待办</h1>",
  "<span class='count' id='count' hidden>0</span>",
  "<button class='icon nodrag' id='hide' type='button' title='隐藏' aria-label='隐藏常驻条'>×</button>",
  "</header>",
  "<div class='list' id='list' role='region' aria-live='polite' aria-label='待办列表'></div>",
  "<footer class='drag'><span id='detail'></span><span class='grow'></span><span id='updated'></span>",
  "<button class='nodrag' id='open' type='button'>打开 Mochi</button></footer>",
  "</div>",
].join("");

const POPUP_BODY = [
  "<div class='pop drag'>",
  "<div class='pop__bar'>Mochi · 喊人提醒<span class='grow'></span><span id='p-stamp'></span></div>",
  "<div class='pop__body'>",
  "<h1 class='pop__title' id='p-title'>有人喊你</h1>",
  "<div class='pop__subject' id='p-subject'></div>",
  "<div class='pop__detail' id='p-detail'></div>",
  "</div>",
  "<div class='pop__actions'>",
  "<button class='primary nodrag' id='p-ack' type='button'>我知道了</button>",
  "<button class='nodrag' id='p-open' type='button'>打开 Mochi</button>",
  "</div>",
  "</div>",
].join("");

/** 教师端小横条 / 教室端常驻屏共用同一份标记，差异由 surface 决定。 */
export function railPageHtml(surface: RailSurface): string {
  const title = surface === "classroom-board" ? "Mochi 课堂名单" : "Mochi 待办";
  return document_(title, surface, surface === "classroom-board" ? BOARD_CSS : "", RAIL_BODY, RAIL_SCRIPT);
}

/** 喊人弹窗。瞬态强提醒，不自动消失——喊人不能自己溜走。 */
export function popupPageHtml(): string {
  return document_("Mochi 喊人提醒", "popup", POPUP_CSS, POPUP_BODY, POPUP_SCRIPT);
}
