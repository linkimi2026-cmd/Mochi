/**
 * Node half for the browser-only 对话 / 工作 mode switch.
 *
 * All mode state lives on the host (the `mochiModes` session projection and the
 * `mochi-modes` plugin's tool restriction). This module owns no mode state and
 * proxies nothing: the browser half reads the official projection and switches
 * through the official command channel.
 *
 * The package id is `mochi-modes-client` (not `mochi-modes`) because the
 * profile's plugin map is keyed by one id per package: `mochi-modes` is the
 * host plugin under `plugins/mochi-modes`, so the browser half takes the
 * `*-client` suffix exactly like `mochi-lan` / `mochi-lan-client`.
 */
export const name = "mochi-modes-client";

export function apply(ctx) {
  ctx.logger?.debug?.("[mochi-modes-client] browser mode switch available");
}
