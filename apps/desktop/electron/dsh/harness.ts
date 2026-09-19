/**
 * Mochi · dsh sidecar 生命周期 + stdio JSON-RPC 客户端（Batch 2 前半段）
 *
 * ⚠️ 现状（2026-09-19 核实）：**本模块当前不可达**。
 *   桌面主进程现在用 `./web-host` 的 `DshWebHost` 承载官方 Web SPA，
 *   全仓搜索确认没有任何地方调用 `startDshSidecar()` 或 `attachIpcHandlers()`
 *   （`electron/main.ts` 只引用 `DshWebHost`）。本文件是「自绘渲染进程 + 进程外
 *   sidecar」那一版的遗留物。保留是因为它记录了一批实测事实（见下）且尚未正式
 *   决定删除，但**不要把它当作现行链路**。
 *
 * ⚠️ 因此下面的 `initialize()` 里仍是早期默认路由 `deepseek-official` / `glm-4-flash`
 *   （智谱）。它**不影响打包版**，因为这段代码不会被调用；但若将来把 sidecar 接回来，
 *   这里必须改成当前出厂默认：`provider: 'mochi-aiaaa'` +
 *   `model: 'deepseek-v4.1-flash'`（见 docs/gateway-aiaaa-verified-facts.md）。
 *
 * 职责（与 08 §2 / §3 一致）：
 *   主进程 spawn `dsh --profile mochi-sdk` 子进程（stdio JSON-RPC sidecar），
 *   自己做「进程生命周期 + 健康检查 + 崩溃重启 + 优雅退出」，
 *   不依赖 SDK 包自带的客户端（自建更可控、便于接审批桥）。
 *
 * 关键事实（实测，见 /tmp 验证记录与 AGENT_COMMS）：
 *   · mochi-sdk profile = dsh-base + dsh-sdk-app（自带 dsh-sdk-jsonrpc-server），
 *     经 stdio 常驻 JSON-RPC；`--profile mochi`（headless 包）只用于 CLI 单次验证。
 *   · `initialize` 首次握手约 11s（拉模型目录），必须给足超时（默认 60s）。
 *   · server→client requests 是 dead capability（07 Q1）：审批请求**不下发**到 SDK
 *     通道，由进程内 mochi-approval answerer 处理（前半段自动放行）。
 *
 * 设计：单例 `DshSidecar` 继承 EventEmitter，对外 emit:
 *   'ready'        初始化完成，可以投 prompt
 *   'stream'       DshStreamEvent（来自 session.event / session.status 通知）
 *   'exit'         子进程退出
 *   'unavailable'  连续崩溃超过上限，交给上层（演示模式接管）
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { DshStreamEvent } from './protocol';

const MAX_RESTARTS = 3;
const INIT_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 120_000;
const GRACEFUL_KILL_MS = 5_000;
const RESTART_DELAY_MS = 500;

/** sidecar 用的 dsh profile（sdk 入口 + mochi 插件，常驻 JSON-RPC）。 */
const SIDECAR_PROFILE = 'mochi-sdk';

class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

interface SidecarOptions {
  nodeBin: string;
  dshBin: string;
  profile: string;
  env: Record<string, string>;
}

