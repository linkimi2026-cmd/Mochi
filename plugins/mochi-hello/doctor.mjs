import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** The only authenticated host endpoint exposed by this plugin. */
export const DOCTOR_MODEL_CHECK_PATH = '/api/mochi-doctor/check-model'
/** The only provider route this diagnostic is allowed to inspect. */
export const DOCTOR_MODEL_SCOPE = 'mochi-mimo'
/** Kept stable so the eventual desktop bridge can validate this small payload. */
export const DOCTOR_MODEL_CHECK_VERSION = 'mochi-doctor-model-check/v1'
/** The host budget leaves margin for the enclosing five-second doctor check. */
export const DOCTOR_MODEL_CHECK_TIMEOUT_MS = 4_500

const STATUS = Object.freeze({
  OK: 'ok',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
  CANCELLED: 'cancelled',
  NOT_CHECKED: 'not-checked',
})

const CODE = Object.freeze({
  OK: 'OK',
  INVALID_REQUEST: 'INVALID_REQUEST',
  BUSY: 'CHECK_IN_PROGRESS',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NO_MODEL: 'NO_MODEL',
  MISSING_CREDENTIAL: 'MISSING_CREDENTIAL',
  INVALID_CREDENTIAL: 'INVALID_CREDENTIAL',
  AUTH_FAILED: 'AUTH_FAILED',
  ACCOUNT_UNAVAILABLE: 'ACCOUNT_UNAVAILABLE',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  UNKNOWN_FAILURE: 'UNKNOWN_FAILURE',
  NOT_CHECKED: 'NOT_CHECKED',
})

/** Build the only result shape returned by the fixed diagnostic. */
function result(modelService, credentials) {
  return {
    version: DOCTOR_MODEL_CHECK_VERSION,
    scope: DOCTOR_MODEL_SCOPE,
    'model-service': modelService,
    credentials,
  }
}

function outcome(status, code, durationMs) {
  return { status, code, durationMs: Math.max(0, Math.min(DOCTOR_MODEL_CHECK_TIMEOUT_MS, Math.round(durationMs))) }
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function elapsed(startedAt) {
  return performance.now() - startedAt
}

function fixedFailure(code, durationMs) {
  return result(
    outcome(STATUS.UNAVAILABLE, code, durationMs),
    outcome(STATUS.NOT_CHECKED, CODE.NOT_CHECKED, durationMs),
  )
}

function propertyString(value, name) {
  if (typeof value !== 'object' || value === null) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, name)
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined
}

function failureCode(value) {
  return propertyString(value, 'code') ?? CODE.UNKNOWN_FAILURE
}

function streamFailure(code, durationMs, timedOut) {
  if (timedOut) {
    return result(
      outcome(STATUS.UNAVAILABLE, CODE.TIMEOUT, durationMs),
      outcome(STATUS.NOT_CHECKED, CODE.NOT_CHECKED, durationMs),
    )
  }
  if (code === 'MISSING_CREDENTIAL') {
    return result(
      outcome(STATUS.UNAVAILABLE, CODE.MISSING_CREDENTIAL, durationMs),
      outcome(STATUS.UNAVAILABLE, CODE.MISSING_CREDENTIAL, durationMs),
    )
  }
  if (code === 'INVALID_CREDENTIAL') {
    return result(
      outcome(STATUS.ERROR, CODE.INVALID_CREDENTIAL, durationMs),
      outcome(STATUS.ERROR, CODE.INVALID_CREDENTIAL, durationMs),
    )
  }
  if (code === 'AUTH') {
    return result(
      outcome(STATUS.ERROR, CODE.AUTH_FAILED, durationMs),
      outcome(STATUS.ERROR, CODE.AUTH_FAILED, durationMs),
    )
  }
  if (code === 'QUOTA') {
    return result(
      outcome(STATUS.UNAVAILABLE, CODE.ACCOUNT_UNAVAILABLE, durationMs),
      outcome(STATUS.NOT_CHECKED, CODE.NOT_CHECKED, durationMs),
    )
  }
  if (code === 'ABORTED') {
    return result(
      outcome(STATUS.CANCELLED, CODE.CANCELLED, durationMs),
      outcome(STATUS.NOT_CHECKED, CODE.NOT_CHECKED, durationMs),
    )
  }
  if (code === 'NO_ADAPTER' || code === 'INVALID_CATALOG' || code === 'UNSUPPORTED_REASONING_EFFORT') {
    return fixedFailure(CODE.PROVIDER_UNAVAILABLE, durationMs)
  }
  if (code === 'TRANSPORT' || code === 'SERVER' || code === 'RATE_LIMIT' || code === 'EMPTY_RESPONSE') {
    return result(
      outcome(STATUS.UNAVAILABLE, CODE.UPSTREAM_UNAVAILABLE, durationMs),
      outcome(STATUS.NOT_CHECKED, CODE.NOT_CHECKED, durationMs),
    )
  }
  return result(
    outcome(STATUS.ERROR, CODE.UNKNOWN_FAILURE, durationMs),
    outcome(STATUS.NOT_CHECKED, CODE.NOT_CHECKED, durationMs),
  )
}

