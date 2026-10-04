import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { apply, inject, name } from '../index.mjs';
import {
  CHAT_COMMAND, WORK_COMMAND, REQUEST_TOOL, MODE_CHAT, MODE_WORK,
  createProjectionDefinition, foldModeEvent, modeProjection, orderConversationSchemas,
} from '../modes.mjs';

function host(visible = ['mochi_ppt_create', 'file_read', 'bash', 'mochi_lan_status']) {
  const handlers = new Map();
  const sections = [];
  const projections = [];
  const registered = [];
  const permissions = { sandbox: 'workspace-write', approval: 'on-request' };
  const externalGuard = (tool) => tool === 'dangerous_external_send' ? 'ask' : 'allow';
  const tools = {
    schemas: () => visible.map(tool => ({ name: tool })),
    register: tool => { registered.push(tool); },
    restrict() { throw new Error('mode layer must never restrict capability'); },
  };
  const ctx = {
    tools, logger: { warn() {} }, permissions, externalGuard,
    get(service) {
      if (service === 'approval' || service === 'permissions') throw new Error('mode plugin must not access approval policy');
      if (service === 'sessionProjections') return { stateOf: () => ({ mode: MODE_CHAT, pending: null }) };
    },
    inject(deps, callback) {
      assert.equal(deps.includes('commands'), false, 'mode-switch commands no longer register');
      callback({
        systemPrompt: { section: section => sections.push(section), getSectionOrder: () => 100 },
        sessionProjections: { register: definition => projections.push(definition) },
      });
    },
    on(event, callback) { handlers.set(event, callback); return () => handlers.delete(event); },
  };
  return { ctx, handlers, sections, projections, registered, tools, permissions, externalGuard };
}

test('runtime no longer registers switch tool, commands, restrictions or agent-mode lifecycle', () => {
  const h = host();
  apply(h.ctx);
  assert.equal(name, 'mochi-modes');
  assert.deepEqual(inject, ['tools']);
  assert.deepEqual(h.registered, []);
  assert.deepEqual([...h.handlers.keys()], ['system-prompt/assemble']);
  assert.equal(h.projections.length, 1);
  assert.equal(h.projections[0].stateVersion, 2);
});

test('cached historical chat projection cannot hide real tools in new, resumed or forked agents', async () => {
  for (const lifecycle of ['new', 'resumed', 'forked']) {
    const h = host();
    const agent = { session: { id: lifecycle, header: { agentPreset: 'lesson-planning' } }, ctx: { tools: h.tools } };
    apply(h.ctx);
    assert.equal(h.ctx.get('sessionProjections').stateOf(agent.session).mode, MODE_CHAT);
    const original = h.tools.schemas(agent);
    const assembled = await h.handlers.get('system-prompt/assemble')({}, { agent }, async () => ({ tools: original }));
    assert.deepEqual(new Set(assembled.tools.map(row => row.name)), new Set(original.map(row => row.name)));
    assert.ok(assembled.tools.some(row => row.name === 'mochi_ppt_create'));
    assert.ok(assembled.tools.some(row => row.name === 'file_read'));
    assert.ok(assembled.tools.some(row => row.name === 'bash'));
  }
});

test('selected role remains the capability boundary; classroom never gains absent teacher tools', async () => {
  const h = host(['mochi_lan_status', 'mochi_lan_send_student_request']);
  apply(h.ctx);
  const original = h.tools.schemas({});
  const result = await h.handlers.get('system-prompt/assemble')({}, {}, async () => ({ tools: original }));
  assert.deepEqual(result.tools.map(row => row.name), original.map(row => row.name));
  assert.equal(result.tools.some(row => ['mochi_ppt_create', 'bash'].includes(row.name)), false);
});

