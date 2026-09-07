// jxl-theme · node half：静态品牌资产路由 + 文档层说明
//
// 浏览器半（client.js，由 scripts/build-client.mjs 生成）注入嘉行联皮肤。
// 本 node half 仿照 @deepseek-ai/dsh-client-modules 的官方模式
// （ctx.webServer.register({ kind: 'prefix', path, handler })）把
// assets/ 目录暴露为 /jxl-assets/*，供水母 logo / 图标 / 水彩背景引用。
// 资产来源：联动计划/public/assets/（复制件；原目录只读，绝不回改）。

import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "jxl-theme";

/** 需要的 Cordis 服务：官方 web 静态路由注册面。 */
export const inject = ["webServer"];

const MIME = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const ASSETS_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "assets");

export function apply(ctx) {
  // 官方 index injection 在 React/插件加载之前生效。只替换加载标识，保留失败报告。
  const boot = JSON.parse(readFileSync(join(ASSETS_ROOT, "mochi-loading.json"), "utf8"));
  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "html", placement: "head", html: `<style>${boot.css}
      [data-dsh-boot]{background:#f5f2e9!important}
      body[data-ds-dark-theme] [data-dsh-boot]{background:#1b211e!important}
      [data-dsh-boot-spinner]{width:auto!important;height:auto!important;border:0!important;animation:none!important}
      [data-dsh-boot-spinner]::after{display:none!important}
      [data-dsh-boot-spinner]+div{display:none}
      </style>` });
    table.push({ kind: "script", placement: "head", text: `(() => {
      const markup = ${JSON.stringify(boot.markup)};
      const observe = new MutationObserver(() => {
        const spinner = document.querySelector('[data-dsh-boot-spinner]');
        if (!spinner || spinner.dataset.mochiLoading) return;
        spinner.dataset.mochiLoading = 'true';
        spinner.innerHTML = markup;
        if (spinner.previousElementSibling) spinner.previousElementSibling.textContent = 'Mochi';
      });
      observe.observe(document.documentElement, {childList:true,subtree:true});
      window.addEventListener('pagehide', () => observe.disconnect(), {once:true});
    })();` });
  });
  const dispose = ctx.webServer.register({
    kind: "prefix",
    path: "/jxl-assets",
    handler(req, res) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      const url = new URL(req.url ?? "/", "http://x");
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^\/jxl-assets\/?/, "");
      const abs = normalize(join(ASSETS_ROOT, rel));
      if (!abs.startsWith(ASSETS_ROOT) || !existsSync(abs) || !statSync(abs).isFile()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "public, max-age=300",
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(abs).pipe(res);
    },
  });
  ctx.logger?.info?.("[jxl-theme] /jxl-assets 路由已注册（水母 logo / 图标 / 水彩校园）");
  ctx.effect(() => dispose, "jxl-theme: assets route");
}
