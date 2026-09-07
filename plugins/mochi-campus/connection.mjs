// The local workstation shares its verified campus login with its own tasks.
// Tokens live in process memory AND are mirrored to a local 0600 file so that
// activation survives service restarts (dev loop restarts constantly); the
// mirror is removed on logout/expiry. Task results never contain credentials.
import { chmodSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SESSION_FILE = process.env.MOCHI_CAMPUS_SESSION_FILE
  ?? join(process.env.DSH_HOME ?? join(fileURLToPath(new URL('../..', import.meta.url)), '.mochi-home.nosync'), 'campus-session.json');

export function campusOrigin(value = process.env.MOCHI_CAMPUS_API_URL || 'http://127.0.0.1:8787') {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('校园 API 地址必须是 HTTPS 源地址，或本机 HTTP 源地址。');
  }
  return url.origin;
}

export function campusToken(cookie = '') {
  return /(?:^|;\s*)campus_session=([A-Za-z0-9_-]{40,96})(?:;|$)/.exec(cookie)?.[1];
}

// The browser talks to every campus upstream through the same 3090 host, so a
// host-only `campus_session` cookie cannot express which upstream issued it.
// Namespace the browser-facing cookie by the validated upstream origin; the
// proxy restores the Worker's unchanged `campus_session` protocol upstream.
export function campusBrowserCookieName(origin) {
  const normalized = campusOrigin(origin);
  const suffix = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  return `mochi_campus_session_${suffix}`;
}

