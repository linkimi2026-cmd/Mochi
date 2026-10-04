/** Modern MiMo bridge over the public Harness/pi-ai adapter contracts. */
import z from '@deepseek-ai/schemastery'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError, RetryPolicySchema, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { createProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import * as protocol from '@earendil-works/pi-ai/api/openai-completions'

const PROVIDER = 'mochi-mimo'
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const LEGACY_LEVELS = ['off', 'low', 'medium', 'high', 'max']
const positive = () => z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
const modelSchema = z.object({
  id: z.string().required(), name: z.string(), description: z.string(),
  contextWindow: positive(), maxTokens: positive(),
  inputModalities: z.array(z.union(['text', 'image'])).min(1).default(['text']),
  reasoningEfforts: z.array(z.union(LEGACY_LEVELS)),
  imagePixelBudget: z.union([positive(), 'low']), imageMaxBytes: positive(),
})
// Preserve the native Models page's flat namespace and credential reference.
// New DeepSeekConfig describes Messages and no longer has these fields.
export const Config = z.object({
  apiKeyEnv: z.string().role('credential-ref').default('MIMO_API_KEY'),
  baseURL: z.string().required(),
  models: z.array(modelSchema).default([]),
  thinking: z.union(['enabled', 'disabled']), reasoningEffort: z.union(LEGACY_LEVELS),
  maxTokens: positive().default(256000), defaultContextWindow: positive().default(1000000),
  streamIdleTimeoutMs: positive().max(2147483647).default(300000),
  maxInlineRequestImageBytes: positive().default(20971520),
  retryPolicy: RetryPolicySchema,
})

export function resolveOptions(raw) {
  const config = Config(structuredClone(raw))
  const endpoint = new URL(config.baseURL)
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('MiMo baseURL must be HTTP(S) without credentials, query or fragment')
  }
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(config.apiKeyEnv)) throw new Error('Invalid MiMo credential reference')
  const seen = new Set()
  for (const model of config.models) {
    if (!model.id || seen.has(model.id)) throw new Error('MiMo model ids must be nonempty and unique')
    seen.add(model.id)
    if (new Set(model.inputModalities).size !== model.inputModalities.length) throw new Error('Duplicate MiMo modality')
    if (model.reasoningEfforts && new Set(model.reasoningEfforts).size !== model.reasoningEfforts.length) throw new Error('Duplicate MiMo reasoning level')
    if (!model.inputModalities.includes('image') && (model.imageMaxBytes !== undefined || model.imagePixelBudget !== undefined)) throw new Error('Image limits require an image-capable MiMo model')
    if (config.thinking === 'disabled' && model.reasoningEfforts?.length && !model.reasoningEfforts.includes('off')) throw new Error('MiMo model cannot disable thinking')
  }
  if (config.thinking === 'disabled' && config.reasoningEffort && config.reasoningEffort !== 'off') throw new Error('Disabled MiMo thinking requires off')
  return config
}

function profileFor(config) {
  const models = config.models.map(model => {
    const declared = model.reasoningEfforts?.length ? model.reasoningEfforts : LEGACY_LEVELS
    return {
      id: model.id, name: model.name ?? model.id, provider: PROVIDER,
      api: 'openai-completions', baseUrl: config.baseURL,
      reasoning: true,
      thinkingLevelMap: Object.fromEntries(LEVELS.map(level => [level, declared.includes(level) ? level : null])),
      input: [...model.inputModalities],
      contextWindow: model.contextWindow ?? config.defaultContextWindow,
      maxTokens: model.maxTokens ?? config.maxTokens,
      // Custom routes have no verified billing rates, as in upstream profiles.
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsDeveloperRole: false, supportsStore: false, supportsStrictMode: false,
        maxTokensField: 'max_tokens', thinkingFormat: 'deepseek', supportsReasoningEffort: true,
      },
    }
  })
  const piProvider = createProvider({
    id: PROVIDER, name: 'MiMo', baseUrl: config.baseURL, models, api: protocol,
    // Every call supplies a key resolved by the existing Harness credential seam.
    auth: { apiKey: { name: 'MiMo API key', resolve: async ({ credential }) => credential?.key ? { auth: { apiKey: credential.key } } : undefined } },
  })
  return new Map([[PROVIDER, {
    provider: PROVIDER, displayName: 'MiMo', apiKeyEnv: config.apiKeyEnv,
    api: 'openai-completions', baseURL: config.baseURL, piProvider,
    reasoning: config.thinking === 'disabled' ? 'off' : config.reasoningEffort ?? 'high',
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    maxRequestImageBytes: config.maxInlineRequestImageBytes,
    requestImagePixelBudget: 640000, requestImageMaxBytes: 1048576,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'mochi-mimo.retryPolicy'),
    modelErrors: new Map(),
    configuredMaxTokens: new Map(models.map(model => [model.id, model.maxTokens])),
  }]])
}

