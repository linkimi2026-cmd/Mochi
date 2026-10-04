import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const isVoiceRequestId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);

/** One audible reply at a time; cancellation belongs to the initiating request. */
export function createVoiceReply(speak: (text: string, signal: AbortSignal) => Promise<void>, preferencePath?: () => string | null) {
  let active: { id: string; controller: AbortController } | undefined;
  let enabled = false, loadedPath: string | null | undefined;
  const stopAll = () => { active?.controller.abort(); active = undefined; };
  const load = () => {
    const path = preferencePath?.() ?? null;
    if (loadedPath === path) return path;
    stopAll(); loadedPath = path; enabled = false;
    if (path) {
      try { enabled = JSON.parse(readFileSync(path, 'utf8')).enabled === true; } catch { /* Missing or invalid preference defaults to muted. */ }
    }
    return path;
  };
  return {
    stopAll,
    getState() { load(); return { enabled }; },
    setEnabled(value: unknown) {
      const path = load();
      if (typeof value !== 'boolean') return { enabled, error: '无效的朗读设置' };
      // Muting takes effect even when the preference cannot be saved.
      if (!value) { enabled = false; stopAll(); }
      if (path) {
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(temporary, JSON.stringify({ enabled: value }) + '\n', { mode: 0o600, flag: 'wx' });
          renameSync(temporary, path);
        } catch {
          return { enabled, error: '朗读设置暂时无法保存，请重试。' };
        } finally { try { rmSync(temporary, { force: true }); } catch { /* Persistence errors retain the user-facing message above. */ } }
      }
      enabled = value;
      return { enabled };
    },
    stop(value: unknown) {
      const id = (value as { id?: unknown } | null)?.id;
      if (!isVoiceRequestId(id)) return { ok: false };
      if (active?.id === id) stopAll();
      return { ok: true };
    },
    async speak(value: unknown) {
      const request = value as { id?: unknown; text?: unknown } | null;
      if (!isVoiceRequestId(request?.id) || typeof request?.text !== 'string'
        || !request.text.trim() || request.text.length > 6000) return { ok: false, error: '无效的朗读内容' };
      load();
      if (!enabled) return { ok: true, muted: true };
      if (active?.id === request.id) return { ok: false, error: '这段回复正在朗读' };
      stopAll();
      const job = { id: request.id, controller: new AbortController() };
      active = job;
      try {
        await speak(request.text, job.controller.signal);
        return job.controller.signal.aborted ? { ok: false, cancelled: true } : { ok: true };
      } catch {
        return job.controller.signal.aborted ? { ok: false, cancelled: true } : { ok: false, error: '暂时无法朗读，请查看文字回复。' };
      } finally {
        if (active === job) active = undefined;
      }
    },
  };
}
