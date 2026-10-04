// jxl-theme · host asset routing + natural-language background selection.
// Each Mochi endpoint has its own DSH_HOME, so this namespace persists the
// teacher's or classroom's choice without sharing it across roles.

import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";

const ASSETS_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "assets");
const BACKGROUND_MANIFEST = JSON.parse(readFileSync(resolve(ASSETS_ROOT, "campus/background-manifest.json"), "utf8"));
const BOOT = JSON.parse(readFileSync(resolve(ASSETS_ROOT, "mochi-loading.json"), "utf8"));

export const name = "jxl-theme";
export const inject = ["webServer"];
export const SETTINGS_NAMESPACE = "jxl-theme";
export const BACKGROUND_FIELD = "campusBackground";
export const DEFAULT_BACKGROUND = BACKGROUND_MANIFEST.defaultBackground;
export const BACKGROUND_TOOL_NAME = "mochi_set_campus_background";

/** Finite, product-owned assets. Model arguments can never supply a URL or path. */
export const CAMPUS_BACKGROUNDS = Object.freeze(Object.fromEntries(
  BACKGROUND_MANIFEST.backgrounds.map((entry) => [entry.id, Object.freeze({
    label: entry.label,
    asset: entry.asset,
    url: entry.asset ? `/jxl-assets/campus/${entry.asset}` : null,
    position: entry.position,
  })]),
));

const ids = Object.keys(CAMPUS_BACKGROUNDS);
export const ThemeSettingsSchema = z.object({
  uiSound: z.boolean().default(true),
  petPalette: z.union(JSON.parse(readFileSync(resolve(ASSETS_ROOT, "mochi-palettes.json"), "utf8")).map(p => p.id)).default("caramel"),
  [BACKGROUND_FIELD]: z.union([...ids, "watercolor", "campus-route", "ginkgo-walkway"]).default(DEFAULT_BACKGROUND),
});

// New Harness projects volatile Config fields; the old version owns its settings section.
// Schemastery 3.18.4's volatile() is exactly extra('volatile', true).
// Keeping that metadata on 3.18.2 lets a new Host load a linked legacy checkout;
// the old Host ignores it and continues using its separate settings section.
const editable = schema => typeof schema.volatile === "function" ? schema.volatile() : schema.extra("volatile", true);
export const Config = z.object({
  uiSound: editable(z.boolean().default(true)),
  petPalette: editable(z.union(JSON.parse(readFileSync(resolve(ASSETS_ROOT, "mochi-palettes.json"), "utf8")).map(p => p.id)).default("caramel")),
  [BACKGROUND_FIELD]: editable(z.union([...ids, "watercolor", "campus-route", "ginkgo-walkway"]).default(DEFAULT_BACKGROUND)),
});

