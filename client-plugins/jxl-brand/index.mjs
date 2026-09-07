// jxl-brand · node half（占位）
//
// 浏览器半（client.js）通过官方 slot 系统占据 sidebar.brand.mark / sidebar.brand.name，
// 取代 @deepseek-ai/dsh-client-ui-brand-official（在 mochi-web profile patch 中 disabled）。
// 本 node half 仅保证插件行可装载。

export const name = "jxl-brand";

export function apply(ctx) {
  ctx.logger?.debug?.("[jxl-brand] node half loaded (brand slots are browser-side)");
}
