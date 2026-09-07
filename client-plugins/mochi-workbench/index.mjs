/**
 * Node half for the browser-only teacher workbench.
 *
 * The browser contribution uses official Harness slots. It neither proxies
 * Office traffic nor stores documents, credentials, selections, or drafts.
 */
export const name = "mochi-workbench";

export function apply(ctx) {
  ctx.logger?.debug?.("[mochi-workbench] browser workbench contribution available");
}
