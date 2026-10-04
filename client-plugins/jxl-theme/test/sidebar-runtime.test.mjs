import assert from 'node:assert/strict';
import { installSidebarLabels } from '../scripts/sidebar-runtime.mjs';

const tab = (id, extra = {}) => ({ id, type: 'editor', title: 'Files', ...extra });
const tabs = [tab('home'), tab('real-file', { path: '/work/Files' }), tab('custom', { title: '课堂资料' }), tab('web', { type: 'browser' })];
const bottom = tab('bottom');
const floating = tab('floating');
let state = { splits: { kind: 'split', children: [{ kind: 'leaf', tabs }] }, bottomSplits: { kind: 'leaf', tabs: [bottom] }, floats: [{ tab: floating }] };
let active = 'zh-JXL';
let onState, onLocale, updates = 0;
const sidebar = {
  features: ['updateTab', 'stateSubscription'],
  getSnapshot: () => ({ state }),
  subscribeState: (fn) => { onState = fn; return () => { onState = undefined; }; },
  updateTab: (id, patch) => {
    Object.assign([...tabs, bottom, floating].find((item) => item.id === id), patch);
    updates++;
    onState();
  },
};
const locale = { getSnapshot: () => ({ active }), subscribe: (fn) => { onLocale = fn; return () => { onLocale = undefined; }; } };
const dispose = installSidebarLabels({ inject: (_, callback) => callback({ betterSidebar: sidebar, locale }) });
assert.equal(updates, 3);
assert.equal(tabs[0].title, '文件');
assert.equal(tabs[1].title, 'Files', 'real filenames remain intact');
assert.equal(tabs[2].title, '课堂资料', 'custom titles remain intact');
assert.equal(tabs[3].title, 'Files', 'other tab types remain intact');
onState();
assert.equal(updates, 3, 'no subscription loop or redundant persistence');
active = 'en'; onLocale();
assert.equal(bottom.title, 'Files');
active = 'zh'; onLocale();
assert.equal(floating.title, '文件');
state = undefined; onState();
dispose();
assert.equal(onState, undefined);
assert.equal(onLocale, undefined);
console.log('PASS sidebar labels: nested panes, floating windows, locale changes, custom names and disposal');
