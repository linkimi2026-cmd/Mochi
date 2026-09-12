/**
 * Mochi 双 LLM 路由插件：mochi-mimo。
 *
 * 背景：dsh 的 llm-deepseek 适配器是「单 baseURL 单凭据」，route 名
 * `deepseek-official` 硬编码——一个插件实例只能对一个端点。接入
 * mimo.ezlook.top 后智谱官方端点没有位置了。
 *
 * 方案：DeepSeekAdapter 是纯类（baseURL/凭据/模型目录全部来自注入的
 * config），本插件直接复用它，注册第二个 provider route `mochi-mimo`：
 *   - deepseek-official → 继续由 llm-deepseek 插件负责（指回智谱官方）
 *   - mochi-mimo        → 本插件负责（mimo.ezlook.top，MiMo 模型目录）
 *
 * 推理档位由模型目录的 reasoningEfforts 声明（llm-deepseek 产物的 Mochi
 * patch）：mimo 网关实测支持 low/medium/high + thinking:disabled(off)，
 * 不支持 max——目录里就不声明 max，UI 不会出现「极高」。
 *
 * config 来自 cordis.patch.yml 的实例 config（部署期事实，静态）：
 * {
 *   apiKeyEnv: "MIMO_API_KEY",
 *   baseURL: "https://mimo.ezlook.top/v1",
 *   models: [ { id, name, contextWindow, maxTokens, reasoningEfforts? } ]
 * }
 */

import { DeepSeekAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { LlmError, assertUsableApiKey, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'

export const name = 'mochi-llm-mimo'
export const inject = ['llm']

/** 本插件拥有的 provider route。 */
export const PROVIDER = 'mochi-mimo'

export function apply(ctx, config) {
  // 部署期静态 config：load 时校验一次，fail loud。
  const options = () => resolveAdapterOptions(config)
  options()

  const resolveApiKey = async (connection) => {
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== void 0) {
      const hit = await credentials.resolve(ref)
      if (hit !== void 0) return assertUsableApiKey(hit.value, name, ref)
    }
    // 与 llm-deepseek 相同的降级顺序：凭据仓库 → 进程环境。
    const ambient = process.env[ref]
    if (ambient !== void 0 && ambient.length > 0) return assertUsableApiKey(ambient, name, ref)
    throw new LlmError(
      `mochi-llm-mimo: no API key for provider route "${PROVIDER}"; store ${ref} in .credentials.yaml or export it in the environment`,
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
  }

  const adapter = new MimoAdapter({
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
  })

  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'MiMo', settingsNs: name, settingsPath: [] },
  ])
  ctx.llm.registerAdapter([PROVIDER], adapter)

  ctx.logger?.info?.(`[mochi-llm-mimo] route ${PROVIDER} 已注册 → ${options().baseURL}`)
}
