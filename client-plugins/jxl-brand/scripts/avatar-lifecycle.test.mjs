import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  toggle(name, force) {
    const names = new Set(this.element.className.split(/\s+/u).filter(Boolean));
    if (force) names.add(name);
    else names.delete(name);
    this.element.className = [...names].join(' ');
  }

  contains(name) {
    return this.element.className.split(/\s+/u).includes(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.classList = new FakeClassList(this);
    this.style = {};
    this.textContent = '';
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, before) {
    child.parentNode = this;
    const index = before === null ? -1 : this.children.indexOf(before);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error('child is not attached');
    this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return descendants(this).filter((element) => matches(element, selector));
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement('head');
    this.body = new FakeElement('body');
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return [this.head, this.body, ...descendants(this.head), ...descendants(this.body)]
      .find((element) => element.id === id) ?? null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    return [...descendants(this.head), ...descendants(this.body)]
      .filter((element) => matches(element, selector));
  }
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function matches(element, selector) {
  if (selector === '.jxl-msg-avatar-row') return element.classList.contains('jxl-msg-avatar-row');
  if (selector === '.jxl-msg-avatar-status') return element.classList.contains('jxl-msg-avatar-status');
  if (selector === '.jxl-pending-mochi--approval') return element.classList.contains('jxl-pending-mochi--approval');
  if (selector === '[data-streaming]') return element.hasAttribute('data-streaming');
  if (selector === '[data-streaming="true"]') return element.getAttribute('data-streaming') === 'true';
  if (selector === '[data-chat-flow]') return element.hasAttribute('data-chat-flow');
  if (selector === '[data-conversation-scroll]') return element.hasAttribute('data-conversation-scroll');
  if (selector === '[data-composer-seat]') return element.hasAttribute('data-composer-seat');
  if (selector === '[data-conversation-scroll] > [data-composer-seat]') {
    return element.hasAttribute('data-composer-seat') && element.parentNode?.hasAttribute('data-conversation-scroll');
  }
  if (selector === '[data-approval-key]') return element.hasAttribute('data-approval-key');
  if (selector === '[data-jxl-mochi-pending]') return element.hasAttribute('data-jxl-mochi-pending');
  if (selector === 'div[data-chat-flow-kind="assistant-step"]') {
    return element.tagName === 'div' && element.getAttribute('data-chat-flow-kind') === 'assistant-step';
  }
  return false;
}

function createSession(id, running) {
  let snapshot = { running };
  const listeners = new Set();
  return {
    sessionId: id,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener();
    },
    listeners: () => [...listeners],
  };
}

function conversationScroll(document) {
  const scroll = document.createElement('div');
  scroll.setAttribute('data-conversation-scroll', '');
  document.body.appendChild(scroll);
  return scroll;
}

function chatFlow(document, parent = document.body) {
  const flow = document.createElement('div');
  flow.setAttribute('data-chat-flow', '');
  parent.appendChild(flow);
  return flow;
}

function composerSeat(document, parent = document.body) {
  const seat = document.createElement('div');
  seat.setAttribute('data-composer-seat', '');
  const nativeComposer = document.createElement('div');
  nativeComposer.className = 'native-composer';
  seat.appendChild(nativeComposer);
  parent.appendChild(seat);
  return { seat, nativeComposer };
}

function assistantStep(document, parent, { streaming } = {}) {
  const step = document.createElement('div');
  step.setAttribute('data-chat-flow-kind', 'assistant-step');
  let content;
  if (streaming !== undefined) {
    content = document.createElement('div');
    content.setAttribute('data-streaming', String(streaming));
    step.appendChild(content);
  }
  parent.appendChild(step);
  return { step, content };
}

function approvalPanel(document, key) {
  const panel = document.createElement('div');
  panel.setAttribute('data-approval-key', key);
  const nativeCard = document.createElement('div');
  nativeCard.className = 'native-approval-card';
  const nativeButton = document.createElement('button');
  nativeCard.appendChild(nativeButton);
  panel.appendChild(nativeCard);
  document.body.appendChild(panel);
  return { panel, nativeCard, nativeButton };
}

function avatar(step) {
  const row = step.querySelector('.jxl-msg-avatar-row');
  assert.ok(row, 'assistant step should receive a Mochi avatar');
  return row;
}

function avatarState(step) {
  return avatar(step).getAttribute('data-jxl-avatar-state');
}

function avatarText(step) {
  return avatar(step).querySelector('.jxl-msg-avatar-status')?.textContent;
}

function pendingHosts(document) {
  return document.querySelectorAll('[data-jxl-mochi-pending]');
}

function activeMochiCount(document) {
  const typingAvatars = document.querySelectorAll('.jxl-msg-avatar-row')
    .filter((row) => row.getAttribute('data-jxl-avatar-state') === 'typing');
  return typingAvatars.length + pendingHosts(document).length;
}

