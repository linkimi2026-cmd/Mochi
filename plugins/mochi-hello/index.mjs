import { installModelDiagnostic } from './doctor.mjs'

export const name = 'mochi-hello'

export function apply(ctx) {
  console.log('[Mochi] hello plugin loaded! 内核已挂载自定义插件')
  if (ctx.logger?.info) ctx.logger.info('[mochi-hello] apply() 被调用')
  // Headless profiles keep the original hello behavior. This child activates
  // only in host compositions that actually provide both required services.
  ctx.inject(['connection', 'llm'], (hostCtx) => {
    installModelDiagnostic(hostCtx)
  })
}
