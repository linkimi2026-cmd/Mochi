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

async function hideWorkbench(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-shell-overlay="true"]')) {
      for (const child of [...el.children]) {
        const r = child.getBoundingClientRect();
        if (r.width > 200 && r.width < 700 && r.height > 300 && r.right > window.innerWidth - 40) {
          child.style.display = 'none';
        }
      }
    }
  });
}

async function shot(page, name) {
  await hideWorkbench(page);
  await page.mouse.move(760, 95);
  await page.waitForTimeout(400);
  await hideWorkbench(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  [shot] ${name}`);
}

async function focusComposer(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[contenteditable="true"][data-composer-input="true"]');
    if (!el) return false;
    el.focus();
    return true;
  });
}

async function waitFor(page, marks, tag, maxMs = 180000) {
  let lastLen = -1, stable = 0, lastTxt = '';
  for (let t = 8000; t <= maxMs; t += 8000) {
    await page.waitForTimeout(8000);
    try { lastTxt = await page.evaluate(() => document.body.innerText); } catch {}
    const hit = marks.filter((m) => lastTxt.includes(m));
    if (hit.length && lastTxt.length > 600 && lastTxt.length === lastLen) stable += 1; else stable = 0;
    lastLen = lastTxt.length;
    console.log(`  [${tag} ${t / 1000}s] len=${lastTxt.length} hits=${hit.join('|')} stable=${stable}`);
    if (hit.length && stable >= 2) break;
  }
  return lastTxt;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('response', (r) => {
  if (r.url().includes('/jxl-api/')) console.log('  [net]', r.status(), r.url().replace('http://127.0.0.1:3081', ''));
});
await page.goto(authUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

// ---- 登录 ----
console.log('校园工作:', await clickByText(page, '校园工作'));
await page.waitForTimeout(2500);
console.log('班主任待办:', await clickByText(page, '班主任待办'));
await page.waitForTimeout(9000);
try {
  const u = page.locator('input[autocomplete="username"]').first();
  if (await u.count()) {
    await u.fill('banzhuren', { timeout: 8000 });
    const p = page.locator('#personal-password').or(page.locator('input[type="password"]')).first();
    await p.fill('Bzr#2026Demo!', { timeout: 8000 });
    await page.waitForTimeout(600);
    console.log('提交登录:', await clickByText(page, '验证身份并进入'));
    await page.waitForTimeout(11000);
  } else { console.log('已登录'); }
} catch (e) { console.log('[warn] login:', e.message.slice(0, 150)); }
console.log('返回 Mochi:', await clickByText(page, '返回 Mochi'));
await page.waitForTimeout(6000);
await hideWorkbench(page);

// ---- 打开 A2A 会话 ----
console.log('打开会话:', await clickByText(page, '传给周医生取体温计'));
await page.waitForTimeout(6000);
await shot(page, 'i-00-session');
const txt0 = await page.evaluate(() => document.body.innerText);
console.log('--- session text ---\n' + txt0.slice(0, 900));

// ---- 点「确认发送」 ----
console.log('确认发送:', await clickByText(page, '确认发送'));
await page.waitForTimeout(3000);
await shot(page, 'i-01-after-confirm');

// ---- 等审批卡 ----
const txt1 = await waitFor(page, ['等待审批', '允许一次', '拒绝'], 'approval', 150000);
console.log('--- after confirm ---\n' + txt1.slice(-900));

if (txt1.includes('允许一次') || txt1.includes('等待审批')) {
  await shot(page, 'i-02-approval-card');
  console.log('允许一次:', await clickByText(page, '允许一次'));
  await page.waitForTimeout(20000);
  await waitFor(page, ['已送达', '已投递', '投递成功', '完成'], 'done', 120000);
  await shot(page, 'i-03-approved');
}

await browser.close();
console.log('[done]');
