import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { installModelDiagnostic } from './doctor.mjs';

export const name = 'mochi-hello';

const MANAGED_NODE_KEY = 'DSH_MOCHI_NODE';
const MANAGED_NODE_PROMPT = [
  'When the bash or pwsh tool is available, use the managed `$DSH_MOCHI_NODE` executable for JavaScript and browser automation; do not assume `node`, `npm`, or a separately installed browser exists.',
  'For Playwright, invoke `"$DSH_MOCHI_NODE" -e "const { chromium } = require(\'playwright\'); /* ... */"` on macOS/Linux, or `& $env:DSH_MOCHI_NODE -e "const { chromium } = require(\'playwright\'); /* ... */"` in PowerShell. Mochi supplies the compatible browser through its managed runtime. Keep commands inside the approved workspace and follow the normal shell approval flow.',
].join(' ');

function managedNodePath() {
  const configured = process.env.MOCHI_RUNTIME_NODE;
  if (!configured || !isAbsolute(configured)) return null;
  const candidate = resolve(configured);
  return candidate === resolve(process.execPath) && existsSync(candidate) ? candidate : null;
}

export function apply(ctx) {
  console.log('[Mochi] hello plugin loaded! 内核已挂载自定义插件');
  if (ctx.logger?.info) ctx.logger.info('[mochi-hello] apply() 被调用');
  // Keep the existing authenticated diagnostic endpoint available only when
  // both host services are present. Headless profiles continue without it.
  ctx.inject(['connection', 'llm'], (hostCtx) => {
    installModelDiagnostic(hostCtx);
  });
  ctx.inject(['shellEnv', 'systemPrompt'], (runtimeCtx) => {
    const node = managedNodePath();
    if (!node) return undefined;
    const disposeEnvironment = runtimeCtx.shellEnv.register({
      name: 'mochi-managed-node',
      variables: {
        [MANAGED_NODE_KEY]: {
          description: 'Mochi managed Electron Node executable for JavaScript and Playwright commands; use it instead of assuming node or npm is installed.',
        },
      },
      resolve: () => ({ [MANAGED_NODE_KEY]: node }),
    });
    const disposePrompt = runtimeCtx.systemPrompt.section({
      name: 'mochi:managed-node',
      order: runtimeCtx.systemPrompt.getSectionOrder('TOOL_BASH') - 1,
      text: MANAGED_NODE_PROMPT,
    });
    return () => {
      disposePrompt();
      disposeEnvironment();
    };
  });
}
