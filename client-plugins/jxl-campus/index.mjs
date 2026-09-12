// jxl-campus · node half：同源静态直出 + API 反代（原生生长的管线，生产构建版）
//
// 管线（2026-09-04）：
//   - /campus/*   → campus.nosync/dist/client/* 静态直出（vite build，base=/campus/，
//                   固定名产物 assets/embed.js + assets/style.css）
//   - /jxl-api/*  → 反代 wrangler dev（campus Worker + 本地 D1，127.0.0.1:8787），
//                   /jxl-api/x → 上游 /api/x（校园路由保持原名）
// 嵌入形态：Mochi 客户端插件动态 import("/campus/assets/embed.js")，把整棵嘉行联
// React 应用挂进 Harness 界面的 shell.overlay 原生层——同文档、同源、无 iframe。
//
// 路径事实：3090 的 /api 前缀被 dsh-client-connection（RPC 层）占用，故校园 API
// 改名 /jxl-api（复制件 src/lib/api.ts 已做运行时重写）；dsh 自己的 SSE 在
// /plugins/events，二者互不影响。
//
// 仿照 @deepseek-ai/dsh-client-modules 的官方注册面：
// ctx.webServer.register({ kind: 'prefix', path, handler(req, res) })。

import http from "node:http";
import https from "node:https";
import { campusBrowserCookieName, campusBrowserToken, campusConnection, campusToken } from "../../plugins/mochi-campus/connection.mjs";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname, sep } from "node:path";
import { resolveCampusStaticRoot } from "./static-root.mjs";

export const name = "jxl-campus";

/** 需要的 Cordis 服务：官方 web 路由注册面。 */
export const inject = ["webServer"];

const UPSTREAM = new URL(campusConnection.origin);
const STATIC_ROOT = resolveCampusStaticRoot().root;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/** hop-by-hop 头。 */
const STRIP_REQ = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host"]);
const STRIP_RES = new Set(["connection", "keep-alive", "transfer-encoding"]);

function browserSetCookie(cookie, upstreamOrigin, secureBrowser) {
  const scopedName = campusBrowserCookieName(upstreamOrigin);
  let value = String(cookie).replace(/^\s*campus_session=/i, `${scopedName}=`).replace(/;\s*Domain=[^;]+/ig, '');
  if (!secureBrowser) value = value.replace(/;\s*Secure\b/ig, '');
  return value;
}