function terminalError(failure) {
  // pi-ai's public error events retain the OpenAI SDK's status and JSON details
  // in errorMessage; convert the Harness finish style to the legacy throw style.
  const status = Number(/^\s*(\d{3})\b/u.exec(failure.message)?.[1]) || undefined
  return new LlmError(failure.message, failure.code, {
    cause: new Error(failure.message), ...(status ? { status } : {}),
  })
}

export function createMimoAdapter(dependencies, classifyForbidden) {
  let previous, profiles
  const imagePolicies = new WeakMap()
  const currentProfiles = () => {
    const config = dependencies.options()
    const fingerprint = JSON.stringify(config)
    if (fingerprint !== previous) {
      profiles = profileFor(config)
      imagePolicies.set(profiles, new Map(config.models.filter(model => model.inputModalities.includes('image')).map(model => [model.id, {
        requestImagePixelBudget: model.imagePixelBudget === 'low' ? 262144 : model.imagePixelBudget ?? 640000,
        requestImageMaxBytes: model.imageMaxBytes ?? 1048576,
      }])))
      previous = fingerprint
    }
    return profiles
  }
  class MimoAdapter extends PiAiAdapter {
    async *checked(stream) {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'finish' && chunk.reason.kind === 'error') throw terminalError(chunk.reason.failure)
          yield chunk
        }
      } catch (error) {
        if (error?.code === 'AUTH' && error?.failure?.status === 403) throw classifyForbidden(error)
        throw error
      }
    }
    async *stream(request) {
      const call = await this.prepareCall(request.provider, request.model, request.signal)
      yield* call.stream(request)
    }
    async prepareCall(...args) {
      const snapshot = currentProfiles()
      const policy = imagePolicies.get(snapshot)?.get(args[1])
      // The old flat catalog owns image budgets per model. Upstream pi-ai owns
      // them per route; freeze that one call's public profile, never mutate it.
      const scoped = policy ? new Map([[PROVIDER, { ...snapshot.get(PROVIDER), ...policy }]]) : snapshot
      const owner = new PiAiAdapter({ ...adapterOptions, profiles: () => scoped })
      const call = await owner.prepareCall(...args)
      const reasoning = call.model.reasoning
      const defaultEffort = reasoning?.defaultEffort ?? reasoning?.efforts.at(-1)?.id
      const model = defaultEffort === undefined ? call.model : {
        ...call.model, reasoning: { ...reasoning, defaultEffort },
      }
      return { model, stream: request => this.checked(call.stream({
        ...request, reasoningEffort: request.reasoningEffort ?? defaultEffort,
      })) }
    }
  }
  currentProfiles()
  const adapterOptions = {
    profiles: currentProfiles,
    resolveApiKey: (_provider, profile) => dependencies.resolveApiKey(profile),
    // This route has reference-only auth; no OAuth/ambient provider discovery.
    auth: { credentials: new InMemoryCredentialStore(), authContext: { env: async () => undefined, fileExists: async () => false } },
    resolveAttachments: dependencies.resolveAttachments,
    resolveImageAccess: dependencies.resolveImageAccess,
  }
  return new MimoAdapter(adapterOptions)
}
