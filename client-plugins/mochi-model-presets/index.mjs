/**
 * Node half for the browser-only model preset guide.
 *
 * All setting reads and writes stay in the browser half and use the official
 * remote settings surface. This module deliberately owns no credentials,
 * model selection, or runtime profile configuration.
 */
export const name = "mochi-model-presets";

export function apply(ctx) {
  ctx.logger?.debug?.("[mochi-model-presets] browser model preset guide available");
}
