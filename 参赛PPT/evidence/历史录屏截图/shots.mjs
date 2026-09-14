import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire('/Users/a1379/Documents/Mochi/apps/desktop/package.json');
const { chromium } = require('playwright');

const LOG = '/tmp/mochi-web.log';
const OUT = '/Users/a1379/Documents/Mochi/参赛PPT/_shots';

function authUrl() {
  const text = readFileSync(LOG, 'utf8');
  const matches = [...text.matchAll(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_\-]+/g)];
  if (!matches.length) throw new Error('no auth url in log');
  return matches[matches.length - 1][0];
}

const url = authUrl();
console.log('[shots] auth url:', url);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);
await page.mouse.move(800, 880);
await page.waitForTimeout(500);

// ---- 1. 首页 ----
await page.screenshot({ path: `${OUT}/shot-01-home.png` });
console.log('[ok] home');

// ---- 探测输入框 ----
const inputs = await page.evaluate(() => {
  const sel = 'textarea, input[type="text"], [contenteditable="true"]';
  return [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      ph: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
      cls: String(el.className || '').slice(0, 90),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    };
  }).filter((e) => e.w > 100 && e.h > 20);
});
console.log('=== INPUTS ===');
console.log(JSON.stringify(inputs, null, 2));

// ---- 侧栏会话列表 ----
const sessions = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('div, span, a, li')) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 30 || t.includes('\n')) continue;
    const r = el.getBoundingClientRect();
    if (r.x > 260 || r.width < 60 || r.height < 16 || r.height > 44) continue;
    out.push({ t, x: Math.round(r.x), y: Math.round(r.y) });
  }
  return out;
});
console.log('=== SIDEBAR ITEMS ===');
console.log(JSON.stringify(sessions.slice(0, 40), null, 2));

// ---- 2. 点开历史会话 ----
const targets = ['波的干涉与衍射建模', '用平面切圆锥建模', '寻找其他Agent助手', '介绍勾股定理'];
let idx = 2;
for (const name of targets) {
  try {
    const loc = page.getByText(name, { exact: false }).first();
    await loc.click({ timeout: 8000 });
    await page.waitForTimeout(5000);
    await page.mouse.move(800, 880);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/shot-${String(idx).padStart(2, '0')}-${name}.png` });
    console.log(`[ok] session: ${name}`);
  } catch (e) {
    console.log(`[fail] session: ${name} -> ${e.message.slice(0, 120)}`);
  }
  idx += 1;
}

await browser.close();
console.log('[done]');
