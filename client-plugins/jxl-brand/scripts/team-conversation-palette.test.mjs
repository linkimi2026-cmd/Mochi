import assert from 'node:assert/strict';
import test from 'node:test';
import { scopeTeamConversationPalette } from '../src/team-conversation-palette.mjs';

function content(session, palette = null) {
  const attributes = new Map([['data-conversation-session', session]]);
  if (palette !== null) attributes.set('data-mochi-pet-palette', palette);
  return {
    matches: selector => selector === '[data-conversation-content]',
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
  };
}
const anchor = children => ({ closest: () => ({ parentElement: { children } }) });
const color = node => node.getAttribute('data-mochi-pet-palette');

test('colors only the exact session in its own pane and restores the prior value', () => {
  const current = content('child', 'cream');
  const other = content('lead');
  const secondPane = content('child', 'caramel');
  const restore = scopeTeamConversationPalette(anchor([other, current]), 'child', 'sage');
  assert.equal(color(current), 'sage');
  assert.equal(color(other), null);
  assert.equal(color(secondPane), 'caramel');
  restore();
  assert.equal(color(current), 'cream');
});

test('switch/unmount removes only its own previously absent attribute', () => {
  const node = content('child');
  const restore = scopeTeamConversationPalette(anchor([node]), 'child', 'sage');
  restore();
  assert.equal(color(node), null);
  const nextRestore = scopeTeamConversationPalette(anchor([node]), 'child', 'peach');
  node.setAttribute('data-mochi-pet-palette', 'cream');
  nextRestore();
  assert.equal(color(node), 'cream');
});

test('missing or mismatched local DOM contracts do not color any content', () => {
  const node = content('other');
  scopeTeamConversationPalette(anchor([node]), 'child', 'sage')();
  scopeTeamConversationPalette(null, 'child', 'sage')();
  assert.equal(color(node), null);
});
