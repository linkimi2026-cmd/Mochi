// 从同一个真实 React 组件生成无框架启动画面。启动失败报告仍由 Harness 管理。
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const { resolveCampusSource } = require(join(repo, 'scripts', 'campus-paths.cjs'));
const { root: campus, kind: campusKind } = resolveCampusSource({ workspaceRoot: repo });
const base = fileURLToPath(new URL('../', import.meta.url));
const out = join(tmpdir(), `mochi-loading-${process.pid}.cjs`);
await build({
  stdin: { contents: `import { renderToStaticMarkup } from 'react-dom/server'; import { MochiLoading } from './src/components/MochiLoading'; export default renderToStaticMarkup(<MochiLoading text="Mochi 正在准备工作区" />);`, resolveDir: campus, loader: 'tsx' },
  nodePaths: [join(campus, 'node_modules')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: out,
  alias: { 'motion/react': join(base,'src/shims/motion-react.ts') },
  loader: { '.css': 'empty' }, logLevel: 'error',
});
try {
  const { default: result } = await import(pathToFileURL(out).href);
  const markup = result.default;
  const css = ['ExpressiveOrb.css','OrbCompanion.css','MochiLoading.css'].map(f=>readFileSync(join(campus,'src/components',f),'utf8')).join('\n');
  writeFileSync(new URL('../../jxl-theme/assets/mochi-loading.json',import.meta.url), JSON.stringify({markup,css}));
  console.log(`Mochi boot loading generated from shared component (${campusKind} campus source)`);
} finally { unlinkSync(out); }