async function acceptsFixedPayload(request) {
  let raw
  try {
    raw = await request.text()
  } catch {
    return false
  }
  if (raw.trim() === '') return true
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return false
  }
  try {
    const payload = JSON.parse(raw)
    return typeof payload === 'object'
      && payload !== null
      && !Array.isArray(payload)
      && Object.keys(payload).length === 0
  } catch {
    return false
  }
}

async function checkModel(ctx, signal, timedOut, startedAt) {
  let models
  try {
    models = await ctx.llm.listModels(DOCTOR_MODEL_SCOPE)
  } catch (error) {
    return fixedFailure(CODE.PROVIDER_UNAVAILABLE, elapsed(startedAt))
  }
  const model = models[0]
  if (model === undefined) return fixedFailure(CODE.NO_MODEL, elapsed(startedAt))

  const message = createUserMessage({
    content: [{ type: 'text', text: 'Mochi model diagnostic.' }],
    source: { kind: 'plugin', plugin: 'mochi-hello' },
  })
  let finish
  try {
    for await (const chunk of ctx.llm.stream({
      provider: DOCTOR_MODEL_SCOPE,
      model: model.id,
      messages: [message],
      maxTokens: 1,
      tools: [],
      signal,
    })) {
      if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch {
    return streamFailure(CODE.UNKNOWN_FAILURE, elapsed(startedAt), timedOut())
  }

  const durationMs = elapsed(startedAt)
  if (timedOut()) return streamFailure(CODE.TIMEOUT, durationMs, true)
  if (finish === undefined) return streamFailure(CODE.UNKNOWN_FAILURE, durationMs, false)
  if (finish.kind === 'error') return streamFailure(failureCode(finish.failure), durationMs, false)
  if (finish.kind === 'aborted') return streamFailure('ABORTED', durationMs, false)
  return result(
    outcome(STATUS.OK, CODE.OK, durationMs),
    outcome(STATUS.OK, CODE.OK, durationMs),
  )
}

/**
 * Register the authenticated, fixed-scope model diagnostic on the existing
 * Connection gateway. The caller can only trigger the check; it cannot alter
 * its provider, model, prompt, tools, credentials, or endpoint.
 */
export function installModelDiagnostic(ctx) {
  let inFlight = false
  return ctx.connection.fetch.register({
    path: DOCTOR_MODEL_CHECK_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      if (request.method !== 'POST') return json(fixedFailure(CODE.INVALID_REQUEST, 0), 400)
      if (request.signal.aborted) return json(streamFailure('ABORTED', 0, false), 499)
      if (!(await acceptsFixedPayload(request))) return json(fixedFailure(CODE.INVALID_REQUEST, 0), 400)
      if (inFlight) return json(fixedFailure(CODE.BUSY, 0), 409)

      inFlight = true
      const startedAt = performance.now()
      const abort = new AbortController()
      let timedOut = false
      const onRequestAbort = () => { abort.abort() }
      request.signal.addEventListener('abort', onRequestAbort, { once: true })
      if (request.signal.aborted) abort.abort()
      const timeout = setTimeout(() => {
        timedOut = true
        abort.abort()
      }, DOCTOR_MODEL_CHECK_TIMEOUT_MS)
      try {
        return json(await checkModel(ctx, abort.signal, () => timedOut, startedAt))
      } finally {
        clearTimeout(timeout)
        request.signal.removeEventListener('abort', onRequestAbort)
        inFlight = false
      }
    },
  })
}
