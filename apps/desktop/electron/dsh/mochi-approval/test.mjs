import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { apply } from './index.mjs';

function installedListener() {
  let listener;
  apply({
    on(event, handler) {
      assert.equal(event, 'approval/request');
      assert.equal(listener, undefined, 'one safe listener should be registered');
      listener = handler;
    },
  });
  assert.equal(typeof listener, 'function');
  return listener;
}

const request = { toolName: 'jxl_relay_send', reason: 'test-only request' };

console.log('① no downstream UI/answerer: unavailable (fail closed)');
{
  const listener = installedListener();
  const result = await listener(request, async () => 'unavailable');
  assert.equal(result, 'unavailable');
}

console.log('② explicit downstream rejection is preserved');
{
  const listener = installedListener();
  const result = await listener(request, async () => 'rejected');
  assert.equal(result, 'rejected');
}

console.log('③ a real downstream answerer may grant once; this adapter only delegates');
{
  const listener = installedListener();
  let delegated = 0;
  const result = await listener(request, async () => {
    delegated += 1;
    return 'allowed-once';
  });
  assert.equal(delegated, 1);
  assert.equal(result, 'allowed-once');
}

console.log('④ malformed or failing downstream answerer: unavailable (fail closed)');
{
  const listener = installedListener();
  assert.equal(await listener(request, async () => ({ allowed: true })), 'unavailable');
  assert.equal(await listener(request, async () => { throw new Error('simulated answerer failure'); }), 'unavailable');
  assert.equal(await listener(request, undefined), 'unavailable');
}

console.log('⑤ installed Cordis waterfall delegates, then fails closed without an owner');
{
  const ctx = new Context();
  apply(ctx);
  assert.equal(
    await ctx.waterfall('approval/request', request, () => Promise.resolve('unavailable')),
    'unavailable',
  );

  let humanAnswererCalls = 0;
  ctx.on('approval/request', () => {
    humanAnswererCalls += 1;
    return 'allowed-once';
  });
  assert.equal(
    await ctx.waterfall('approval/request', request, () => Promise.resolve('unavailable')),
    'allowed-once',
  );
  assert.equal(humanAnswererCalls, 1, 'the grant must originate downstream');
}

console.log('mochi-approval tests passed: delegation only; no local auto-approval');
