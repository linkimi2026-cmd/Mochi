import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire, Module } from 'node:module';
const require = createRequire(import.meta.url);

const root = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the packaged playwright resource directory');
const metadata = JSON.parse(readFileSync(join(root, 'metadata.json'), 'utf8'));
assert.equal(metadata.playwrightVersion, '1.55.0');
assert.equal(metadata.chromiumRevision, '1187');
let executablePath;
let chromium;
if (metadata.mode === 'on-demand') {
  const resources = resolve(root, '../..');
  process.env.MOCHI_BROWSER_MODE = 'on-demand';
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.MOCHI_BROWSER_PROBE_CACHE || join(tmpdir(), 'mochi-browser-probe-cache-1187');
  const modernModules = join(resources, 'mochi', 'node_modules');
  const modules = existsSync(modernModules) ? modernModules : join(resources, 'app.asar.unpacked', 'node_modules');
  assert.equal(JSON.parse(readFileSync(join(modules, 'playwright', 'package.json'), 'utf8')).version, metadata.playwrightVersion);
  process.env.NODE_PATH = modules;
  Module._initPaths();
  require(join(resources, 'browser-on-demand.cjs'));
  ({ chromium } = require(join(modules, 'playwright')));
} else {
  const browserRoot = join(root, 'browsers');
  executablePath = resolve(browserRoot, metadata.browserExecutable);
  assert.ok(executablePath.startsWith(browserRoot + sep), 'Browser executable must stay inside its resource directory');
  for (const [file, expected] of [[executablePath, metadata.browserExecutableSha256], [join(root, 'LICENSE'), metadata.licenseSha256], [join(root, 'credits.html'), metadata.creditsHtmlSha256], [join(root, 'credits.txt'), metadata.creditsTextSha256]]) {
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), expected, 'Packaged resource hash mismatch');
  }
  ({ chromium } = require('playwright'));
}
const temporary = mkdtempSync(join(tmpdir(), 'mochi-browser-probe-'));
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, timeout: 30000 });
  assert.equal(browser.version(), metadata.chromiumVersion);
  const page = await browser.newPage();
  await page.setContent('<main><h1>Mochi</h1><p id="ready">managed Chromium</p></main>');
  assert.equal(await page.textContent('#ready'), 'managed Chromium');
  const screenshot = join(temporary, 'probe.png');
  await page.screenshot({ path: screenshot });
  assert.ok(statSync(screenshot).size > 100);
  console.log('PASS packaged Chromium:', metadata.mode || 'bundled', 'launch, renderer DOM and screenshot');
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
