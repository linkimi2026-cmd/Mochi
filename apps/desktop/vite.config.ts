import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Mochi renderer 构建配置。
 *
 * base 必须是相对路径：Electron 用 `file://` 加载打包后的 index.html，
 * 绝对路径 `/assets/...` 在 file:// 下会解析到磁盘根目录而 404。
 */
export default defineConfig({
  root: resolve(here, "renderer"),
  base: "./",
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
  },
  build: {
    outDir: resolve(here, "dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
