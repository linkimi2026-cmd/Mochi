import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const officialSource = readFileSync(new URL("../../../apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js", import.meta.url), "utf8");
const snapshotStore = value => ({ getSnapshot: () => value, subscribe: () => () => {}, set(next) { value = next; } });
const react = {
  memo: component => component, forwardRef: component => component,
  createElement: (type, props, ...children) => ({ type, props, children }),
  useSyncExternalStore: (_subscribe, read) => read(),
};

function load() {
  const factories = new Map();
  const context = vm.createContext({ console, window: { __ModuleLoader__: { load: entry => factories.set(entry.id, entry.factory) } } });
  vm.runInContext(source, context);
  vm.runInContext(officialSource, context);
  const official = factories.get("@deepseek-ai/dsh-client-ui-chat")(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "react-dom") return {};
    if (name === "@deepseek-ai/dsh-client-ui-primitives") return new Proxy({}, { get: (_, key) => key });
    if (name === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: snapshotStore, defineStore: () => ({}) };
    throw new Error(`Unexpected official dependency: ${name}`);
  });
  const api = factories.get("mochi-modes-client")(name => name === "react" ? react : null);
  const definitions = new Map();
  const renderers = new Map();
  const mountedRenderers = new Error("official node renderers captured");
  // The unchanged production apply registers its real Definitions and renderers.
  // Stop after the last renderer so unrelated settings/workspace services are not mocked.
  const ctx = {
    effect: callback => { callback(); return () => {}; }, inject() {},
    uiConversation: {
      events: { register: definition => definitions.set(definition.kind, definition), registerFallback() {} },
      views: { register() {} }, groups: { register() {} },
    },
    uiSession: { provide() {} }, locale: { register() { return () => {}; }, bind: () => key => key },
    configForms: { get: () => snapshotStore({ value: {} }) },
    slots: {
      inject(_slot, callback) { callback(); },
      register(options, component) {
        renderers.set(options.key, { options, component });
        if (options.key === "unknown") throw mountedRenderers;
        return () => {};
      },
    },
  };
  assert.throws(() => official.apply(ctx), error => error === mountedRenderers);
  return { api, definitions, renderers };
}

function locationData(values) {
  return { get: key => values.get(key), source: key => snapshotStore(values.get(key)) };
}

function replay(definitions, content = [{ type: "reasoning", text: "private reasoning fixture" }], options = {}) {
  const values = new Map();
  const stepValues = new Map();
  const turn = { turn: 2, status: "closed", data: locationData(values), steps: [] };
  const step = { turn: 2, step: 1, status: "closed", data: locationData(stepValues) };
  turn.steps.push(step);
  const event = (type, seq, data, surfaceOp) => Object.freeze({ type, seq, time: seq * 100, data: Object.freeze(data), ...(surfaceOp ? { surfaceOp } : {}) });
  const events = [
    turn.start = event("turn/start", 39, { turn: 2 }),
    step.start = event("step/start", 40, { turn: 2, step: 1 }),
    event("assistant/message", 42, { turn: 2, step: 1, stream: [], message: { id: "empty-reply", content, source: { provider: "fixture", model: "fixture" } }, ...(options.interrupted ? { interrupted: true } : {}) }, "append"),
    ...(options.tool ? [event("tool/call", 43, { turn: 2, step: 1, name: options.tool, callId: "call" })] : []),
    step.end = event("step/end", 44, { turn: 2, step: 1, reason: { kind: "stop" } }),
    turn.end = event("turn/end", 45, { turn: 2, reason: { kind: options.reason || "completed" } }),
  ];
  function fold(kind, scope, destination) {
    const definition = definitions.get(kind);
    const context = { key: kind, kind, id: "2", matches: [], current: new Map() };
    for (const event of events) {
      const match = definition.match(event);
      if (!match) continue;
      const located = { ...match, event, location: event.type.startsWith("turn/") ? { kind: "turn", turn } : { kind: "step", turn, step } };
      context.matches.push(located);
      if (context.state === undefined) {
        context.start = located;
        context.state = definition.start(context, located, { previous: () => undefined });
      } else context.state = definition.update(context, located);
    }
    const published = definition.buildLocationData(context, scope, null);
    destination.set(published.key, published.value);
    return definition.buildViewNode(context);
  }
  const assistant = fold("assistant-step", "step", stepValues);
  fold("turn-process", "turn", values);
  const tail = fold("turn-tail", "turn", values);
  return { turn, values, stepValues, assistant, tail, events };
}

