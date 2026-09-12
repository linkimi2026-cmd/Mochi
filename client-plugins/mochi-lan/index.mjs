/**
 * Node half for the browser-only LAN control surface.
 *
 * The authenticated routes and signed transport are owned by plugins/mochi-lan.
 * This package only contributes same-origin browser UI through official slots.
 */
export const name = "mochi-lan-client";

export function apply(ctx) {
  ctx.logger?.debug?.("[mochi-lan-client] same-origin LAN controls available");
}
