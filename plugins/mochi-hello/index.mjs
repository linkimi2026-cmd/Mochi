import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { installModelDiagnostic } from './doctor.mjs';
import { installWorkQuality } from './work-quality.mjs';

export const name = 'mochi-hello';

const MANAGED_NODE_KEY = 'DSH_MOCHI_NODE';
const LOCAL_WEB_URL = /http:\/\/127\.0\.0\.1:\d{1,5}/gu;
const WEB_URL_GUIDANCE = 'the current URL in DSH_WEB_URL';
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

/** Keep the Web GUI instruction while avoiding a random startup port in the first prompt section. */
export function stableWebSurface(assembly) {
  if (!Array.isArray(assembly?.sections)) return assembly;
  return {
    ...assembly,
    sections: assembly.sections.map((section) => {
      if (section?.name !== 'app:web-surface' || typeof section.text !== 'string') return section;
      const stable = section.text.replace(LOCAL_WEB_URL, WEB_URL_GUIDANCE);
      if (stable === section.text) return section;
      return {
        ...section,
        text: `${stable} In work mode, read DSH_WEB_URL from the shell environment before opening or verifying this GUI (Bash: $DSH_WEB_URL; PowerShell: $env:DSH_WEB_URL).`,
      };
    }),
  };
}

/** Guidance follows the actual, role-filtered tool set for this turn. */
export function toolAwareness(assembly) {
  if (!Array.isArray(assembly?.tools) || !Array.isArray(assembly?.sections)) return assembly;
  const names = new Set(assembly.tools.map(tool => tool.name));
  const guidance = ['当前可用能力以本轮工具定义为准。调用已提供的专用工具；不得编造工具名或声称拥有被隐藏的权限。'];
  if (names.has('sidebar_open')) guidance.push('用户要查看网页或你已生成并检查完成的成果时，调用 sidebar_open，把真实 URL 或文件路径打开到当前会话侧边栏。优先展示主要成果，避免批量打开无关标签。delivered=false 只表示排队等待，不能声称用户已看到。侧边栏网页是展示容器，不能据此声称已读取或操控网页；需要浏览器操作时使用实际可用的浏览器工具或受管 Playwright。');
  if (names.has('jxl_query')) guidance.push('校园查询直接调用当前校园工具，后端按已登录账号的班级关系授权。未登录或登录过期时，指引打开设置顶部的用户账号登录；没有权限、查询失败与空结果必须区分，不能用示例或本地数据替代。');
  return { ...assembly, sections: [...assembly.sections.filter(section => section.name !== 'mochi:tool-awareness'), { name: 'mochi:tool-awareness', text: guidance.join('\n') }] };
}

export function apply(ctx) {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => toolAwareness(stableWebSurface(await next())), { global: true });
  // A separate section survives a role persona shadowing deployment:persona.
  ctx.inject(['systemPrompt'], installWorkQuality);
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
