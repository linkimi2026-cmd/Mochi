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
    const el = els[els.length - 1];
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
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

// ---- 1. 进建模会话 ----
console.log('session:', await clickByText(page, '波的干涉与衍射建模'));
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/b-01-session.png` });

// ---- 2. 展开画板 ----
console.log('expand:', await clickByText(page, '展开画板'));
await page.waitForTimeout(9000);
await page.mouse.move(800, 60);
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/b-02-board.png` });

// ---- 3. 新会话 ----
console.log('new:', await clickByText(page, '新会话'));
await page.waitForTimeout(4500);
await page.mouse.move(800, 100);
await page.screenshot({ path: `${OUT}/b-03-new.png` });

// ---- 4. 输入并发送 ----
const input = page.locator('[contenteditable="true"]:visible').last();
try {
  await input.click({ timeout: 8000 });
  await page.waitForTimeout(400);
  await page.keyboard.insertText('帮我看看现在有没有学生外出超时还没返班，用工具查一下');
  await page.waitForTimeout(1500);
  await page.mouse.move(800, 100);
  await page.screenshot({ path: `${OUT}/b-04-typed.png` });
  console.log('[ok] typed');

  await page.keyboard.press('Enter');
  console.log('[send] sent');

  const marks = ['工具调用', '允许一次', '等待审批', 'jxl_student_query', '未返班', '医务室'];
  let captured = false;
  for (let i = 1; i <= 30; i++) {
    await page.waitForTimeout(10000);
    let txt = '';
    try { txt = await page.evaluate(() => document.body.innerText); } catch {}
    const hit = marks.filter((mk) => txt.includes(mk));
    console.log(`[t=${i * 10}s] len=${txt.length} hits=${hit.join('|')}`);
    if (hit.length > 0) {
      await page.mouse.move(800, 100);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/b-05-student-query.png` });
      console.log('[ok] captured:', hit.join(','));
      captured = true;
      break;
    }
  }
  if (!captured) {
    await page.screenshot({ path: `${OUT}/b-05-timeout.png` });
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('[timeout] tail:', txt.slice(-1200));
  }
} catch (e) {
  console.log('[fail] input:', e.message.slice(0, 200));
}

await browser.close();
console.log('[done]');
