import assert from 'node:assert/strict';
import test from 'node:test';
import { petPalettes } from '../scripts/pet-palettes.mjs';
import { installPaperFeedback } from '../scripts/paper-runtime.mjs';

function harness({ muted = false, failSave = false } = {}) {
  const saved = Object.fromEntries(['document', 'MutationObserver', 'window'].map((key) => [key, globalThis[key]]));
  let observe;
  let disconnected = false;
  let preference = 'light';
  let component;
  const listeners = new Set();
  const cleanups = [];
  const nativeModes = [];
  const nativePalettes = [];
  const writes = [];
  const soundListeners = new Set();
  const soundWrites = [];
  let soundSnapshot = { status: 'ready', writable: true, value: { uiSound: !muted } };
  const soundScope = {
    getSnapshot: () => soundSnapshot,
    subscribe(fn) { soundListeners.add(fn); return () => soundListeners.delete(fn); },
    async set(field, value) {
      if (failSave) throw Error('offline');
      soundWrites.push({ field, value });
      soundSnapshot = { ...soundSnapshot, value: { ...soundSnapshot.value, [field]: value } };
      soundListeners.forEach(fn => fn());
    },
  };
  globalThis.document = { body: {}, documentElement: { dataset: {} } };
  globalThis.window = { mochiRailDesktop: { setPetPalette: value => nativePalettes.push(value), setAppearance: (value) => nativeModes.push(value) } };
  globalThis.MutationObserver = class {
    constructor(callback) { observe = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const scope = {
    settingsScope: { bind: () => soundScope },
    effect(fn) { cleanups.push(fn()); },
    theme: {
      getTheme: () => ({ preference }),
      setTheme(value) {
        writes.push(value);
        preference = value;
        for (const listener of listeners) listener({ preference });
      },
    },
    on(event, listener) {
      assert.equal(event, 'theme/change');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    slots: {
      inject(name, fn) { assert.equal(name, 'settings.general.item'); fn(); },
      register(_definition, fn) { component = fn; },
    },
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial(), () => {}],
    useEffect: (fn) => cleanups.push(fn()),
  };
  installPaperFeedback({ ...scope, inject(_keys, fn) { fn(scope); } }, React, undefined, petPalettes);
  return {
    observe: (records) => observe(records),
    render: () => component({ wide: true }),
    writes, nativeModes, nativePalettes, soundWrites,
    get disconnected() { return disconnected; },
    dispose() {
      for (const cleanup of cleanups.reverse()) cleanup?.();
      assert.equal(listeners.size, 0);
      assert.equal(soundListeners.size, 0);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    },
  };
}

test('native submission decorates once, preserves drafts and releases timers on disposal', () => {
  const h = harness();
  const attributes = new Map();
  const card = { setAttribute: (k, v) => attributes.set(k, v), removeAttribute: (k) => attributes.delete(k) };
  let phase = 'active';
  const input = { textContent: '保留这份草稿', matches: () => true, getAttribute: () => phase, closest: () => card };
  try {
    h.observe([{ target: input, oldValue: 'active' }]);
    assert.equal(attributes.size, 0, 'editing does not imply a submission');
    phase = 'submitting';
    h.observe([{ target: input, oldValue: 'active' }]);
    assert.equal(attributes.has('data-jxl-feeding'), true);
    phase = 'active';
    h.observe([{ target: input, oldValue: 'submitting' }]);
    assert.equal(input.textContent, '保留这份草稿', 'failed submission cannot clear the draft');
    assert.deepEqual(h.writes, [], 'feedback never writes preferences or submits messages');
  } finally { h.dispose(); }
  assert.equal(attributes.size, 0, 'disposal removes active feedback');
  assert.equal(h.disconnected, true);
});

test('rotary appearance control uses durable DSH preference, keyboard bounds and native sync', () => {
  const h = harness();
  try {
    const button = h.render().children.find(child => child?.props?.className === 'jxl-theme-dial');
    const key = (key) => button.props.onKeyDown({ key, preventDefault() {} });
    assert.deepEqual(h.nativeModes, ['light']);
    button.props.onClick();
    assert.equal(h.writes.at(-1), 'system');
    key('End');
    assert.equal(h.writes.at(-1), 'dark');
    key('ArrowRight');
    assert.equal(h.writes.at(-1), 'dark', 'keyboard does not wrap past the last mode');
    button.props.onClick();
    assert.equal(h.writes.at(-1), 'light', 'click cycles to the first mode');
    assert.deepEqual(h.nativeModes, ['light', ...h.writes]);
  } finally { h.dispose(); }
});

test('a delayed submission failure does not replay the feed animation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const attributes = new Map();
  const card = { setAttribute: (k, v) => attributes.set(k, v), removeAttribute: (k) => attributes.delete(k) };
  let phase = 'submitting';
  const input = { matches: () => true, getAttribute: () => phase, closest: () => card };
  try {
    h.observe([{ target: input, oldValue: 'active' }]);
    assert.equal(attributes.has('data-jxl-feeding'), true);
    t.mock.timers.tick(700);
    assert.equal(attributes.size, 0);
    phase = 'active';
    h.observe([{ target: input, oldValue: 'submitting' }]);
    assert.equal(attributes.size, 0, 'a completion or failure is not another send');
    h.observe([{ target: input, oldValue: 'active' }, { target: input, oldValue: 'submitting' }]);
    assert.equal(attributes.has('data-jxl-feeding'), true, 'a separate synchronous submit still gives feedback');
  } finally { h.dispose(); }
});


test('sound restores Host preference and commits only the sound field', async () => {
  const h = harness({ muted: true });
  try {
    const toggle = () => h.render().children.find(child => child?.props?.className === 'jxl-sound-toggle');
    assert.equal(toggle().props['aria-pressed'], false);
    await toggle().props.onClick();
    assert.equal(toggle().props['aria-pressed'], true);
    assert.deepEqual(h.soundWrites, [{ field: 'uiSound', value: true }]);
  } finally { h.dispose(); }
});

test('failed sound persistence retains the accepted preference and allows retry', async () => {
  const h = harness({ muted: true, failSave: true });
  try {
    await h.render().children.find(child => child?.props?.className === 'jxl-sound-toggle').props.onClick();
    const toggle = h.render().children.find(child => child?.props?.className === 'jxl-sound-toggle');
    assert.equal(toggle.props['aria-pressed'], false);
    assert.equal(toggle.props.disabled, false);
    assert.match(toggle.props.title, /未保存/);
    assert.deepEqual(h.soundWrites, []);
  } finally { h.dispose(); }
});

function findButton(node,label){
  if(!node || typeof node!=='object')return;
  if(node.type==='button' && node.props['aria-label']===label)return node;
  for(const child of (node.children||[]).flat(Infinity)){const result=findButton(child,label);if(result)return result;}
}
test('pet palette persists only its own field, broadcasts after success, and keeps the original default',async()=>{
  const h=harness();try{
    assert.equal(findButton(h.render(),'经典焦糖').props['aria-pressed'],true);
    await findButton(h.render(),'奶油米白').props.onClick();
    assert.deepEqual(h.soundWrites,[{field:'petPalette',value:'cream'}]);
    assert.equal(h.nativePalettes.at(-1),'cream');
    assert.equal(document.documentElement.dataset.mochiPetPalette,'cream');
    assert.equal(findButton(h.render(),'奶油米白').props['aria-pressed'],true);
    assert.equal(findButton(h.render(),'关闭界面音效').props['aria-pressed'],true);
  }finally{h.dispose();}
});
test('failed pet palette save keeps the confirmed palette and allows retry',async()=>{
  const h=harness({failSave:true});try{
    await findButton(h.render(),'鼠尾草绿').props.onClick();
    assert.equal(h.nativePalettes.at(-1),'caramel');
    assert.equal(findButton(h.render(),'经典焦糖').props['aria-pressed'],true);
    assert.equal(findButton(h.render(),'鼠尾草绿').props.disabled,false);
    assert.ok(JSON.stringify(h.render()).includes('配色未保存，请重试'));
  }finally{h.dispose();}
});
