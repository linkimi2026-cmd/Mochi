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
  await page.waitForTimeout(350);
  await hideWorkbench(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  [shot] ${name}`);
}

async function poll(page, marks, tag, maxMs = 150000, needStable = 2) {
  let lastLen = -1, stable = 0, lastTxt = '';
  for (let t = 6000; t <= maxMs; t += 6000) {
    await page.waitForTimeout(6000);
    try { lastTxt = await page.evaluate(() => document.body.innerText); } catch {}
    const hit = marks.filter((m) => lastTxt.includes(m));
    if (hit.length && lastTxt.length > 600 && lastTxt.length === lastLen) stable += 1; else stable = 0;
    lastLen = lastTxt.length;
    console.log(`  [${tag} ${t / 1000}s] len=${lastTxt.length} hits=${hit.join('|')} stable=${stable}`);
    if (hit.length && stable >= needStable) break;
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

// ---- 新会话 + 发 A2A ----
console.log('新会话:', await clickByText(page, '新会话'));
await page.waitForTimeout(5000);
await hideWorkbench(page);
const ok = await page.evaluate(() => {
  const el = document.querySelector('[contenteditable="true"][data-composer-input="true"]');
  if (!el) return false; el.focus(); return true;
});
console.log('composer focused:', ok);
await page.keyboard.insertText('用传话工具帮我给周医生带句话：今天下午三点我到医务室拿体温计，请等我。');
await page.waitForTimeout(1200);
await page.keyboard.press('Enter');
console.log('[sent]');

// ---- 等确认卡 ----
const t1 = await poll(page, ['确认把以上口信投递', '确认发送', '投递内容'], 'confirm-card', 150000);
await shot(page, 'j-01-confirm-card');
console.log('--- confirm card ---\n' + t1.slice(-700));

// ---- 点确认发送 ----
console.log('确认发送:', await clickByText(page, '确认发送'));
await page.waitForTimeout(4000);

// ---- 等审批卡 ----
const t2 = await poll(page, ['等待审批', '允许一次'], 'approval-card', 150000);
await shot(page, 'j-02-approval-card');
console.log('--- approval ---\n' + t2.slice(-700));

// ---- 放行 ----
if (t2.includes('允许一次')) {
  console.log('允许一次:', await clickByText(page, '允许一次'));
  await page.waitForTimeout(8000);
  const t3 = await poll(page, ['已送达', '已投递', '投递成功', '已完成'], 'after-approve', 120000);
  await shot(page, 'j-03-approved');
  console.log('--- after approve ---\n' + t3.slice(-700));
}

await browser.close();
console.log('[done]');
