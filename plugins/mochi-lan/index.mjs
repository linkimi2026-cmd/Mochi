import { installLanHostBridge } from './host-bridge.mjs';
import { MochiLanService } from './lan-service.mjs';

export const name = 'mochi-lan';

/**
 * The LAN service deliberately starts without a model turn. Its settings and
 * inbox are reached through Connection's authenticated local routes, while
 * teacher-originated notifications are registered by mochi-dispatch and still
 * pass through the official approval waterfall.
 */
export function apply(ctx, config = {}) {
  // [Mochi 2026-09-09] WO-6 广播开关：宿主显式配置优先；缺省时允许部署用
  // MOCHI_LAN_DISCOVERY=0/false 关闭自动发现广播（例如封闭网络巡检）。
  const envDiscovery = process.env.MOCHI_LAN_DISCOVERY;
  const discoveryEnabled = config.discoveryEnabled
    ?? (envDiscovery === '0' || envDiscovery === 'false' ? false : undefined);
  const lan = new MochiLanService({
    ...(config.dataRoot === undefined ? {} : { dataRoot: config.dataRoot }),
    ...(config.bindHost === undefined ? {} : { bindHost: config.bindHost }),
    ...(config.port === undefined ? {} : { port: config.port }),
    ...(discoveryEnabled === undefined ? {} : { discoveryEnabled }),
    ...(config.discoveryPort === undefined ? {} : { discoveryPort }),
    ...(config.lockedRole === undefined && config.role === undefined ? {} : { lockedRole: config.lockedRole ?? config.role }),
    ...(config.identity === undefined ? {} : { identity: config.identity }),
  });
  ctx.provide('mochiLan', lan);
  ctx.inject(['connection'], (hostCtx) => installLanHostBridge(hostCtx, lan));
  // Cordis treats a returned promise as an effect whose resolved value must be
  // a disposer. Returning the raw snapshot from lan.start() would therefore
  // mark the plugin active before startup completed. Bind startup and cleanup
  // as one lifecycle effect instead.
  return lan.start().then(() => () => lan.stop());
}
