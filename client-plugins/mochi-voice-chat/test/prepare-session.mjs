// Test-only bundling of the actual published Session class; no substitute session implementation.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const [runtimePackage, testDependencies] = process.argv.slice(2);
if (!runtimePackage || !testDependencies) throw new Error('Pass candidate package.json and an isolated test-dependency directory (zustand 4.4.7, immer 10.1.1).');
const runtime = createRequire(resolve(runtimePackage));
const sessionRoot = dirname(runtime.resolve('@deepseek-ai/dsh-api-session-controller/package.json'));
const gatewayRoot = dirname(runtime.resolve('@deepseek-ai/dsh-api-gateway/package.json'));
const version = JSON.parse(readFileSync(join(sessionRoot, 'package.json'), 'utf8')).version;
if (!version.startsWith('0.2.')) throw new Error(`Expected verified 0.2 Session runtime; received ${version}`);
const workspace = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const outfile = join(resolve(testDependencies), 'official-session.mjs');
await workspace('esbuild').build({ entryPoints: [join(sessionRoot, 'lib/types/client/sessions/session.js')], outfile,
  bundle: true, platform: 'node', format: 'esm', nodePaths: [join(resolve(testDependencies), 'node_modules')],
  alias: { '@deepseek-ai/dsh-api-gateway/client': join(gatewayRoot, 'lib/types/client/index.js') } });
console.log(outfile);
