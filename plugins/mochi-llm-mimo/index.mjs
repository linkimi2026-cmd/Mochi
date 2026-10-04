/** MiMo route: alpha Chat Completions adapter; modern public pi-ai adapter. */

import { Config as DeepSeekConfig, DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import llmPackage from '@deepseek-ai/dsh-llm/package.json' with { type: 'json' }
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { LlmError, assertUsableApiKey, isQuotaExceededError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'

const modern = llmPackage.version === '0.2.0-rc.2'
if (!modern && llmPackage.version !== '0.1.3-alpha.1') throw new Error(`Unsupported MiMo runtime: ${llmPackage.version}`)
const modernAdapter = modern ? await import('./openai-adapter.mjs') : undefined

export const name = 'mochi-llm-mimo'
export const inject = ['llm', 'settings']

/** 本插件拥有的 provider route。 */
export const PROVIDER = 'mochi-mimo'
// Older hand-declared routes may have stored this derived ref. The Mochi
// Models card now saves config.apiKeyEnv (MIMO_API_KEY by default); keep the
// derived ref only as a compatibility fallback.
const DERIVED_ROUTE_CREDENTIAL_REF = 'MOCHI_MIMO_API_KEY'

const PERMISSION_ERROR_CODES = new Set([
  'access_denied',
  'authorization_error',
  'insufficient_scope',
  'insufficient_permission',
  'insufficient_permissions',
  'model_access_denied',
  'model_not_allowed',
  'permission_denied',
  'permission_error',
])

function providerErrorFields(error) {
  const raw = error?.cause?.message
  if (typeof raw !== 'string') return { code: '', type: '', detail: '', message: '' }
  const fallback = { code: '', type: '', detail: raw.slice(0, 4096), message: '' }

  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf('{')))
    const providerError = parsed?.error ?? parsed
    if (providerError === null || typeof providerError !== 'object' || Array.isArray(providerError)) {
      return fallback
    }
    const code = typeof providerError.code === 'string' ? providerError.code : ''
    const type = typeof providerError.type === 'string' ? providerError.type : ''
    const message = typeof providerError.message === 'string' ? providerError.message : ''
    return { code, type, message, detail: [code, type, message].join(' ') }
  } catch {
    return fallback
  }
}

function isMimoQuotaError(detail) {
  return isQuotaExceededError(detail)
    || /(?:余额|额度|配额).{0,8}(?:不足|不够|耗尽|用尽|用完|已超|达到上限|已达上限)|(?:不足|不够|耗尽|用尽|用完).{0,8}(?:余额|额度|配额)/u.test(detail)
}

function isMimoPermissionError({ code, type, message }) {
  const normalizedCodes = [code, type].map(value => value.toLowerCase().replace(/[\s-]+/gu, '_'))
  if (normalizedCodes.some(value => PERMISSION_ERROR_CODES.has(value))) return true
  return /\b(?:permission denied|insufficient permissions?|no permission|access denied|not authorized to (?:access|use)|not permitted to (?:access|use)|model\s+(?:access\s+)?(?:denied|not allowed))\b|\bdo not have permission to (?:access|use)\b|(?:权限|访问|使用).{0,12}(?:不足|拒绝|未授权|无权|不允许)|(?:无权限|没有权限|权限不足|未获授权|禁止访问)/iu.test(message)
}

function reclassifyMimoForbidden(error) {
  const { code: providerCode, type, message: providerMessage, detail } = providerErrorFields(error)
  const failure = error.failure
  const quota = isMimoQuotaError(detail)
  const permission = isMimoPermissionError({ code: providerCode, type, message: detail })

  let code
  let message
  if (quota) {
    code = 'QUOTA'
    message = `MiMo 账户余额或调用额度不足${providerMessage ? `：${providerMessage}` : ''}`
  } else if (permission) {
    code = 'PERMISSION_DENIED'
    message = `MiMo 服务权限不足${providerMessage ? `：${providerMessage}` : ''}`
  } else {
    code = 'PROVIDER_FORBIDDEN'
    const detailMessage = providerMessage && !/^forbidden$/iu.test(providerMessage) ? `：${providerMessage}` : ''
    message = `MiMo 服务返回 HTTP 403，原因待确认${detailMessage}`
  }

  return new LlmError(message, code, {
    cause: error,
    status: failure.status,
    ...(failure.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: failure.providerRetryAfterMs }),
    ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
  })
}

