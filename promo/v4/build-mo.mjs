import path from 'node:path';
import {build} from '../../client-plugins/jxl-brand/node_modules/esbuild/lib/main.js';

const repoRoot=path.resolve(import.meta.dirname,'../..');
await build({
  entryPoints:[path.join(repoRoot,'promo/v4/mo-entry.tsx')],
  bundle:true,
  platform:'node',
  format:'cjs',
  outfile:path.join(repoRoot,'promo/v4/mo-render.cjs'),
  jsx:'automatic',
  nodePaths:[process.env.JIAXINGLIAN_NODE_MODULES ?? path.resolve(repoRoot,'../联动计划/node_modules')],
  alias:{'motion/react':path.join(repoRoot,'client-plugins/jxl-brand/src/shims/motion-react.ts')},
});
