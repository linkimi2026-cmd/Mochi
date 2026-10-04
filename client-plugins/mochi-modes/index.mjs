/** Browser-only teacher scene selection; runtime identity stays stable for upgrades. */
export const name = "mochi-modes-client";

export function apply(ctx) {
  ctx.logger?.debug?.("[mochi-modes-client] teacher scenes available");
}