export function apply(ctx, config) {
  // 部署期静态 config：load 时校验一次，fail loud。
  let current = () => config
  const options = () => modern ? modernAdapter.resolveOptions(current()) : resolveAdapterOptions(current())
  options()

  const resolveApiKey = async (connection) => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== void 0) {
      const hit = await credentials.resolve(ref)
      if (hit !== void 0) return assertUsableApiKey(hit.value, name, ref)
      if (ref !== DERIVED_ROUTE_CREDENTIAL_REF) {
        const legacyHit = await credentials.resolve(DERIVED_ROUTE_CREDENTIAL_REF)
        if (legacyHit !== void 0) {
          return assertUsableApiKey(legacyHit.value, name, DERIVED_ROUTE_CREDENTIAL_REF)
        }
      }
    }
    // 与 llm-deepseek 相同的降级顺序：凭据仓库 → 进程环境。
    const ambient = process.env[ref]
    if (ambient !== void 0 && ambient.length > 0) return assertUsableApiKey(ambient, name, ref)
    if (ref !== DERIVED_ROUTE_CREDENTIAL_REF) {
      const legacyAmbient = process.env[DERIVED_ROUTE_CREDENTIAL_REF]
      if (legacyAmbient !== void 0 && legacyAmbient.length > 0) {
        return assertUsableApiKey(legacyAmbient, name, DERIVED_ROUTE_CREDENTIAL_REF)
      }
    }
    throw new LlmError(
      `mochi-llm-mimo: no API key for provider route "${PROVIDER}"; configure MiMo in Settings → Models (the classroom profile stores it separately from the teacher profile) or provide ${ref}`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId
  const resolveUserId = () => userId ??= getOrCreateAnonymousUserId()

  // 只改展示名：UI 的 provider 标签显示 MiMo 而不是 DeepSeek。
  class MimoAdapter extends DeepSeekAdapter {
    providerInfo(provider) {
      return { id: provider, name: 'MiMo' }
    }

    // The installed upstream adapter maps both 401 and 403 to AUTH. Correct
    // only MiMo's 403s here, keeping this route-specific gateway policy local.
    async *stream(request) {
      try {
        yield* super.stream(request)
      } catch (error) {
        if (error?.code === 'AUTH' && error?.failure?.status === 403) {
          throw reclassifyMimoForbidden(error)
        }
        throw error
      }
    }
  }

  const dependencies = {
    options,
    resolveApiKey,
    resolveUserId,
    // 与 llm-deepseek 相同的扩展 seam：产物里的 adapter 会无条件调用
    // prepareExtensions，缺省会在请求前抛 REQUEST_EXTENSION。
    prepareExtensions: (request) => ctx.get('deepseekLlmApiExtensions')?.prepare(request)
      ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
    // ── 视觉输入（2026-09-12 接线）────────────────────────────────────────
    // 早先这里断言「图片链路是 DeepSeek Files API 专属，mimo 不适用」，是错的：
    // serialize.ts 的 imageParts() 有两条分支——kind:'file' 走 DS Files API，
    // 否则内联成 OpenAI 标准的 `image_url:{url:'data:<mime>;base64,…'}`，
    // 与 Files API 无关。mimo.ezlook.top 是 OpenAI 兼容端点，实测直接吃
    // base64 data URL（返回 usage.prompt_tokens_details.image_tokens > 0）。
    //
    // 两个 seam 缺一不可，否则图片在链路上整个消失：
    //   · resolveAttachments → adapter 才有 AttachmentStore；缺了它
    //     attachment-store 不挂载，tool-fs 的 read_image 根本不会注册
    //     （index.ts 的 ctx.inject(['attachments'], …)），截图能力也就无从谈起。
    //   · resolveImageAccess → 把持久化附件解析成可读字节（含宿主路径映射）。
    // 另需 runtime-profile.json 给模型声明 inputModalities 含 'image'，
    // 否则 assertImageCapableRoute 仍会以「模型未声明图片输入」拒绝。
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
  }
  const adapter = modern
    ? modernAdapter.createMimoAdapter(dependencies, reclassifyMimoForbidden)
    : new MimoAdapter(dependencies)

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'MiMo', settingsNs: name, settingsPath: [] },
  ])
  ctx.llm.registerAdapter([PROVIDER], adapter)

  // The native Models page only renders configurable providers whose settings
  // namespace is installed. Reuse the upstream provider schema and settings
  // store so its API-key editor writes via credentials.set to the configured
  // apiKeyEnv ref in this DSH home.
  ctx.settings.installSection(ctx, name, modernAdapter?.Config ?? DeepSeekConfig, config, {
    setSource: (source) => {
      current = source
    },
    // DSH requires this hook. Adapter options are resolved lazily from the
    // current settings source, so no route re-registration is needed here.
    onChange: () => {},
  })

  ctx.logger?.info?.(`[mochi-llm-mimo] route ${PROVIDER} 已注册 (${modern ? 'pi-ai' : 'alpha'})`)
}
