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
console.log('[probe] auth url:', url);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.on('console', (m) => console.log('[page]', m.type(), m.text().slice(0, 200)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

await page.screenshot({ path: `${OUT}/probe-01.png`, fullPage: false });

const info = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input, textarea, button, [contenteditable="true"], [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      ph: el.getAttribute('placeholder'),
      cls: (el.className || '').toString().slice(0, 140),
      text: (el.innerText || '').trim().slice(0, 60),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  return { title: document.title, url: location.href, bodyText: document.body.innerText.slice(0, 3000), els: out };
});

console.log('=== TITLE ===', info.title);
console.log('=== BODYTEXT ===');
console.log(info.bodyText);
console.log('=== ELEMENTS ===');
console.log(JSON.stringify(info.els, null, 2));
await browser.close();