/** /jxl-api/* → the selected campus upstream's /api/*. */
export function createApiProxyHandler({ upstream = UPSTREAM, connection = campusConnection } = {}) {
  const selected = upstream instanceof URL ? upstream : new URL(upstream);
  return function apiProxyHandler(req, res) {
  // Validate the browser's origin BEFORE translating it for the remote Worker.
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
    res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: '请求来源校验失败。' }));
    return;
  }
  const headers = { ...req.headers };
  for (const h of STRIP_REQ) delete headers[h];
  headers.host = selected.host;
  // Worker 对非 GET 请求做同源 CSRF 校验（Origin !== 上游 origin 即 403）。
  // 代理形态下浏览器 Origin 是 3090，此处统一改写为上游地址以通过校验；
  // 会话 cookie 是 host-only（不含端口），经 3090 下发后浏览器自动回带。
  headers.origin = selected.origin;
  // Host/Harness credentials must never travel to the campus service.
  // A legacy unscoped campus_session is deliberately ignored: it has no
  // trustworthy issuer and must never cross an upstream-origin switch.
  const token = campusBrowserToken(req.headers.cookie, selected.origin);
  // 主动激活共享登录：浏览器任意带 cookie 的校园请求都会同步 agent 侧登录态
  //（me/login 拦截之外的双保险，2026-09-05——面板 demo 降级时前端可能不发 me）。
  if (token) connection.ensureActive(token);
  console.log(`[jxl-campus] proxy ${req.method} ${req.url} token=${token ? 'yes' : 'no'}`);
  delete headers.authorization;
  headers.cookie = token ? `campus_session=${token}` : '';
  delete headers['accept-encoding'];
  let path = req.url ?? "/";
  if (path.startsWith("/jxl-api/")) path = `/api${path.slice(8)}`;
  else if (path === "/jxl-api") path = "/api";
  const upstreamRequest = (selected.protocol === 'https:' ? https : http).request(
    { protocol: selected.protocol, hostname: selected.hostname, port: selected.port || undefined, path, method: req.method ?? "GET", headers, timeout: 45000 },
    (ures) => {
      const out = {};
      for (const [k, v] of Object.entries(ures.headers)) {
        if (STRIP_RES.has(k)) continue;
        out[k] = k === 'set-cookie'
          ? v.map((cookie) => browserSetCookie(cookie, selected.origin, req.socket?.encrypted === true))
          : v;
      }
      const authResponse = /^\/api\/auth\/(me|login|judge-login|logout)(?:\?|$)/.test(path);
      if (authResponse) {
        const chunks = [];
        ures.on('data', chunk => chunks.push(chunk));
        ures.on('end', () => {
          const body = Buffer.concat(chunks);
          if (ures.statusCode === 200) {
            if (path.startsWith('/api/auth/logout')) connection.clear(token);
            else {
              const freshToken = (ures.headers['set-cookie'] || []).map(campusToken).find(Boolean) || token;
              try { connection.activate(freshToken, JSON.parse(body.toString()).user); } catch {}
            }
          } else if (ures.statusCode === 401) connection.clear(token);
          res.writeHead(ures.statusCode ?? 502, out); res.end(body);
        });
        return;
      }
      res.writeHead(ures.statusCode ?? 502, out);
      ures.pipe(res);
    },
  );
  upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('timeout')));
  upstreamRequest.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("校园服务暂时无法连接，请稍后重试。");
  });
  req.pipe(upstreamRequest);
  };
}

const apiProxyHandler = createApiProxyHandler();

/** /campus/* → dist/client 静态直出。 */
function staticHandler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  // 先在 URL pathname（恒为正斜杠）上剥前缀，再 normalize 为平台路径；
  // Windows 上先 normalize 会变成反斜杠导致前缀正则失配（CI 实锤 404）。
  const rel = decodeURIComponent(url.pathname).replace(/^\/campus\/?/, "");
  if (rel === "sw.js") {
    // 嵌入形态绝不注册校园 Service Worker（避免劫持 3090 根作用域）
    res.writeHead(204).end();
    return;
  }
  const abs = normalize(join(STATIC_ROOT, rel));
  if (!abs.startsWith(STATIC_ROOT + sep) && abs !== STATIC_ROOT) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(abs).pipe(res);
}

/** /assets/campus/* → dist/client/assets/campus/*（兼容源码硬编码的原独立站根路径）。 */
function legacyAssetHandler(req, res) {
  req.url = "/campus" + (req.url ?? "/"); // 复用 staticHandler 的 /campus 前缀剥除
  staticHandler(req, res);
}

export function apply(ctx) {
  const disposers = [
    ctx.webServer.register({ kind: "prefix", path: "/campus", handler: staticHandler }),
    // 源码里 35 处 `/assets/campus/...` 字面量（sceneRegistry/页面插画）按独立站根路径
    // 硬编码，base=/campus/ 下会 404 → 原样别名回 dist，避免为嵌入形态回改源码。
    ctx.webServer.register({ kind: "prefix", path: "/assets/campus", handler: legacyAssetHandler }),
    ctx.webServer.register({ kind: "prefix", path: "/jxl-api", handler: apiProxyHandler }),
  ];
  ctx.logger?.info?.(
    `[jxl-campus] /campus + /jxl-api → ${UPSTREAM.origin} 已注册`,
  );
  ctx.effect(
    () => () => {
      for (const d of disposers) {
        try {
          d();
        } catch {}
      }
    },
    "jxl-campus: routes",
  );
}
