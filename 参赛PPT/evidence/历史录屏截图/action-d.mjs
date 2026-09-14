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

async function clickByText(page, text, nth = 0) {
  try { await page.getByText(text, { exact: false }).nth(nth).click({ timeout: 3000 }); return 'getByText'; } catch {}
  try { await page.getByRole('button', { name: text }).nth(nth).click({ timeout: 3000 }); return 'role'; } catch {}
  const ok = await page.evaluate(({ t, n }) => {
    const els = [...document.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && (e.textContent || '').trim() === t
    );
    if (els.length <= n) return false;
    els[n].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, { t: text, n: nth });
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

console.log('1 校园工作:', await clickByText(page, '校园工作'));
await page.waitForTimeout(2500);
console.log('2 班主任待办:', await clickByText(page, '班主任待办'));
await page.waitForTimeout(10000);
await page.mouse.move(800, 60);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/d-01-campus-panel.png` });

let t1 = await page.evaluate(() => document.body.innerText);
console.log('--- panel text ---\n' + t1.slice(0, 1500));

console.log('3 扫码登录:', await clickByText(page, '扫码登录'));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/d-02-scan-tab.png` });

console.log('4 本机直接进入演示:', await clickByText(page, '本机直接进入演示'));
await page.waitForTimeout(10000);
await page.mouse.move(800, 60);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/d-03-after-login.png` });

const t2 = await page.evaluate(() => document.body.innerText);
console.log('--- after login text ---\n' + t2.slice(0, 2000));
console.log('=== FRAMES ===', JSON.stringify(page.frames().map((f) => f.url())));

await browser.close();
console.log('[done]');