export const output = {
  schema: {
    type: "object",
    properties: {
      success: { type: "boolean", required: true },
      background: { type: "string", enum: ids, required: true },
      label: { type: "string", required: true },
      message: { type: "string", required: true },
    },
    additionalProperties: false,
  },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

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

function checkedBackground(value) {
  return Object.hasOwn(CAMPUS_BACKGROUNDS, value) ? value : DEFAULT_BACKGROUND;
}

function createBackgroundTool(scope) {
  return defineTool({
    name: BACKGROUND_TOOL_NAME,
    description: "将当前 Mochi 恢复为米白纸面背景。明暗外观仍由外观设置控制。",
    parameters: {
      background: {
        type: "string",
        required: true,
        enum: ids,
        description: "paper=米白纸面（默认）。",
      },
    },
    output,
    execute: async (args) => {
      const id = String(args?.background ?? "");
      const theme = CAMPUS_BACKGROUNDS[id];
      if (!theme) throw new Error("当前仅支持米白纸面背景。");

      if (scope.get()[BACKGROUND_FIELD] !== id) {
        await scope.update({ [BACKGROUND_FIELD]: id });
      }
      return {
        success: true,
        background: id,
        label: theme.label,
        message: `已把当前 Mochi 背景切换为「${theme.label}」。`,
      };
    },
  });
}

function backgroundBootstrap(background) {
  const id = checkedBackground(background);
  const theme = CAMPUS_BACKGROUNDS[id];
  return `(() => { const root=document.documentElement; root.dataset.jxlCampusBackground=${JSON.stringify(id)}; root.style.setProperty('--jxl-campus-background-image',${JSON.stringify(theme.url ? `url("${theme.url}")` : "none")}); root.style.setProperty('--jxl-campus-background-position',${JSON.stringify(theme.position)}); })();`;
}

export function apply(ctx, config = {}) {
  // Keep the existing Mochi loading artwork and preserve its failure reporter.
  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "html", placement: "head", html: `<style>${BOOT.css}
      [data-dsh-boot]{background:#f6f3ec!important}
      body[data-ds-dark-theme] [data-dsh-boot]{background:#242320!important}
      [data-dsh-boot-spinner]{width:auto!important;height:auto!important;border:0!important;animation:none!important}
      [data-dsh-boot-spinner]::after{display:none!important}
      [data-dsh-boot-spinner]+div{display:none}
      </style>` });
    table.push({ kind: "script", placement: "head", text: `(() => {
      ${BOOT.script || ""}
      const markup = ${JSON.stringify(BOOT.markup)};
      let motion;
      let mountedSpinner;
      const observe = new MutationObserver(() => {
        const spinner = document.querySelector('[data-dsh-boot-spinner]');
        if (!spinner) { motion?.dispose(); motion = undefined; return; }
        if (spinner === mountedSpinner) return;
        motion?.dispose();
        mountedSpinner = spinner;
        spinner.dataset.mochiLoading = 'true';
        spinner.innerHTML = markup;
        const svg = spinner.querySelector(".expressive-orb__svg");
        if (svg && typeof MochiMotion !== "undefined") motion = MochiMotion.mountMotion(svg, {state:"boot",interactive:false});
        if (spinner.previousElementSibling) spinner.previousElementSibling.textContent = 'Mochi';
      });
      observe.observe(document.documentElement, {childList:true,subtree:true});
      window.addEventListener('pagehide', () => { observe.disconnect(); motion?.dispose(); }, {once:true});
    })();` });

    // This tiny first-paint value is only a checked enum; the live browser
    // settings mirror adopts later commits and keeps the same attribute current.
    let selected = DEFAULT_BACKGROUND;
    try {
      selected = checkedBackground(themeSettings?.get()?.[BACKGROUND_FIELD]);
    } catch { /* settings may not be available during a degraded boot */ }
    table.push({ kind: "script", placement: "head", text: backgroundBootstrap(selected) });
  });

  const disposeRoute = ctx.webServer.register({
    kind: "prefix",
    path: "/jxl-assets",
    handler(req, res) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405).end();
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const rel = pathname.replace(/^\/jxl-assets\/?/, "");
      const abs = resolve(ASSETS_ROOT, rel);
      const fromRoot = relative(ASSETS_ROOT, abs);
      if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)
        || !existsSync(abs) || !statSync(abs).isFile()) {
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
  ctx.effect(() => disposeRoute, "jxl-theme: assets route");

  const configured = () => ThemeSettingsSchema(Object.fromEntries(Object.keys(config).map(field => [field,
    typeof config[field]?.get === "function" ? config[field].get() : config[field],
  ])));
  let themeSettings = { get: configured };
  if (typeof ctx.inject === "function") {
    ctx.inject(["settings"], (settingsCtx) => {
      themeSettings = typeof settingsCtx.settings.register === "function"
        ? settingsCtx.settings.register(SETTINGS_NAMESPACE, ThemeSettingsSchema)
        : { get: configured, update: patch => settingsCtx.settings.update(ctx.fiber.entry.options.id, patch) };
      const scope = themeSettings;
      const toolFiber = settingsCtx.inject(["tools"], toolsCtx => toolsCtx.tools.register(createBackgroundTool(scope)));
      return () => {
        toolFiber.dispose?.();
        if (themeSettings === scope) themeSettings = undefined;
      };
    });
  }

  ctx.logger?.info?.("[jxl-theme] 校园插画路由与 Mochi 自然语言换背景已就绪");
}