export function campusBrowserToken(cookie = '', origin) {
  const name = campusBrowserCookieName(origin);
  return new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{40,96})(?:;|$)`).exec(String(cookie))?.[1];
}

// Keep transport facts intact for callers that must distinguish a verified
// pre-write rejection from an unknown delivery outcome.  The connection layer
// deliberately does not decide whether a particular route was safe to retry.
export class CampusRequestError extends Error {
  constructor(message, { path, status, code } = {}) {
    super(message);
    this.name = 'CampusRequestError';
    this.path = path;
    this.status = status;
    this.code = code;
  }
}

export class CampusConnection {
  #active;
  #bindings = new WeakMap();
  #generation = 0;
  #probeSequence = 0;
  constructor(origin = campusOrigin(), fetcher = fetch) { this.origin = origin; this.fetcher = fetcher; }
  activate(token, user) {
    if (!campusToken(`campus_session=${token}`) || !Number.isInteger(user?.id)) return;
    this.#generation += 1;
    this.#active = { token, user: { id: user.id, name: user.name, role: user.role } };
    this.#persist();
    console.log(`[mochi-campus] 已激活校园登录：${user.name}（${user.role}）`);
  }
  #persist() {
    try {
      writeFileSync(SESSION_FILE, JSON.stringify({ origin: this.origin, token: this.#active.token, user: this.#active.user, at: new Date().toISOString() }), { mode: 0o600 });
      // `mode` only applies on creation. Tighten a pre-existing file as well.
      chmodSync(SESSION_FILE, 0o600);
    } catch (e) { console.log(`[mochi-campus] 会话落盘失败：${e?.message || e}`); }
  }
  #forget() { try { unlinkSync(SESSION_FILE); } catch {} }
  // 服务重启后的自愈：激活态只在内存里活不过一次重启，而开发期服务被频繁重启。
  // 首个工具请求到来时，用落盘 token 探测上游 /api/auth/me 重新激活，无需重新登录。
  #restoring;
  async #restore() {
    let saved;
    try { saved = JSON.parse(readFileSync(SESSION_FILE, 'utf8')); } catch { return; }
    const token = saved?.token;
    let savedOrigin = null;
    try { if (typeof saved?.origin === 'string') savedOrigin = campusOrigin(saved.origin); } catch {}
    // A legacy record has no trustworthy source binding. Never send its token to
    // the currently configured origin; require a fresh browser-side login instead.
    if (!savedOrigin || savedOrigin !== this.origin || !Number.isInteger(saved?.user?.id)) {
      this.#forget();
      console.log('[mochi-campus] 落盘会话缺少有效来源或身份绑定，已清除（需重新登录）。');
      return;
    }
    if (!campusToken(`campus_session=${token}`) || this.#active?.token === token) return;
    if (this.#restoring) return this.#restoring;
    const restoreGeneration = this.#generation;
    this.#restoring = (async () => {
      try {
        const r = await this.fetcher(this.origin + '/api/auth/me', {
          headers: { Cookie: `campus_session=${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        const me = r.ok ? await r.json().catch(() => null) : null;
        // Logout or a newer browser login wins over an older restore probe.
        if (this.#generation !== restoreGeneration || this.#active) return;
        if (me && Number.isInteger(me.user?.id) && me.user.id === saved.user.id) this.activate(token, me.user);
        else if (r.ok) { this.#forget(); console.log('[mochi-campus] 落盘会话身份无法验证或不一致，已清除（需重新登录）。'); }
        else if (r.status === 401) { this.#forget(); console.log('[mochi-campus] 落盘会话已失效，已清除（需重新登录）。'); }
      } catch (e) { console.log(`[mochi-campus] 会话恢复探测失败：${e?.message || e}`); }
      finally { this.#restoring = undefined; }
    })();
    return this.#restoring;
  }
  // 主动探测激活：只要浏览器带 campus_session cookie 打过任意 /jxl-api 请求，
  // 就用该 token 问上游 /api/auth/me 并激活——不再依赖前端一定会调 me/login。
  // 同一 token 只探测一次（探测中/已激活都跳过），失败静默（下次请求再试）。
  #probing;
  ensureActive(token) {
    if (!token || this.#active?.token === token || this.#probing === token) return;
    this.#probing = token;
    const done = () => { if (this.#probing === token) this.#probing = undefined; };
    const probeGeneration = this.#generation;
    const probeSequence = ++this.#probeSequence;
    this.fetcher(this.origin + '/api/auth/me', {
      headers: { Cookie: `campus_session=${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
    }).then((r) => (r.ok ? r.json() : null)).then((me) => {
      done();
      // A browser login response is allowed to replace the active account, but
      // only when it is the newest outstanding probe in the same login generation.
      if (this.#generation === probeGeneration && this.#probeSequence === probeSequence && me && Number.isInteger(me.user?.id)) this.activate(token, me.user);
    }).catch(done);
  }
  clear(token) {
    // When no active memory state exists, this is a restart-era logout. Clear the
    // persisted record too so a late restore cannot put the account back.
    if (!token || token === this.#active?.token || !this.#active) {
      this.#generation += 1;
      this.#active = undefined;
      this.#forget();
    }
  }
  // 写操作工具在发起任何 request() 前就要拿 binding；若本进程从未激活（首个工具
  // 调用就是写操作），必须先走落盘恢复，否则永远"未激活"（2026-09-05 实测坑）。
  async binding(exec) {
    const session = exec?.agent?.session;
    if (!session) { console.log('[mochi-campus] binding 失败：当前执行上下文没有会话（需在 Mochi 对话中调用）。'); throw new Error('校园操作需要在 Mochi 对话中执行。'); }
    if (!this.#active) await this.#restore();
    if (!this.#active) { console.log('[mochi-campus] binding 失败：本进程未激活校园登录（浏览器侧需先打开任一校园页面）。'); throw new Error('请先在侧栏任一校园页面登录账号，再继续此对话。'); }
    const bound = this.#bindings.get(session);
    if (bound !== undefined && bound !== this.#active.user.id) throw new Error('校园账号已切换。请新建对话，以当前账号重新开始。');
    this.#bindings.set(session, this.#active.user.id);
    return { ...this.#active, session };
  }
  async request(path, exec, { method = 'GET', body, expectedUserId } = {}) {
    if (!path.startsWith('/api/') || path.includes('..') || path.includes('\\')) throw new Error('无效校园接口。');
    if (!this.#active) await this.#restore();
    const bound = await this.binding(exec);
    if (expectedUserId !== undefined && bound.user.id !== expectedUserId) throw new Error('确认期间账号发生变化，请重新开始。');
    const signal = exec?.signal ? AbortSignal.any([exec.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
    let response;
    try {
      response = await this.fetcher(this.origin + path, {
        method, redirect: 'error', signal,
        headers: { Cookie: `campus_session=${bound.token}`, Origin: this.origin, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error(method === 'GET' ? '校园服务暂不可达，请稍后重试。' : '服务未返回确定结果。请先到校园页面核对，勿重复提交。');
    }
    const data = await response.json().catch(() => null);
    const code = typeof data?.code === 'string' ? data.code : undefined;
    if (response.status === 401) {
      this.clear(bound.token);
      console.log(`[mochi-campus] ${method} ${path} -> 401（登录过期）`);
      throw new CampusRequestError(data?.error || '校园登录已过期，请重新登录。', { path, status: 401, code });
    }
    if (!response.ok) {
      console.log(`[mochi-campus] ${method} ${path} -> ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
      throw new CampusRequestError(data?.error || `校园服务返回 ${response.status}`, { path, status: response.status, code });
    }
    // Do not return an old account's response after an account switch/logout.
    if (this.#active?.user.id !== bound.user.id || this.#active?.token !== bound.token) throw new Error('请求期间校园登录发生变化，请重新查询。');
    console.log(`[mochi-campus] ${method} ${path} -> ${response.status} ${JSON.stringify(data).slice(0, 260)}`);
    return { source: this.origin, dataMode: response.headers.get('x-demo-mode') === 'true' ? 'cloud-demo' : 'campus-api', account: bound.user, result: data };
  }
}

export const campusConnection = new CampusConnection();
