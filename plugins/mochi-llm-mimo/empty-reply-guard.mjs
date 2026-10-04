/** MiMo-only, one-shot visible-answer recovery through public Harness hooks.
 * Predicate follows the MIT guard research in empty-reply-guard-notes.md.
 */
import { chunkHasVisibleText, createUserMessage, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'

export const name = 'mochi-mimo-empty-reply-guard'
export const inject = ['llm', 'agents']
export const EMPTY_REPLY = 'MOCHI_EMPTY_REPLY'
export const EMPTY_REPLY_FINAL = 'MOCHI_EMPTY_REPLY_FINAL'
const PROVIDER = 'mochi-mimo'
const codes = new Set([EMPTY_REPLY, EMPTY_REPLY_FINAL])
const message = '模型未返回正文，已尝试一次补答。请重试或更换模型。'
const isTool = chunk => chunk.type === 'tool-call-delta'
  || chunk.type === 'block-start' && chunk.blockType === 'tool-call'
  || chunk.type === 'block-end' && chunk.block.type === 'tool-call'

export async function* guardReply(stream, { signal, supplement = false } = {}) {
  let text = false, tool = false
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    text ||= chunkHasVisibleText(chunk)
    tool ||= isTool(chunk)
    if (chunk.type === 'finish') {
      if (supplement && chunk.reason.kind !== 'aborted' && (tool || !text || chunk.reason.kind === 'error')) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: EMPTY_REPLY_FINAL, message } } }
      } else if (!text && !tool && (chunk.reason.kind === 'stop'
        || chunk.reason.kind === 'error' && chunk.reason.failure.code === 'EMPTY_RESPONSE')) {
        yield { type: 'finish', reason: { kind: 'error', failure: {
          code: supplement ? EMPTY_REPLY_FINAL : EMPTY_REPLY,
          message: supplement ? message : '模型只返回了思考或空内容，正在尝试补答。',
        } } }
      } else yield chunk
      return
    }
    yield chunk
  }
}

function currentTurn(agent) {
  return agent.session.snapshotEvents().findLast(event => event.type === 'turn/start')?.data.turn
}

export function apply(ctx) {
  const budgets = new WeakMap(), supplements = new WeakSet()
  ctx.on('llm/stream', (options, next) => {
    const supplement = supplements.has(options)
    if (options.provider !== PROVIDER || !supplement && !isAgentLoopRequest(options)) return next()
    const agent = ctx.agents.get(options.sessionId)
    if (!agent) return next()
    const budget = budgets.get(agent)
    if (!supplement && budget?.pending && budget.turn === currentTurn(agent)) {
      budget.pending = false
      options.signal?.throwIfAborted()
      const request = {
        ...options, tools: [], toolHistory: undefined, toolUpdate: undefined,
        messages: [...options.messages, createUserMessage({
          content: [{ type: 'text', text: '上一轮模型输出没有正文。现在只需给用户一段非空的最终答复。使用已经记录的资料和工具结果；不要调用任何工具、重新执行操作或声称未做的操作成功。如无法回答，直接说明具体原因。' }],
          source: { kind: 'context', summary: 'Mochi 一次无工具补答' },
        })],
      }
      supplements.add(request)
      return ctx.llm.stream(request)
    }
    return guardReply(next(), { signal: options.signal, supplement })
  }, { global: true, prepend: true })
  // Veto downstream retry, including mode:always, for this guard's errors.
  // The loop retries only this failed model attempt; completed tool steps remain.
  ctx.on('agent/request-error', (payload, next) => {
    if (payload.provider !== PROVIDER || !codes.has(payload.failure.code)) return next()
    payload.signal.throwIfAborted()
    const previous = budgets.get(payload.agent)
    if (payload.failure.code === EMPTY_REPLY_FINAL || previous?.turn === payload.turn) return
    budgets.set(payload.agent, { turn: payload.turn, pending: true })
    return { kind: 'retry' }
  }, { global: true, prepend: true })
}
