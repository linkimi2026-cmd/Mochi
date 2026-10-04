import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
// Local task rules over the adapter's public capability directory. No classifier call.
export const POLICY_EVENT = 'mochi/reasoning-policy';
export const CHOICE_EVENT = 'mochi/reasoning-choice';
// Same unique-temp/0600/rename convention as mochi-user-profile/store.mjs.
// Host mutations are synchronous; reread before each merge avoids stale instances.
export class ReasoningStore {
  constructor(path) { if (!isAbsolute(path)) throw Error('Reasoning metadata requires an absolute role home'); this.path = path; }
  read() {
    let raw; try { raw = readFileSync(this.path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return { version: 1, sessions: {} }; throw error; }
    if (raw.length > 12000000) throw Error('思考策略文件过大');
    const value = JSON.parse(raw);
    if (value.version !== 1 || !value.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions)) throw Error('思考策略文件无效');
    return value;
  }
  get(id) { const values = this.read().sessions; return Object.hasOwn(values, id) ? values[id] : undefined; }
  merge(id, changes) {
    const value = this.read();
    if (!changes || typeof changes !== 'object' || Object.keys(changes).some(key => !['autoAfterSeq', 'last'].includes(key))) throw Error('思考策略变更无效');
    if (changes.autoAfterSeq !== undefined && (!Number.isSafeInteger(changes.autoAfterSeq) || changes.autoAfterSeq < -1)) throw Error('思考策略序号无效');
    if (JSON.stringify(changes).length > 1024) throw Error('思考策略说明过长');
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) throw Error('会话标识无效');
    if (!Object.hasOwn(value.sessions, id) && Object.keys(value.sessions).length >= 10000) throw Error('思考策略记录已达上限');
    Object.defineProperty(value.sessions, id, { value: { ...(Object.hasOwn(value.sessions, id) ? value.sessions[id] : {}), ...changes }, enumerable: true, configurable: true, writable: true });
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try { writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path); }
    finally { rmSync(temporary, { force: true }); }
  }
}
const ORDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function taskReasoning(text) {
  const input = String(text ?? '').slice(0, 8000).trim();
  // Only unambiguous social replies and simple UI actions are fast paths.
  // Brevity is an output preference, never evidence that knowledge is easy.
  const social = /^(?:你好|您好|早上好|下午好|晚上好|早安|晚安|嗨|谢谢(?:你|您)?|多谢|辛苦了|好的|收到|在吗|hi|hello|thanks|thank you|ok|okay|good morning|good night)[！!。.？?\s]*$/iu;
  const mechanical = /^(?:请)?(?:帮我)?(?:(?:打开|关闭)(?:设置|信箱|摄像头|麦克风|录音|侧栏|侧边栏)|(?:开始|停止|暂停|继续)(?:录音|监听)|(?:新建|打开)(?:会话|对话)|(?:最小化|最大化)(?:窗口)?|清空输入(?:框)?)[！!。\s]*$/u;
  if (social.test(input) || mechanical.test(input)) {
    return { desired: 'low', reason: social.test(input) ? '明确寒暄或确认，优先快速回复' : '明确简单界面操作，优先快速执行' };
  }
  return { desired: 'high', reason: '知识问答、复杂任务或未明确归类的请求，优先深度思考；简短要求不降低思考档位' };
}

export function chooseReasoning(text, capability) {
  const proposed = taskReasoning(text);
  const efforts = capability?.efforts ?? [];
  const ids = efforts.map(x => x.id).filter(x => typeof x === 'string');
  if (!ids.length) return { reason: '模型未声明可选思考档位，使用提供方默认', method: 'provider-default' };
  let effort = ids.includes(proposed.desired) ? proposed.desired : undefined;
  if (!effort) {
    const rank = ORDER.indexOf(proposed.desired);
    const ranked = ids.filter(id => ORDER.includes(id));
    effort = ranked.filter(id => ORDER.indexOf(id) <= rank).sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0]
      ?? ranked.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0]
      ?? (ids.includes(capability.defaultEffort) ? capability.defaultEffort : ids[0]);
  }
  return { effort, method: 'local-rules', reason: proposed.reason + (effort === proposed.desired ? '' : `；模型支持范围内使用 ${effort}`) };
}

export function reasoningState(events, metadata) {
  const state = { mode: 'auto', current: undefined, last: undefined };
  for (const event of events ?? []) advanceReasoning(state, event);
  if (Number.isSafeInteger(metadata?.autoAfterSeq) && metadata.autoAfterSeq >= (state.manualSeq ?? -1)) state.mode = 'auto';
  state.last = metadata?.last ?? state.last;
  return state;
}
export function advanceReasoning(state, event) {
  if (event.type === POLICY_EVENT && ['auto', 'manual'].includes(event.data?.mode)) state.mode = event.data.mode;
  if (event.type === 'model/selection') { state.mode = 'manual'; state.manualSeq = event.seq ?? -1; state.current = event.data; state.pending = event.data; }
  if (event.type === 'request/header') {
    const config = event.data?.header?.config, selected = state.pending;
    if (!selected || (selected.provider === config?.provider && selected.model === config.model
      && (state.mode === 'auto' || selected.reasoningEffort === config.reasoningEffort))) {
      state.current = config; delete state.pending;
    }
  }
  if (event.type === CHOICE_EVENT) state.last = event.data;
  return state;
}

