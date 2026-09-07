/**
 * Safe compatibility adapter for the Harness approval waterfall.
 *
 * This plugin is deliberately not an approval answerer. The official
 * `@deepseek-ai/dsh-user-approval` service owns the closed vocabulary:
 * `allowed-once`, `rejected`, `cancelled`, and `unavailable`.
 *
 * A listener claims a request only by returning one of those outcomes. We
 * never manufacture `allowed-once`: a real UI/ACP answerer may answer via the
 * rest of the waterfall, and an absent, malformed, or failing answerer closes
 * to `unavailable`.
 */
export const name = 'mochi-approval';

const OUTCOMES = new Set(['allowed-once', 'rejected', 'cancelled', 'unavailable']);

export function apply(ctx) {
  if (!ctx || typeof ctx.on !== 'function') {
    // Keeping a no-op plugin is safer than throwing during host composition:
    // without a listener, Harness itself resolves the request as unavailable.
    console.warn('[mochi-approval] no compatible approval waterfall; requests will fail closed');
    return;
  }

  ctx.on('approval/request', async (_request, next) => {
    // `next()` delegates to an actually owning UI/ACP answerer. Its terminal
    // fallback is `unavailable`, so this adapter cannot approve by itself.
    if (typeof next !== 'function') return 'unavailable';
    try {
      const outcome = await next();
      return OUTCOMES.has(outcome) ? outcome : 'unavailable';
    } catch {
      return 'unavailable';
    }
  });

  console.log('[mochi-approval] safe approval delegation registered');
}
