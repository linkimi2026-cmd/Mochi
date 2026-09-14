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
page.on('response', (r) => {
  if (r.url().includes('/jxl-api/')) console.log('  [net]', r.status(), r.url().replace('http://127.0.0.1:3081', ''));
});
await page.goto(authUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

// ---- 1. 打开校园面板 ----
console.log('1 校园工作:', await clickByText(page, '校园工作'));
await page.waitForTimeout(2500);
console.log('2 班主任待办:', await clickByText(page, '班主任待办'));
await page.waitForTimeout(9000);

// ---- 2. 账号登录 ----
try {
  const u = page.locator('input[autocomplete="username"]').first();
  await u.fill('banzhuren', { timeout: 8000 });
  const p = page.locator('#personal-password').or(page.locator('input[type="password"]')).first();
  await p.fill('REDACTED_DEMO_PASSWORD', { timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/e-01-login-filled.png` });
  console.log('3 已填账号');
  console.log('4 提交:', await clickByText(page, '验证身份并进入'));
  await page.waitForTimeout(12000);
  await page.mouse.move(800, 400);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/e-02-campus-logged-in.png` });
  const t = await page.evaluate(() => document.body.innerText);
  console.log('--- after login ---\n' + t.slice(0, 1200));
} catch (e) {
  console.log('[fail] login:', e.message.slice(0, 200));
  await page.screenshot({ path: `${OUT}/e-02-login-fail.png` });
}

// ---- 3. 返回 Mochi 并发问 ----
console.log('5 返回 Mochi:', await clickByText(page, '返回 Mochi'));
await page.waitForTimeout(4000);
console.log('6 新会话:', await clickByText(page, '新会话'));
await page.waitForTimeout(4000);

try {
  const input = page.locator('[contenteditable="true"]:visible').last();
  await input.click({ timeout: 8000 });
  await page.waitForTimeout(400);
  await page.keyboard.insertText('帮我看看现在有没有学生外出超时还没返班，用工具查一下');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  console.log('7 已发送');

  const marks = ['工具调用', '允许一次', '等待审批', '未返班', '医务室', '已返班'];
  for (let i = 1; i <= 30; i++) {
    await page.waitForTimeout(10000);
    let txt = '';
    try { txt = await page.evaluate(() => document.body.innerText); } catch {}
    const hit = marks.filter((mk) => txt.includes(mk));
    console.log(`  [t=${i * 10}s] len=${txt.length} hits=${hit.join('|')}`);
    if (hit.length > 0) {
      await page.mouse.move(800, 100);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/e-03-student-query.png` });
      console.log('[ok] captured:', hit.join(','));
      break;
    }
  }
} catch (e) {
  console.log('[fail] chat:', e.message.slice(0, 200));
}

await browser.close();
console.log('[done]');
