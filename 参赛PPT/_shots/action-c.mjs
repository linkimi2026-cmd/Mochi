import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/Users/a1379/Documents/Mochi/apps/desktop/package.json');
const { chromium } = require('playwright');

const LOG = '/tmp/mochi-web.log';
const OUT = '/Users/a1379/Documents/Mochi/参赛PPT/_shots';

function authUrl() {
  const text = readFileSync(LOG, 'utf8');
  const m = [...text.matchAll(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_\-]+/g)];
  if (!m.length) throw new Error('no auth url');
  return m[m.length - 1][0];
}

async function clickByText(page, text) {
  try { await page.getByText(text, { exact: false }).first().click({ timeout: 3000 }); return 'getByText'; } catch {}
  try { await page.getByRole('button', { name: text }).first().click({ timeout: 3000 }); return 'role'; } catch {}
  const ok = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && (e.textContent || '').trim() === t
    );
    if (!els.length) return false;
    els[els.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, text);
  return ok ? 'dom' : 'FAIL';
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(authUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

console.log('click 教室连接:', await clickByText(page, '教室连接'));
await page.waitForTimeout(6000);
await page.mouse.move(800, 60);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/c-01-campus-entry.png` });

const dump = await page.evaluate(() => ({
  url: location.href,
  text: document.body.innerText.slice(0, 2500),
  buttons: [...document.querySelectorAll('button')]
    .map((b) => ({ t: (b.innerText || '').trim().slice(0, 30), cls: String(b.className || '').slice(0, 60) }))
    .filter((b) => b.t)
    .slice(0, 30),
  inputs: [...document.querySelectorAll('input')]
    .map((i) => ({ type: i.type, ph: i.placeholder, name: i.name, id: i.id }))
    .slice(0, 20),
}));
console.log('=== URL ===', dump.url);
console.log('=== TEXT ===\n' + dump.text);
console.log('=== BUTTONS ===', JSON.stringify(dump.buttons));
console.log('=== INPUTS ===', JSON.stringify(dump.inputs));
console.log('=== FRAMES ===', JSON.stringify(page.frames().map((f) => f.url())));

await browser.close();
console.log('[done]');
