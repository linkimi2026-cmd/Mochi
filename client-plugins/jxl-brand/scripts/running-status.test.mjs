import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const native = readFileSync(new URL('../../../apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js', import.meta.url), 'utf8');
const hero = readFileSync(new URL('../src/hero.tsx', import.meta.url), 'utf8');
const dictionary = vm.runInNewContext(`(${hero.match(/export const CHAT_DICT = (\{[\s\S]*?\n\});/u)[1]})`);
const body = native.slice(native.indexOf('const RunningStatus = '), native.indexOf('//#endregion', native.indexOf('const RunningStatus = ')));
const jsx = (type, props) => ({ type, props });
const RunningStatus = vm.runInNewContext(`${body}; RunningStatus`, {
  react: { memo: f => f, useState: () => [5000, () => {}], useEffect: () => {} },
  react_jsx_runtime: { jsx, jsxs: jsx },
  ChatView_module_css_default: {}, accessibility_module_css_default: {},
  RunningWhaleTail: 'native-decoration',
  _deepseek_ai_dsh_client_ui_primitives: { TextShimmer: 'native-shimmer' },
  Date, formatRunDuration: ms => [{ text: `${ms / 1000}秒` }],
});
for (const startTime of [undefined, 2000]) test(`native running status uses Mochi copy, start=${startTime}`, () => {
  const t = (key, values = {}) => dictionary[key]?.replace('{duration}', values.duration);
  const node = RunningStatus({ startTime, t });
  assert.equal(node.props['data-chat-running'], true);
  const [live, divider, content] = node.props.children;
  assert.equal(live.props.role, 'status');
  assert.equal(live.props.children, 'Mochi 探索中');
  assert.equal(divider.props['aria-hidden'], 'true');
  assert.equal(content.type, 'span');
  assert.equal(content.props.children[1].props.children,
    startTime === undefined ? 'Mochi 探索中' : 'Mochi 探索中，用时 3秒 ···');
  assert.match(hero, /\[data-chat-running\] > span:last-child > span\[aria-hidden="true"\]\{display:none;\}/u);
  assert.doesNotMatch(hero, /_turnStatus/u);
});
