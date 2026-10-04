import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

test("client apply installs scenes and styles without any work/chat input control or command dependency", () => {
  const factories = new Map();
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: entry => factories.set(entry.id, entry.factory) } } });
  const api = factories.get("mochi-modes-client")((name) => {
    if (name === "react") return {};
    if (name === "@deepseek-ai/dsh-client-ui-agent-preset") return { inject: ["remote.agentPresets"] };
    throw new Error(name);
  });
  const dependencies = [];
  const styles = [];
  const entries = [];
  api.apply({
    inject: deps => dependencies.push(Array.from(deps)),
    effect: (callback, label) => { callback(); styles.push(label); },
    slots: {
      inject(slot, callback) { for (const entry of callback()) entries.push({ slot, ...entry }); },
      register(options, component) { return { options, component }; },
    },
  });
  assert.deepEqual(dependencies, [["remote.agentPresets"]]);
  assert.deepEqual(styles, ["mochi-scenes: styles"]);
  assert.equal(api.inject.includes("remote.commands"), false);
  assert.equal(api.__test.SCENES.length, 5);
  assert.deepEqual(entries.map(entry => [entry.slot, entry.options.key, entry.options.priority]), [
    ["conversation.chat.commandview", "mochi-work", -20],
    ["conversation.chat.commandview", "mochi-chat", -20],
    ["conversation.chat.turnTail", undefined, undefined],
  ]);
  assert.equal(entries.at(-1).options.id, "mochi-empty-reply");
  for (const entry of entries.filter(entry => entry.slot === "conversation.chat.commandview")) {
    const legacyNode = Object.freeze({ name: entry.options.key, outcome: Object.freeze({ text: "legacy mode status" }) });
    assert.equal(entry.component({ node: legacyNode }), null);
    assert.equal(legacyNode.outcome.text, "legacy mode status", "rendering never edits old command facts");
  }
  assert.equal(entries.some(entry => entry.slot === "conversation.chat.node"), false, "no user-message node override");
});

test("removed toggle, mode projection and switch CSS do not remain in browser source", () => {
  assert.doesNotMatch(source, /ModeToggle|mochi-modes-toggle|conversation\.input\.left|mochiModes|remote\.commands|createModeSwitcher/);
  assert.match(source, /conversation\.hero\.agentPreset/);
  assert.match(source, /mochi-scene-card/);
});

test("actual rc2 SlotCore retires only mode command cards and keeps user messages plus other commands", async () => {
  const { SlotCore } = await import("../../../apps/desktop/runtime-modern/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js");
  const factories = new Map();
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: entry => factories.set(entry.id, entry.factory) } } });
  const api = factories.get("mochi-modes-client")(name => name === "react" ? {} : null);
  const core = new SlotCore();
  core.register({ name: "root", children: {
    "conversation.chat.commandview": { kind: "keyed", scope: "session" },
    "conversation.chat.node": { kind: "keyed", scope: "session" },
  } }, () => null);
  const oldRenderer = props => props.node.outcome.text;
  const permissionRenderer = props => props.node.outcome.text;
  const userRenderer = props => props.text;
  core.register({ name: "conversation.chat.commandview", key: "mochi-chat" }, oldRenderer);
  core.register({ name: "conversation.chat.commandview", key: "permission" }, permissionRenderer);
  core.register({ name: "conversation.chat.node", key: "user" }, userRenderer);
  const stops = [];
  api.__test.installRetiredCommandViews({ slots: {
    register: (options, component) => core.register(options, component),
    inject(_slot, callback) { for (const stop of callback()) stops.push(stop); },
  } });
  const winner = key => core.entriesOfSlot("conversation.chat.commandview").find(entry => entry.options.key === key);
  assert.equal(winner("mochi-chat").component({ node: { name: "mochi-chat", outcome: { text: "legacy mode text" } } }), null);
  assert.equal(winner("mochi-work").component({ node: { name: "mochi-work" } }), null);
  assert.equal(winner("permission").component, permissionRenderer);
  assert.equal(winner("permission").component({ node: { outcome: { text: "required approval stays visible" } } }), "required approval stays visible");
  const user = core.entriesOfSlot("conversation.chat.node").find(entry => entry.options.key === "user");
  assert.equal(user.component({ text: "用户提到 mochi-chat 的原文" }), "用户提到 mochi-chat 的原文");
  for (const stop of stops.reverse()) stop();
  assert.equal(winner("mochi-chat").component, oldRenderer);
  assert.equal(winner("mochi-work"), undefined);
});