test("unchanged rc2 replay and TurnTailNodeView render the empty-reply contribution without changing assistant blocks", () => {
  const { api, definitions, renderers } = load();
  const history = replay(definitions);
  const original = JSON.stringify(history.events);
  const contribution = api.__test.EmptyReplyNotice({ turn: history.turn });
  assert.equal(contribution.children[0], "本轮未返回正文，请重试。");
  assert.equal(contribution.props.role, "note");
  assert.equal(JSON.stringify(contribution).includes("private reasoning"), false);
  const slotCalls = [];
  const tree = renderers.get("turn-tail").component({
    node: history.tail, usePerformanceUsage: selector => selector("simple"),
    useChat: selector => selector({ nodes: new Map(), order: [], locations: { getTurn: () => [] }, timeline: { turnOrder: [2] } }),
    renderSlot(name, owner) { slotCalls.push(name); return api.__test.EmptyReplyNotice(owner); },
  });
  assert.equal(tree.props["data-turn-tail"], 2);
  assert.equal(tree.props.children.children[0], "本轮未返回正文，请重试。");
  assert.deepEqual(slotCalls, ["conversation.chat.turnTail"]);
  assert.equal(history.assistant.data.blocks[0].kind, "reasoning", "official reasoning node remains intact");
  assert.equal(JSON.stringify(history.events), original, "no event or assistant body is synthesized");
  for (const content of [[], [{ type: "text", text: " \n\t" }]]) {
    const empty = replay(definitions, content);
    assert.equal(api.__test.EmptyReplyNotice({ turn: empty.turn }).children[0], "本轮未返回正文，请重试。");
  }
});

test("official text, tools, subagents, stopped or incomplete turns never receive an empty-reply notice", () => {
  const { api, definitions } = load();
  for (const [content, options] of [
    [[{ type: "text", text: "actual answer" }], {}],
    [[{ type: "reasoning", text: "reasoning" }], { tool: "read_file" }],
    [[{ type: "reasoning", text: "reasoning" }], { tool: "subagent" }],
    [[{ type: "reasoning", text: "reasoning" }], { interrupted: true }],
    ...["error", "aborted", "interrupted", "max-tokens", "forked", "blocked"].map(reason => [[{ type: "reasoning", text: "reasoning" }], { reason }]),
  ]) {
    const { turn } = replay(definitions, content, options);
    assert.equal(api.__test.EmptyReplyNotice({ turn }), null, JSON.stringify(options));
  }
  const { turn, values, stepValues } = replay(definitions);
  const assistant = stepValues.get("assistant-step");
  for (const blocks of [[{ kind: "image", attachment: {} }], [{ kind: "other", block: {} }], [{ kind: "tool-call", name: "tool" }]]) {
    stepValues.set("assistant-step", { ...assistant, blocks });
    assert.equal(api.__test.EmptyReplyNotice({ turn }), null);
  }
  stepValues.set("assistant-step", assistant);
  assert.equal(api.__test.EmptyReplyNotice({ turn: { ...turn, status: "open" } }), null);
  assert.equal(api.__test.EmptyReplyNotice({ turn: { ...turn, start: undefined } }), null);
  stepValues.delete("assistant-step");
  assert.equal(api.__test.EmptyReplyNotice({ turn }), null);
  stepValues.set("assistant-step", assistant);
  values.delete("turn-process");
  assert.equal(api.__test.EmptyReplyNotice({ turn }), null);
});

test("actual rc2 list slot keeps existing tail contributions and cleans up the added notice", async () => {
  const { SlotCore } = await import("../../../apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js");
  const { api, renderers } = load();
  const core = new SlotCore();
  core.register({ name: "root", children: renderers.get("turn-tail").options.children }, () => null);
  const deliverables = () => "produced files";
  core.register({ name: "conversation.chat.turnTail", id: "deliverables", order: 10 }, deliverables);
  const stops = [];
  api.__test.installEmptyReplyNotice({ slots: {
    register: (options, component) => core.register(options, component),
    inject(_slot, callback) { for (const stop of callback()) stops.push(stop); },
  } });
  assert.equal(core.entriesOfSlot("conversation.chat.turnTail").length, 2);
  assert.equal(core.entriesOfSlot("conversation.chat.turnTail")[0].component, deliverables);
  for (const stop of stops) stop();
  assert.equal(core.entriesOfSlot("conversation.chat.turnTail").length, 1);
});
