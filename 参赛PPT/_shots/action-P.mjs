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

async function clickByText(page, text, last = false) {
  try {
    const loc = page.getByText(text, { exact: false });
    const n = await loc.count();
    if (n) { await loc.nth(last ? n - 1 : 0).click({ timeout: 3500 }); return `getByText${last ? '-last' : ''}`; }
  } catch {}
  try { await page.getByRole('button', { name: text }).first().click({ timeout: 3000 }); return 'role'; } catch {}
  const ok = await page.evaluate(({ t, l }) => {
    const els = [...document.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && (e.textContent || '').trim() === t
    );
    if (!els.length) return false;
    els[l ? els.length - 1 : 0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }, { t: text, l: last });
  return ok ? 'dom' : 'FAIL';
}

async function installHider(page) {
  await page.evaluate(() => {
    const hide = () => {
      for (const el of document.querySelectorAll('[data-shell-overlay="true"]')) {
        for (const child of [...el.children]) {
          const r = child.getBoundingClientRect();
          if (r.width > 200 && r.width < 720 && r.height > 300 && r.right > window.innerWidth - 60) {
            child.style.setProperty('display', 'none', 'important');
          }
        }
      }
    };
    hide();
    if (!window.__mochiHider) window.__mochiHider = setInterval(hide, 250);
  });
}

async function shot(page, name) {
  await page.mouse.move(760, 95);
  await page.waitForTimeout(600);
  await installHider(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  [shot] ${name}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(authUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

// 1. 打开「教室连接」
console.log('教室连接:', await clickByText(page, '教室连接'));
await page.waitForTimeout(7000);
await shot(page, 'P-01-lan-panel');

let txt = await page.evaluate(() => document.body.innerText);
console.log('--- panel text ---\n' + txt.slice(0, 2200));

// 2. 如果出现「本机身份」等，尝试滚动/展开
const btns = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, [role="button"], input')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      t: (el.innerText || el.placeholder || '').trim().slice(0, 30),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  return out;
});
console.log('=== CLICKABLE ===');
console.log(JSON.stringify(btns, null, 1));

// 3. 尝试点「设置身份 / 创建身份 / 本机身份」
for (const label of ['设置身份', '创建身份', '本机身份', '开始设置']) {
  const r = await clickByText(page, label);
  console.log(`try "${label}": ${r}`);
  if (r !== 'FAIL') {
    await page.waitForTimeout(4000);
    await shot(page, 'P-02-identity');
    txt = await page.evaluate(() => document.body.innerText);
    console.log('--- after click ---\n' + txt.slice(0, 1500));
    break;
  }
}

await browser.close();
console.log('[done]');