test('one current Mochi covers official running, streaming, and approval lifecycle phases', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(client, /const inject = \["slots", "locale", "sessions", "uiSession"\]/u);
  assert.match(client, /SessionSnapshot\.running/u);
  assert.match(client, /\[data-streaming="true"\]/u);
  assert.match(client, /pendingInteractions\.getSnapshot\(\)/u);
  assert.match(client, /pointer-events:none/u);
  assert.match(client, /currentComposerSeat/u);
  assert.match(client, /insertBefore\(host, parent\.firstChild\)/u);
  assert.match(client, /Mochi 正在处理/u);
  assert.match(client, /jxl-pending-mochi--flow\{position:relative/u);
  assert.doesNotMatch(client, /querySelectorAll\("button"\)/u);
  assert.doesNotMatch(client, /turn-process/u);
  assert.doesNotMatch(client, /scrollIntoView/u);
  assert.doesNotMatch(client, /scrollTop\s*=/u);
  assert.match(client, /prefers-reduced-motion/u);
  assert.match(client, /orb-companion__laptop/u);

  const document = new FakeDocument();
  const sessionA = createSession('session-a', true);
  const sessionB = createSession('session-b', false);
  const bindings = new Map([
    ['session-a', { sessionId: 'session-a', session: sessionA }],
    ['session-b', { sessionId: 'session-b', session: sessionB }],
  ]);
  let current = 'session-a';
  const listListeners = new Set();
  const list = {
    getSnapshot: () => ({ current }),
    subscribe(listener) {
      listListeners.add(listener);
      return () => listListeners.delete(listener);
    },
  };
  let pending = new Map();
  const pendingListeners = new Set();
  const pendingInteractions = {
    getSnapshot: () => pending,
    subscribe(listener) {
      pendingListeners.add(listener);
      return () => pendingListeners.delete(listener);
    },
  };
  const setPending = (next) => {
    pending = next;
    for (const listener of pendingListeners) listener();
  };
  const roots = new Map();
  const moduleLoader = { definition: null, load(definition) { this.definition = definition; } };
  const effects = new Map();
  const observers = [];
  class FakeMutationObserver {
    constructor(listener) {
      this.listener = listener;
      this.connected = false;
      observers.push(this);
    }

    observe() {
      this.connected = true;
    }

    disconnect() {
      this.connected = false;
    }
  }
  const triggerMutation = () => {
    for (const observer of observers) if (observer.connected) observer.listener();
  };
  let nextFrame = 0;
  const frames = new Map();
  const flushFrames = () => {
    while (frames.size > 0) {
      const queued = [...frames.values()];
      frames.clear();
      for (const callback of queued) callback();
    }
  };
  const context = vm.createContext({
    window: { __ModuleLoader__: moduleLoader },
    document,
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame: (callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    console,
  });
  vm.runInContext(client, context, { filename: 'jxl-brand/client.js' });
  const fakeReact = {
    useEffect: () => undefined,
    useId: () => 'test',
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => undefined],
  };
  const plugin = moduleLoader.definition.factory((name) => {
    if (name === 'react') return fakeReact;
    if (name === 'react/jsx-runtime') return {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
      Fragment: Symbol.for('fragment'),
    };
    if (name === 'react-dom/client') return {
      createRoot(element) {
        const root = {
          renders: [],
          unmounted: false,
          render(value) { this.renders.push(value); },
          unmount() { this.unmounted = true; },
        };
        roots.set(element, root);
        return root;
      },
    };
    throw new Error(`unexpected module request: ${name}`);
  });

  const scroll = conversationScroll(document);
  const flowA = chatFlow(document, scroll);
  const composerA = composerSeat(document, scroll);
  const historicalA = assistantStep(document, flowA).step;
  const falseStreamingA = assistantStep(document, flowA, { streaming: false });
  plugin.apply({
    sessions: { list, binding: (id) => bindings.get(id) },
    uiSession: { pendingInteractions },
    slots: { inject: () => () => {}, register: () => () => {} },
    locale: {
      addLanguage: () => () => {},
      register: () => () => {},
      getSnapshot: () => ({ active: 'zh' }),
      setLocale: () => () => {},
    },
    effect(effect, label) {
      const dispose = effect();
      effects.set(label, dispose);
      return () => dispose?.();
    },
  });

  // First-token wait and a tool-only running turn have no visible streaming assistant.
  // data-streaming="false" is explicitly not an active official stream.
  assert.equal(avatarState(historicalA), 'idle');
  assert.equal(avatarState(falseStreamingA.step), 'idle');
  assert.equal(pendingHosts(document).length, 1, 'first-token/tool wait receives one composer-adjacent Mochi');
  assert.equal(pendingHosts(document)[0].parentNode, composerA.seat, 'first-token/tool wait belongs in the measured sticky composer seat');
  assert.equal(composerA.seat.children[0], pendingHosts(document)[0], 'the compact indicator stays above the native composer');
  assert.equal(composerA.seat.children[1], composerA.nativeComposer, 'the native composer remains intact and interactive');
  assert.equal(roots.get(pendingHosts(document)[0]).renders.at(-1).props.compact, true);
  assert.equal(activeMochiCount(document), 1);

  // When native markdown starts streaming, its current avatar replaces the composer-adjacent Mochi.
  const activeA = assistantStep(document, flowA, { streaming: true }).step;
  triggerMutation();
  flushFrames();
  assert.equal(pendingHosts(document).length, 0, 'text streaming must not double-render a pending Mochi');
  assert.equal(avatarState(activeA), 'typing');
  assert.equal(avatarText(activeA), 'Mochi 正在生成回复…');
  assert.equal(avatarState(falseStreamingA.step), 'idle', 'data-streaming=false never activates an avatar');
  assert.equal(activeMochiCount(document), 1, 'tool/typing transition leaves exactly one active Mochi');

  // Both correlated and callId-free native approvals retain their card. The alert Mochi is
  // appended after it because the official detail slot is a single shipped command renderer.
  falseStreamingA.content.setAttribute('data-streaming', 'false');
  activeA.querySelector('[data-streaming="true"]').setAttribute('data-streaming', 'false');
  const approvalA = approvalPanel(document, 'approval-a');
  setPending(new Map([['session-a', { kind: 'approval', key: 'approval-a', callId: 'tool-call-a' }]]));
  triggerMutation();
  flushFrames();
  assert.equal(pendingHosts(document).length, 1);
  const approvalHost = pendingHosts(document)[0];
  assert.equal(approvalHost.parentNode, approvalA.panel, 'approval Mochi is appended to the native card');
  assert.equal(approvalA.panel.children[0], approvalA.nativeCard, 'native approval content and buttons stay first');
  assert.equal(approvalA.nativeCard.children[0], approvalA.nativeButton);
  assert.equal(roots.get(approvalHost).renders.at(-1).props.state, 'alert');
  assert.equal(activeMochiCount(document), 1, 'approval replaces the composer indicator instead of duplicating it');

  // After approval, a still-running turn resumes the composer indicator. A rejected/cancelled
  // turn clears it when the official running state becomes false.
  setPending(new Map());
  flushFrames();
  assert.equal(pendingHosts(document).length, 1, 'approval resolution resumes the current running indicator');
  assert.equal(pendingHosts(document)[0].parentNode, composerA.seat);
  assert.equal(composerA.seat.children[1], composerA.nativeComposer, 'resuming the indicator never replaces the native composer');
  setPending(new Map([['session-a', { kind: 'approval', key: 'approval-reject' }]]));
  const approvalReject = approvalPanel(document, 'approval-reject');
  triggerMutation();
  flushFrames();
  assert.equal(pendingHosts(document)[0].parentNode, approvalReject.panel);
  sessionA.setSnapshot({ running: false, lastAgentError: { code: 'CANCELLED' } });
  setPending(new Map());
  flushFrames();
  assert.equal(pendingHosts(document).length, 0, 'completed or cancelled turn has no remaining pending Mochi');
  assert.equal(avatarState(activeA), 'idle');
  assert.equal(activeMochiCount(document), 0);

  // Switching sessions only allows the new current stream to animate.
  const flowB = chatFlow(document, scroll);
  const historicalB = assistantStep(document, flowB).step;
  const activeB = assistantStep(document, flowB, { streaming: true }).step;
  current = 'session-b';
  sessionB.setSnapshot({ running: true });
  for (const listener of listListeners) listener();
  flushFrames();
  assert.equal(avatarState(historicalB), 'idle');
  assert.equal(avatarState(activeB), 'typing');
  assert.equal(avatarState(activeA), 'idle', 'old-session assistant never regains a running state');
  assert.equal(activeMochiCount(document), 1);

  // Dispose cancels an already scheduled rAF and ignores late observer/session callbacks.
  sessionB.setSnapshot({ running: false });
  flushFrames();
  sessionB.setSnapshot({ running: true });
  assert.equal(frames.size, 1, 'running update schedules one frame before disposal');
  const staleSessionCallback = sessionB.listeners()[0];
  const staleMutationCallback = observers.at(-1).listener;
  const disposeAvatars = effects.get('jxl-brand: assistant avatars');
  disposeAvatars();
  staleSessionCallback();
  staleMutationCallback();
  flushFrames();
  assert.equal(frames.size, 0, 'disposed effect cancels its rAF');
  assert.equal(pendingHosts(document).length, 0, 'late callbacks cannot recreate a Mochi in an old view');
  assert.equal(avatarState(activeB), 'idle');

  for (const dispose of effects.values()) dispose?.();
});
