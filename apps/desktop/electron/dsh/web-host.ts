import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { prepareDshHome, resolveMochiServiceDefaults, type MochiServiceDefaults } from "./profile";

const READY_TIMEOUT_MS = 90_000;
const GRACEFUL_KILL_MS = 5_000;
const PROFILE = "mochi-web";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const requireFromHere = createRequire(__filename);

export function parseReadyUrl(text: string): string | null {
  const match = text.match(/dsh web:\s+(https?:\/\/[^\s]+)/i);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    if (!LOOPBACK.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveDshBin(): string | null {
  if (process.env.MOCHI_DSH_BIN && existsSync(process.env.MOCHI_DSH_BIN)) {
    return process.env.MOCHI_DSH_BIN;
  }

  // `@deepseek-ai/dsh-app-boot` maintains a profile dependency fallback using
  // real filesystem links. In an Electron package, resolving the entrypoint
  // inside app.asar makes those links point into the virtual archive. Builder
  // already unpacks the Harness tree, so run its physical entrypoint first.
  const unpacked = join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (existsSync(unpacked)) return unpacked;

  try {
    return requireFromHere.resolve("@deepseek-ai/dsh/lib/bin.js");
  } catch {
    // Retain support for the older dedicated-resource layout below.
  }

  const bundled = join(process.resourcesPath, "dsh", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  return existsSync(bundled) ? bundled : null;
}

export function buildDshArgs(dshBin: string, port: string, runAsNode: boolean): string[] {
  return runAsNode
    ? ["--expose-internals", dshBin, "--profile", PROFILE, "--port", port, "--no-open"]
    : [dshBin, "--profile", PROFILE, "--port", port, "--no-open"];
}

function resolveNodeBin(): { command: string; runAsNode: boolean } {
  if (process.env.MOCHI_DSH_NODE && existsSync(process.env.MOCHI_DSH_NODE)) {
    return { command: process.env.MOCHI_DSH_NODE, runAsNode: false };
  }
  return { command: process.execPath, runAsNode: true };
}

function buildEnv(
  runAsNode: boolean,
  dshHome: string,
  serviceDefaults: MochiServiceDefaults,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("ELECTRON_")) continue;
    env[key] = value;
  }
  env.DSH_HOME = dshHome;
  env.DSH_TELEMETRY_DISABLED = "1";
  env.FORCE_COLOR = "0";
  if (serviceDefaults.campusApiUrl !== undefined) {
    env.MOCHI_CAMPUS_API_URL = serviceDefaults.campusApiUrl;
  }
  if (serviceDefaults.searxngEndpoint !== undefined) {
    env.MOCHI_SEARXNG_ENDPOINT = serviceDefaults.searxngEndpoint;
  }
  if (runAsNode) env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

export class DshWebHost extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stopping = false;
  private killTimer: NodeJS.Timeout | null = null;
  private stopPromise: Promise<void> | null = null;

  async start(): Promise<string> {
    if (this.child) throw new Error("Mochi Web Host 已启动");
    const dshBin = resolveDshBin();
    if (!dshBin) throw new Error("找不到 @deepseek-ai/dsh；请安装桌面运行时依赖或设置 MOCHI_DSH_BIN");

    const node = resolveNodeBin();
    const serviceDefaults = resolveMochiServiceDefaults();
    const dshHome = prepareDshHome();
    const env = buildEnv(node.runAsNode, dshHome, serviceDefaults);
    const port = process.env.MOCHI_DSH_PORT ?? "0";
    // Harness uses Node's internal module loader to resolve profile-local ESM
    // plugins from the profile base URL. Electron's run-as-Node mode does not
    // expose that loader unless this Node flag appears before the DSH entrypoint.
    const args = buildDshArgs(dshBin, port, node.runAsNode);
    const child = spawn(node.command, args, {
      // DSH treats its cwd as the project environment layer. Keep it inside
      // the provisioned product home instead of inheriting Finder's cwd.
      cwd: dshHome,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let buffer = "";
      const timeout = setTimeout(() => finish(new Error(`Mochi Web Host 在 ${READY_TIMEOUT_MS}ms 内未就绪`)), READY_TIMEOUT_MS);

      const finish = (error: Error | null, url?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(url!);
      };

      const accept = (chunk: Buffer, level: "stdout" | "stderr") => {
        const text = chunk.toString();
        buffer = (buffer + text).slice(-16_384);
        const readyUrl = parseReadyUrl(buffer);
        if (readyUrl) {
          this.emit("ready", readyUrl);
          finish(null, readyUrl);
        }
        const clean = text.trim();
        if (clean && level === "stderr") console.error("[mochi-web]", clean);
      };

      child.stdout.on("data", (chunk: Buffer) => accept(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => accept(chunk, "stderr"));
      child.once("error", (error) => finish(error));
      child.once("exit", (code, signal) => {
        this.child = null;
        const error = new Error(`Mochi Web Host 已退出（code=${String(code)}, signal=${String(signal)}）`);
        if (!this.stopping) this.emit("exit", error);
        finish(error);
      });
    });
  }

  stop(): Promise<void> {
    this.stopping = true;
    if (this.stopPromise !== null) return this.stopPromise;
    if (this.killTimer) clearTimeout(this.killTimer);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.child = null;
      return Promise.resolve();
    }

    this.stopPromise = new Promise<void>((resolve) => {
      const complete = () => {
        if (this.killTimer) clearTimeout(this.killTimer);
        this.killTimer = null;
        this.child = null;
        resolve();
      };
      child.once("exit", complete);
      // An exit can be observed between the first state check and listener
      // attachment on a busy event loop. Resolve immediately in that case.
      if (child.exitCode !== null || child.signalCode !== null) {
        complete();
        return;
      }
      child.kill("SIGTERM");
      this.killTimer = setTimeout(() => child.kill("SIGKILL"), GRACEFUL_KILL_MS);
    });
    return this.stopPromise;
  }
}
