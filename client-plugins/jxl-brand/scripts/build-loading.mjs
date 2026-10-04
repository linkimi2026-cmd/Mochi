// 从同一个真实 React 组件生成无框架启动画面。启动失败报告仍由 Harness 管理。
import { build } from 'esbuild';
import { motionSource } from './build-motion.mjs';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const base = fileURLToPath(new URL('../', import.meta.url));
const out = join(tmpdir(), `mochi-loading-${process.pid}.cjs`);
await build({
  stdin: { contents: `import { renderToStaticMarkup } from 'react-dom/server'; import { MochiLoading } from './src/MochiLoading'; export default renderToStaticMarkup(<MochiLoading text="Mochi 正在准备工作区" />);`, resolveDir: base, loader: 'tsx' },
  nodePaths: [join(repo, 'apps/desktop/node_modules')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: out,
  alias: { 'motion/react': join(base,'src/shims/motion-react.ts') },
  loader: { '.css': 'empty' }, logLevel: 'error',
});
try {
  const { default: result } = await import(pathToFileURL(out).href);
  const markup = result.default;
  // 打包后的 CSS 只保留运行样式；上游工作区注释不作为发行包的许可声明。
  const css = ['ExpressiveOrb.css','OrbCompanion.css','MochiLoading.css']
    .map(f=>readFileSync(join(base,'src',f),'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//gu, '');
  writeFileSync(new URL('../../jxl-theme/assets/mochi-loading.json',import.meta.url), JSON.stringify({markup,css,script:motionSource}));
  console.log('Mochi boot loading generated from brand component');
} finally { unlinkSync(out); }