export class DshSidecar extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }
  >();
  private restartCount = 0;
  private stopping = false;
  private killTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: SidecarOptions) {
    super();
  }

  /** 启动 sidecar（惰性 spawn + initialize）。 */
  start(): void {
    this.spawnProcess();
  }

  private spawnProcess(): void {
    const proc = spawn(this.opts.nodeBin, [this.opts.dshBin, '--profile', this.opts.profile], {
      cwd: this.opts.env.DSH_HOME,
      env: this.opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    this.proc = proc;

    proc.stdout.on('data', (d: Buffer) => this.onStdout(d.toString()));
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (s) console.error('[mochi-dsh]', s);
    });
    proc.on('exit', (code: number | null, signal: string | null) => this.onExit(code, signal));

    console.log('[mochi] dsh sidecar 启动（profile=' + this.opts.profile + '）');

    this.initialize()
      .then(() => {
        this.restartCount = 0;
        this.emit('ready');
        console.log('[mochi] dsh sidecar 就绪（initialize 完成）');
      })
      .catch((err: unknown) => {
        console.error('[mochi-dsh] initialize 失败：', err);
        if (!this.stopping) this.proc?.kill('SIGKILL');
      });
  }

  private initialize(): Promise<unknown> {
    // 早期默认路由（智谱）。本模块当前不可达，故不影响打包版；接回来时改成
    // mochi-aiaaa / deepseek-v4.1-flash —— 理由见文件头与
    // docs/gateway-aiaaa-verified-facts.md。
    return this.request(
      'initialize',
      {
        cwd: this.opts.env.DSH_HOME,
        provider: 'deepseek-official',
        model: 'glm-4-flash',
        reasoningEffort: 'off',
      },
      INIT_TIMEOUT_MS,
    );
  }

  /** 投一个 prompt，返回 SDK 的 messageId（入队回执）。 */
  sendPrompt(text: string, sessionId = 'mochi-main'): Promise<{ messageId: string }> {
    return this.request(
      'session/prompt',
      { sessionId, contentBlocks: [{ type: 'text', text }] },
      REQUEST_TIMEOUT_MS,
    ) as Promise<{ messageId: string }>;
  }

  /** 取消 prompt。注意：07 Q1 指出 SDK 通道无 mid-turn cancel，这里仅占位。 */
  cancelPrompt(): Promise<void> {
    return Promise.resolve();
  }

  /** 优雅关闭（shutdown 请求 → 子进程退出）。 */
  async shutdown(): Promise<void> {
    try {
      await this.request('shutdown', undefined, 5_000);
    } catch {
      /* 忽略：下面 SIGTERM 兜底 */
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.proc) return Promise.reject(new Error('dsh sidecar 未启动'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JsonRpcError(-1, `JSON-RPC ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let nl = this.buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      nl = this.buf.indexOf('\n');
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: { code: number; message: string }; method?: string; params?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // 非 JSON 行（启动 banner 等）忽略
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new JsonRpcError(msg.error.code, msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        this.onNotification(msg.method, msg.params);
      }
    }
  }

  private onNotification(method: string, params: unknown): void {
    const p = params as { sessionId?: string; status?: string; event?: SessionEventLike } | undefined;
    if (method === 'session.status') {
      this.emit('stream', { kind: 'status', status: p?.status === 'running' ? 'running' : 'idle' } as DshStreamEvent);
      return;
    }
    if (method === 'session.event') {
      this.mapSessionEvent(p?.event);
    }
  }

  private mapSessionEvent(ev: SessionEventLike | undefined): void {
    if (!ev) return;
    const type = ev.type;
    const data = ev.data ?? {};
    switch (type) {
      case 'turn/start':
      case 'agent/status':
        this.emit('stream', { kind: 'thinking' } as DshStreamEvent);
        break;
      case 'assistant/message':
      case 'agent/inbox/spliced': {
        const text = extractText(data);
        if (text) this.emit('stream', { kind: 'text', text } as DshStreamEvent);
        break;
      }
      case 'tool/call':
        this.emit('stream', { kind: 'tool', toolName: (data as { toolName?: string }).toolName ?? 'unknown', args: (data as { args?: unknown }).args } as DshStreamEvent);
        break;
      case 'turn/end':
      case 'session/end':
        this.emit('stream', { kind: 'status', status: 'idle' } as DshStreamEvent);
        this.emit('stream', { kind: 'final', text: '' } as DshStreamEvent);
        break;
      default:
        break;
    }
  }

  private onExit(code: number | null, signal: string | null): void {
    this.proc = null;
    // 清理未决请求
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new JsonRpcError(-1, `dsh sidecar 退出（code=${code}, signal=${signal}）`));
    }
    this.pending.clear();
    this.emit('exit', code, signal);

    if (this.stopping) return;

    if (this.restartCount < MAX_RESTARTS) {
      this.restartCount += 1;
      console.warn(`[mochi-dsh] sidecar 异常退出（code=${code}, signal=${signal}），第 ${this.restartCount}/${MAX_RESTARTS} 次重启`);
      setTimeout(() => this.spawnProcess(), RESTART_DELAY_MS);
    } else {
      console.error('[mochi-dsh] sidecar 连续崩溃超过上限，放弃重启，交由演示模式接管');
      this.emit('unavailable');
    }
  }

  /** 主动停止：SIGTERM，超时后 SIGKILL。 */
  stop(): void {
    this.stopping = true;
    if (this.killTimer) clearTimeout(this.killTimer);
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.killTimer = setTimeout(() => this.proc?.kill('SIGKILL'), GRACEFUL_KILL_MS);
    }
  }
}

/* ── 小工具类型 / 函数 ── */

interface SessionEventLike {
  type: string;
  data?: Record<string, unknown>;
}

function extractText(data: Record<string, unknown>): string {
  const content = data.content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('');
  }
  if (typeof data.text === 'string') return data.text;
  return '';
}

/* ── 解析 dsh / node 二进制（开发态 vs 打包态） ── */

function resolveNodeBin(): string {
  if (process.env.MOCHI_DSH_NODE) return process.env.MOCHI_DSH_NODE;
  // 开发态：workbuddy 随附的 Node 22.22.2（≥ dsh 要求的 22.19）
  const devNode = '/Users/a1379/.workbuddy/binaries/node/versions/22.22.2-2/bin/node';
  if (existsSync(devNode)) return devNode;
  // 打包态：随包 Node；Electron 39 自带 Node 22.20.0 也满足要求
  return process.execPath;
}

function resolveDshBin(): string | null {
  if (process.env.MOCHI_DSH_BIN) return process.env.MOCHI_DSH_BIN;
  const devDsh = '/Users/a1379/.workbuddy/binaries/node/workspace/node_modules/.bin/dsh';
  if (existsSync(devDsh)) return devDsh;
  // 打包态：随包 dsh（见 08 §2.4 launcher）
  const bundled = join(app.getAppPath(), '..', 'dsh', 'node_modules', '.bin', 'dsh');
  return existsSync(bundled) ? bundled : null;
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'ELECTRON_RUN_AS_NODE' || k.startsWith('ELECTRON_')) continue; // 清掉宿主泄漏的控制变量
    env[k] = v;
  }
  env.DSH_HOME = process.env.DSH_HOME ?? join(app.getPath('userData'), 'dsh-home');
  // 校园数据不出校 + profile-boot.ts:78-104 双保险
  env.DSH_TELEMETRY_DISABLED = '1';
  env.FORCE_COLOR = '0';
  return env;
}

/* ── 模块级单例与对外 API ── */

let sidecar: DshSidecar | null = null;

/** 启动 dsh sidecar。依赖 DSH_BIN 解析；未分发时返回 false（Batch 2 前半段允许）。 */
export function startDshSidecar(): boolean {
  const dshBin = resolveDshBin();
  if (!dshBin) {
    console.warn('[mochi] dsh sidecar 未随包分发（dsh bin 未解析到），跳过启动');
    return false;
  }
  if (sidecar) return true;
  sidecar = new DshSidecar({
    nodeBin: resolveNodeBin(),
    dshBin,
    profile: SIDECAR_PROFILE,
    env: buildEnv(),
  });
  sidecar.start();
  return true;
}

/** 停止 dsh sidecar（优雅退出）。 */
export function stopDshSidecar(): void {
  sidecar?.stop();
  sidecar = null;
}

/** 订阅 dsh 事件流（main 进程用来转发到 renderer）。 */
export function onDshStream(cb: (event: DshStreamEvent) => void): void {
  sidecar?.on('stream', cb);
}

/** 订阅 sidecar 不可用事件（上层切演示模式）。 */
export function onDshUnavailable(cb: () => void): void {
  sidecar?.on('unavailable', cb);
}

/** 暴露单例，供 attachIpcHandlers 调 sendPrompt。 */
export function getSidecar(): DshSidecar | null {
  return sidecar;
}
