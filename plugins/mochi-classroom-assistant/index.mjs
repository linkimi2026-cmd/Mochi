import { isAbsolute, join } from 'node:path';
import { HomeworkStore } from './homework-store.mjs';
import { installClassroomHostBridge } from './host-bridge.mjs';
export const name = 'mochi-classroom-assistant';
export function apply(ctx, config = {}) {
  if (config.role !== 'classroom') return;
  const root = config.dataRoot ?? process.env.DSH_HOME;
  if (!root || !isAbsolute(root)) throw new Error('Classroom assistant requires an absolute role-specific dataRoot');
  const store = new HomeworkStore(join(root, 'mochi-classroom', 'homework.json'));
  ctx.inject(['connection', 'speechToText'], async host => {
    const { validateWave } = await import('@deepseek-ai/dsh-experimental-speech-to-text/wave');
    return installClassroomHostBridge(host, store, { validateWave });
  });
}