export function userText(messages) {
  const message = (messages ?? []).findLast(message => message?.role === 'user' && (!message.source || message.source.kind === 'user'));
  return (message?.content?.filter(x => x.type === 'text').map(x => x.text) ?? []).join('\n').slice(-8000);
}

export function installReasoning(ctx, store) {
  const states = new WeakMap(), tasks = new WeakMap(), pending = new WeakMap();
  const stateOf = session => {
    if (!states.has(session)) states.set(session, reasoningState(session.snapshotEvents(), store.get(session.id)));
    return states.get(session);
  };
  const disposers = [];
  disposers.push(ctx.on('session/event', (session, event) => {
    advanceReasoning(stateOf(session), event);
    if (event.type !== 'request/header') return;
    const choice = pending.get(session); if (!choice) return;
    pending.delete(session);
    const config = event.data?.header?.config;
    if (choice.provider !== config?.provider || choice.model !== config.model) return;
    const recorded = { ...choice, effort: config.reasoningEffort ?? null, requestSeq: event.seq };
    stateOf(session).last = recorded;
    try { store.merge(session.id, { last: recorded }); }
    catch { ctx.logger?.warn?.('Mochi 思考档位说明未保存'); }
  }, { global: true }));
  disposers.push(ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision.kind === 'enter') {
      const user = (decision.messages ?? []).findLast(message => message?.role === 'user' && (!message.source || message.source.kind === 'user'));
      if (user) tasks.set(payload.agent.session, user.content.some(part => part.type !== 'text') ? '' : userText([user]));
    }
    return decision;
  }, { global: true }));
  disposers.push(ctx.on('agent/request', async (payload, next) => {
    const config = await next(); payload.signal.throwIfAborted();
    const session = payload.agent.session, state = stateOf(session);
    if (state.mode !== 'auto') return config;
    const model = await (payload.agent.ctx?.llm ?? ctx.llm).resolveModelInfo(config.provider, config.model, payload.signal); payload.signal.throwIfAborted();
    if (state.mode !== 'auto') return config; // A manual choice can arrive during capability resolution.
    const text = tasks.get(session) ?? userText(session.snapshotEvents().filter(x => x.type === 'user/message').map(x => x.data));
    const choice = chooseReasoning(text, model.reasoning);
    pending.set(session, { mode: 'auto', method: choice.method, reason: choice.reason, provider: config.provider, model: config.model, turn: payload.turn, step: payload.step });
    const { reasoningEffort: _previous, ...rest } = config;
    return choice.effort === undefined ? rest : { ...rest, reasoningEffort: choice.effort };
  }, { global: true }));

  async function resolveSession(sessionId) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(sessionId)) throw Error('会话标识无效');
    const found = await ctx.sessionController.resolveAgent(sessionId);
    if (found.error) throw Error('当前会话不可用');
    return found.agent;
  }
  async function snapshot(agent) {
    const state = stateOf(agent.session);
    const projection = await ctx.sessionController.projections({ sessionId: agent.session.id }, new AbortController().signal);
    const current = projection?.values?.modelSelection?.next ?? (await ctx.sessionController.modelCatalog()).default;
    let model, lookupError;
    try { model = await (agent.ctx?.llm ?? ctx.llm).resolveModelInfo(current.provider, current.model); }
    catch (error) { lookupError = { code: typeof error.code === 'string' ? error.code : 'MODEL_UNAVAILABLE', message: '当前模型服务暂不可用，请在模型菜单核对服务配置' }; }
    return { mode: state.mode, current: { provider: current.provider, model: current.model, effort: current.reasoningEffort ?? model?.reasoning?.defaultEffort ?? null },
      efforts: model?.reasoning?.efforts ?? [], ...(lookupError ? { lookupError } : {}), last: state.last ?? null };
  }
  const update = async request => {
    const raw = await request.text(); if (raw.length > 1024) throw Error('请求过长');
    const input = JSON.parse(raw), agent = await resolveSession(input?.sessionId);
    if (input.mode === 'auto') {
      const autoAfterSeq = agent.session.snapshotEvents().at(-1)?.seq ?? -1;
      store.merge(agent.session.id, { autoAfterSeq }); stateOf(agent.session).mode = 'auto';
    }
    else if (input.mode === 'manual') {
      const current = (await snapshot(agent)).current;
      const capability = await (agent.ctx?.llm ?? ctx.llm).resolveModelInfo(current.provider, current.model);
      if (!capability.reasoning?.efforts.some(x => x.id === input.effort)) throw Error('模型不支持这个思考档位');
      await ctx.sessionController.selectModel({ sessionId: input.sessionId, provider: current.provider, model: current.model, reasoningEffort: input.effort });
    } else throw Error('思考策略无效');
    return snapshot(agent);
  };
  // Connection owns one exact route per path; register its two verbs together.
  disposers.push(ctx.connection.fetch.register({ path: '/api/mochi-reasoning', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
    try {
      const value = request.method === 'GET' ? await snapshot(await resolveSession(new URL(request.url).searchParams.get('sessionId'))) : await update(request);
      return Response.json(value, { headers: { 'cache-control': 'no-store' } });
    } catch (error) { return Response.json({ error: String(error.message ?? error) }, { status: 400, headers: { 'cache-control': 'no-store' } }); }
  } }));
  return () => disposers.reverse().forEach(dispose => dispose?.());
}
