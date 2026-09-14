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
  const n = await page.evaluate(() => {
    let hidden = 0;
    for (const el of document.querySelectorAll('[data-shell-overlay="true"]')) {
      for (const child of [...el.children]) {
        const r = child.getBoundingClientRect();
        if (r.width > 200 && r.width < 700 && r.height > 300 && r.right > window.innerWidth - 40) {
          child.style.display = 'none';
          hidden += 1;
        }
      }
    }
    return hidden;
  });
  if (n) console.log('  [ui] 隐藏右侧工作台面板:', n);
  return n;
}

async function ask(page, text, marks, tag, maxMs = 200000) {
  const focused = await page.evaluate(() => {
    const el = document.querySelector('[contenteditable="true"][data-composer-input="true"]');
    if (!el) return false;
    el.focus();
    return true;
  });
  if (!focused) throw new Error('composer not found');
  await page.waitForTimeout(500);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  console.log(`[ask:${tag}] sent`);
  let lastLen = -1;
  let stable = 0;
  let lastTxt = '';
  for (let t = 10000; t <= maxMs; t += 10000) {
    await page.waitForTimeout(10000);
    try { lastTxt = await page.evaluate(() => document.body.innerText); } catch {}
    const hit = marks.filter((m) => lastTxt.includes(m));
    if (hit.length && lastTxt.length > 700 && lastTxt.length === lastLen) stable += 1;
    else stable = 0;
    lastLen = lastTxt.length;
    console.log(`  [${tag} ${t / 1000}s] len=${lastTxt.length} hits=${hit.join('|')} stable=${stable}`);
    if (hit.length && stable >= 2) break;
  }
  await hideWorkbench(page);
  await page.mouse.move(800, 100);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
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
    await p.fill('REDACTED_DEMO_PASSWORD', { timeout: 8000 });
    await page.waitForTimeout(600);
    console.log('提交登录:', await clickByText(page, '验证身份并进入'));
    await page.waitForTimeout(11000);
  } else { console.log('已登录'); }
} catch (e) { console.log('[warn] login:', e.message.slice(0, 150)); }
await page.mouse.move(800, 400);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/g-00-campus.png` });

// ---- 轮 1：学生查询 ----
console.log('新会话:', await clickByText(page, '新会话'));
await page.waitForTimeout(5000);
try {
  await ask(page, '帮我看看现在有没有学生外出超时还没返班，用工具查一下', ['工具调用', '返班', '林小禾'], 'g-01-student-query');
} catch (e) { console.log('[fail] q1:', e.message.slice(0, 150)); }

// ---- 轮 2：A2A + 审批 ----
console.log('新会话:', await clickByText(page, '新会话'));
await page.waitForTimeout(5000);
try {
  await ask(page, '帮我给周医生带句话：今天下午三点我到医务室拿体温计，请等我。', ['工具调用', '审批', '允许一次', '传话', '周医生'], 'g-02-a2a-approval', 160000);
} catch (e) { console.log('[fail] q2:', e.message.slice(0, 150)); }

// ---- 放行审批 ----
try {
  const btn = page.getByText('允许一次', { exact: false }).first();
  if (await btn.count()) {
    await btn.click({ timeout: 6000 });
    console.log('[ok] 已点「允许一次」');
    await page.waitForTimeout(16000);
    await hideWorkbench(page);
    await page.mouse.move(800, 100);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/g-03-approved.png` });
  } else { console.log('[skip] 无审批按钮'); }
} catch (e) { console.log('[warn] approve:', e.message.slice(0, 150)); }

await browser.close();
console.log('[done]');
