/** Catalog settings guide and authenticated per-session reasoning policy.
 * Model capability and selection remain owned by the official Harness services.
 */
import { join } from 'node:path';
import { installReasoning, ReasoningStore } from './reasoning.mjs';
export const name = "mochi-model-presets";

export function apply(ctx) {
  ctx.logger?.debug?.("[mochi-model-presets] browser model preset guide available");
  ctx.inject(['llm', 'sessionController', 'connection', 'agentDefaultModel'], host => {
    if (typeof host.llm.resolveModelInfo !== 'function' || typeof host.sessionController.resolveAgent !== 'function') return;
    return installReasoning(host, new ReasoningStore(join(process.env.DSH_HOME ?? '', 'mochi-reasoning', 'policy.json')));
  });
}
