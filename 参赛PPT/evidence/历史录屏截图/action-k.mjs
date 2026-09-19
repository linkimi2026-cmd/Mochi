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

// 持续隐藏右侧工作台面板（对抗 React 重建）
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

async function typeAndSend(page, text) {
  await installHider(page);
  const ok = await page.evaluate(() => {
    const el = document.querySelector('[contenteditable="true"][data-composer-input="true"]');
    if (!el) return false; el.focus(); return true;
  });
  if (!ok) throw new Error('composer not found');
  await page.waitForTimeout(400);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
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
await installHider(page);
await shot(page, 'k-01-campus');

console.log('返回 Mochi:', await clickByText(page, '返回 Mochi'));
await page.waitForTimeout(6000);
await installHider(page);
await shot(page, 'k-02-home');

// ---- A2A：发消息 → 审批卡 ----
console.log('新会话:', await clickByText(page, '新会话'));
await page.waitForTimeout(5000);
await installHider(page);
await typeAndSend(page, '帮我给周医生带句话：今天下午三点我到医务室拿体温计，请等我。');
console.log('[sent a2a]');

// 第一个卡（工作模式 或 确认卡 或 审批卡）
const t1 = await poll(page, ['等待审批', '允许一次', '确认发送', '确认把以上口信投递'], 'card-1', 150000, 1);
await shot(page, 'k-03-card1');
console.log('--- card1 tail ---\n' + t1.slice(-600));

// 若是确认卡 → 点确认发送
if (t1.includes('确认发送') && !t1.includes('允许一次')) {
  console.log('确认发送:', await clickByText(page, '确认发送'));
  await page.waitForTimeout(5000);
}

// 循环放行审批卡，直到出现传话审批
for (let round = 1; round <= 4; round++) {
  const txt = await page.evaluate(() => document.body.innerText);
  if (!txt.includes('允许一次')) { console.log(`  [round ${round}] 无审批按钮，停`); break; }
  const isRelay = txt.includes('的 Mochi') || txt.includes('派一个请求任务') || txt.includes('口信') || txt.includes('投递');
  console.log(`  [round ${round}] 审批卡，是否传话类=${isRelay}`);
  if (isRelay) {
    await shot(page, 'k-04-a2a-approval');
    console.log('允许一次:', await clickByText(page, '允许一次'));
    await page.waitForTimeout(8000);
    await poll(page, ['已送达', '已投递', '投递成功', '已转达', '完成'], 'relay-done', 100000, 2);
    await shot(page, 'k-05-a2a-done');
    break;
  } else {
    console.log('允许一次(非传话卡):', await clickByText(page, '允许一次'));
    await page.waitForTimeout(10000);
    await poll(page, ['等待审批', '允许一次', '投递', '口信'], 'next-card', 100000, 1);
  }
}

await browser.close();
console.log('[done]');
