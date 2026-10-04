import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Called by the isolated live-host fixture, never against a user's profile. */
export async function checkPaperAppearance(page, prefix = 'fixture-workspace') {
  const evidence = process.env.MOCHI_PAPER_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const dial = page.locator('.jxl-theme-dial').filter({ visible: true });
  if (!await dial.isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click();
  await dial.waitFor({ state: 'visible' });
  await dial.press('Home');
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'));
  assert.equal(await dial.getAttribute('data-preference'), 'light');
  const palette = await page.locator('[data-composer-card]').last().evaluate((card) => ({
    surface: getComputedStyle(card).backgroundColor,
    border: getComputedStyle(card).borderTopWidth,
    page: getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim(),
  }));
  assert.equal(palette.page, '#f6f3ec');
  assert.equal(palette.border, '1px');
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-composer-card]');
    return card && getComputedStyle(card).backgroundColor === 'rgb(255, 254, 250)';
  });
  const closeSettings = async () => { const close = page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }); if (await close.count()) await close.first().click(); };
  await closeSettings();
  if (evidence) await page.screenshot({ path: join(evidence, `${prefix}-light.png`) });
  if (!await dial.isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click();
  await dial.press('End');
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'));
  assert.equal(await dial.getAttribute('data-preference'), 'dark');
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-composer-card]');
    return card && getComputedStyle(card).backgroundColor === 'rgb(54, 51, 46)';
  });
  if (evidence) await page.screenshot({ path: join(evidence, `${prefix}-appearance.png`) });
  await closeSettings();
  if (evidence) await page.screenshot({ path: join(evidence, `${prefix}-dark.png`) });
  await page.reload();
  if (!await dial.isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click();
  await dial.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.jxl-theme-dial')?.dataset.preference === 'dark');
  await dial.press('ArrowLeft');
  assert.equal(await dial.getAttribute('data-preference'), 'system');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await dial.locator('.jxl-theme-dial__lever').evaluate((node) => getComputedStyle(node).transitionDuration), '0s');
  await dial.press('Home');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await closeSettings();
  console.log('[paper-ui] PASS: paper surfaces, light/dark/system, keyboard, persistence and reduced motion');
}
