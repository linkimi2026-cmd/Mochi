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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(authUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);
await page.mouse.move(800, 880);

// ---- A. 建模会话 + 展开画板 ----
try {
  await page.getByText('波的干涉与衍射建模', { exact: false }).first().click({ timeout: 8000 });
  await page.waitForTimeout(5000);
  await page.mouse.move(800, 880);
  await page.screenshot({ path: `${OUT}/shot-04-建模会话.png` });
  console.log('[ok] 建模会话');

  const expand = page.getByText('展开画板', { exact: false }).first();
  await expand.click({ timeout: 6000 });
  await page.waitForTimeout(8000);
  await page.mouse.move(800, 880);
  await page.screenshot({ path: `${OUT}/shot-05-建模画板.png` });
  console.log('[ok] 展开画板');
} catch (e) {
  console.log('[fail] 建模画板:', e.message.slice(0, 150));
}

// ---- B. 新会话 + 触发学生查询 ----
try {
  await page.getByText('新会话', { exact: false }).first().click({ timeout: 8000 });
  await page.waitForTimeout(3500);

  const input = page.locator('div[placeholder*="描述你想要构建"]').first();
  await input.click({ timeout: 8000 });
  await page.waitForTimeout(500);
  await page.keyboard.insertText('帮我看看现在有没有学生外出超时还没返班，用工具查一下');
  await page.waitForTimeout(1200);
  await page.mouse.move(800, 880);
  await page.screenshot({ path: `${OUT}/shot-06-输入中.png` });
  console.log('[ok] 输入完成');

  await page.keyboard.press('Enter');
  console.log('[send] 已发送，开始轮询');

  const marks = ['工具调用', '允许一次', '等待审批', '次工具调用', 'jxl_student_query', '未返班'];
  let captured = false;
  for (let i = 1; i <= 30; i++) {
    await page.waitForTimeout(10000);
    let txt = '';
    try { txt = await page.evaluate(() => document.body.innerText); } catch {}
    const hit = marks.filter((mk) => txt.includes(mk));
    console.log(`[t=${i * 10}s] len=${txt.length} hits=${hit.join('|')}`);
    if (hit.length > 0) {
      await page.mouse.move(800, 880);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/shot-07-学生查询.png` });
      console.log('[ok] 学生查询已截图，命中:', hit.join(','));
      captured = true;
      break;
    }
  }
  if (!captured) {
    await page.screenshot({ path: `${OUT}/shot-07-学生查询-超时.png` });
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('[timeout] 页面文本尾部:', txt.slice(-1500));
  }
} catch (e) {
  console.log('[fail] 学生查询:', e.message.slice(0, 200));
}

await browser.close();
console.log('[done]');
