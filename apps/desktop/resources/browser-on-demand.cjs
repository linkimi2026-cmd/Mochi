/* Mochi's managed Node preload. Browser binaries are installed only on launch. */
const Module = require('node:module');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, dirname } = require('node:path');
const patched = Symbol.for('mochi.browser.on-demand');
let installation;

function install(playwrightRoot) {
  if (installation) return installation;
  installation = new Promise((resolve, reject) => {
    process.stderr.write('[Mochi] 首次网页操作：正在准备浏览器，聊天和校园页面仍可使用。\n');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '120000' };
    delete env.NODE_OPTIONS;
    // Do not inherit arbitrary download-host overrides into the managed installation.
    delete env.PLAYWRIGHT_DOWNLOAD_HOST;
    delete env.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST;
    const child = spawn(process.execPath, [join(playwrightRoot, 'cli.js'), 'install', 'chromium'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', data => process.stderr.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('浏览器准备失败，请检查网络后重试；已下载的完整版本会保留。')));
  }).catch(error => { installation = undefined; throw error; });
  return installation;
}

function patch(playwright, moduleFilename) {
  const chromium = playwright?.chromium;
  if (!chromium || typeof chromium.launch !== 'function' || chromium[patched]) return;
  const root = dirname(Module.createRequire(moduleFilename).resolve('playwright-core/package.json'));
  chromium[patched] = true;
  for (const method of ['launch', 'launchPersistentContext', 'launchServer']) {
    const original = chromium[method].bind(chromium);
    chromium[method] = async (...args) => {
      const options = method === 'launchPersistentContext' ? args[1] : args[0];
      if (!options?.executablePath && !options?.channel) {
        const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
        const complete = cache && ['chromium-1187', 'chromium_headless_shell-1187', 'ffmpeg-1011']
          .every(name => existsSync(join(cache, name, 'INSTALLATION_COMPLETE')));
        if (!complete) await install(root);
      }
      return original(...args);
    };
  }
}

if (process.env.MOCHI_BROWSER_MODE === 'on-demand') {
  const load = Module._load;
  Module._load = function (...args) {
    const exported = Reflect.apply(load, this, args);
    if (exported && Object.hasOwn(exported, 'chromium') && Object.hasOwn(exported, 'devices')) {
      patch(exported, Module._resolveFilename(args[0], args[1]));
    }
    return exported;
  };
}