test('removing mode gate leaves existing permission object and dangerous-operation approval guard unchanged', () => {
  const h = host();
  const permissions = h.ctx.permissions;
  const externalGuard = h.ctx.externalGuard;
  apply(h.ctx);
  assert.equal(h.ctx.permissions, permissions);
  assert.deepEqual(permissions, { sandbox: 'workspace-write', approval: 'on-request' });
  assert.equal(h.ctx.externalGuard, externalGuard);
  assert.equal(h.ctx.externalGuard('dangerous_external_send'), 'ask');
  const guidance = h.sections[0].text;
  assert.match(guidance, /已取消工作／对话模式区分/);
  assert.match(guidance, /原有权限、审批和安全边界/);
  assert.match(guidance, /不代表用户批准了具体操作/);
  assert.doesNotMatch(guidance, /调用 mochi_request_work_mode|用户已授权进入工作模式/);
});

test('legacy v2 checkpoint schema and original command/approval replay stay compatible without mutating events', () => {
  const definition = createProjectionDefinition();
  const checkpoint = { mode: MODE_CHAT, pending: null };
  assert.equal(definition.stateSchema.parse(checkpoint), checkpoint);
  const events = [
    { type: 'command/run', data: { name: WORK_COMMAND, commandId: 'work' } },
    { type: 'command/done', data: { commandId: 'work', kind: 'success' } },
    { type: 'command/run', data: { name: CHAT_COMMAND, commandId: 'chat' } },
    { type: 'command/done', data: { commandId: 'chat', kind: 'success' } },
    { type: 'approval/asked', data: { id: 'request', toolName: REQUEST_TOOL } },
    { type: 'approval/decided', data: { id: 'request', outcome: 'rejected' } },
  ];
  const bytes = JSON.stringify(events);
  for (const row of events) { Object.freeze(row.data); Object.freeze(row); }
  const folded = events.reduce(definition.apply, checkpoint);
  assert.deepEqual(folded, checkpoint);
  assert.equal(JSON.stringify(events), bytes);
  assert.deepEqual(definition.wire.view(folded), { mode: MODE_CHAT, pending: false });
  assert.deepEqual(definition.init({ agentPreset: 'standard' }), { mode: MODE_WORK, pending: null });
  assert.deepEqual(definition.init({ agentPreset: 'lesson-planning' }), checkpoint);
});

test('legacy approval completion and fork prefix replay preserve historical facts exactly', () => {
  const events = [
    { type: 'approval/asked', data: { id: 'old-approval', toolName: REQUEST_TOOL } },
    { type: 'approval/decided', data: { id: 'old-approval', outcome: 'allowed-once' } },
  ];
  const start = modeProjection.init({ agentPreset: 'lesson-planning' });
  const prefix = events.slice(0, 1).reduce(foldModeEvent, start);
  assert.deepEqual(prefix, { mode: MODE_CHAT, pending: { id: 'approval:old-approval', wanted: MODE_WORK } });
  assert.deepEqual(events.slice(1).reduce(foldModeEvent, prefix), { mode: MODE_WORK, pending: null });
  assert.deepEqual(events.reduce(foldModeEvent, start), { mode: MODE_WORK, pending: null });
  assert.throws(() => modeProjection.stateSchema.parse({ mode: 'unknown', pending: null }), TypeError);
});

test('stable schema ordering never creates, deletes or alters tool schemas', () => {
  const shell = { name: 'bash', description: 'external guard applies', parameters: { type: 'object' } };
  const request = { name: 'mochi_lan_status' };
  const document = { name: 'mochi_ppt_create' };
  const original = [shell, request, document];
  const result = orderConversationSchemas(original);
  assert.deepEqual(result, [request, shell, document]);
  assert.deepEqual(original, [shell, request, document]);
  assert.equal(result[0], request);
  assert.equal(result[1], shell);
  assert.equal(result[2], document);
  assert.equal(orderConversationSchemas(undefined), undefined);
});

test('schema ordering failure preserves original assembly and unrelated policy metadata', async () => {
  const h = host();
  apply(h.ctx);
  const broken = { get name() { throw new Error('broken schema'); } };
  const original = { tools: [broken], approvalPolicy: 'on-request', additionalPolicy: { externalWrites: 'ask' } };
  assert.equal(await h.handlers.get('system-prompt/assemble')({}, {}, async () => original), original);
});

test('backend source has no mode approval or restriction implementation', () => {
  const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /defineTool|approval\.request|tools\.restrict|commands\.register|agent\/created/);
});
