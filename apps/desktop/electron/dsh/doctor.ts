import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer, connect, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_DOCTOR_BUDGET_MS = 5_000;
const DEFAULT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const TIME_DRIFT_WARN_MS = 5 * 60 * 1_000;
const MAX_CREDENTIAL_RESPONSE_BYTES = 64 * 1024;
const CREDENTIAL_PROBE_MESSAGE = "Mochi Doctor connectivity probe.";

export const DOCTOR_CHECK_IDS = [
  "system-version",
  "architecture",
  "disk-space",
  "home-writable",
  "loopback",
  "system-time",
  "model-service",
  "credentials",
  "campus-service",
  "search-endpoint",
  "proxy",
] as const;

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];
export type DoctorStatus = "pass" | "warn" | "fail" | "unavailable";
export type DoctorHttpMethod = "GET" | "HEAD";

export interface DoctorHttpProbe {
  /** Explicit endpoint only. It is never copied into a doctor result or report. */
  url: string;
  method?: DoctorHttpMethod;
}

export interface DoctorCredentialsProbe {
  /** Explicit chat-completions endpoint only. It is never copied into a report. */
  url: string;
  /** The caller supplies a controlled value; the module never reads stored credentials. */
  apiKey: string;
  /** An explicit model is required so a public health page cannot pass this check. */
  model: string;
}

export interface DoctorProxyProbe {
  /** Explicit proxy endpoint. The diagnostic report never includes this value. */
  proxyUrl: string;
  /** An HTTP target used only to verify the configured proxy response. */
  targetUrl: string;
}

export interface DoctorRuntimeConfig {
  platform?: NodeJS.Platform;
  arch?: string;
  systemVersion?: string;
  expectedArchitecture?: string;
}

export interface DoctorStorageConfig {
  /** Defaults to the current user's home directory when the main process integrates it. */
  path?: string;
}

export type DoctorDiagnosticCode =
  | "WEB_HOST_RUNTIME_MISSING"
  | "WEB_HOST_TIMEOUT"
  | "WEB_HOST_EXITED"
  | "WEB_HOST_START_FAILED";

export interface DoctorDiagnosticEvent {
  stage: "web-host";
  code: DoctorDiagnosticCode;
}

/** The fixed, non-secret outcome vocabulary returned by the in-process DSH bridge. */
export type DoctorHostModelStatus = "ok" | "unavailable" | "error" | "cancelled" | "not-checked";

export type DoctorHostModelCheckCode =
  | "OK"
  | "INVALID_REQUEST"
  | "CHECK_IN_PROGRESS"
  | "PROVIDER_UNAVAILABLE"
  | "NO_MODEL"
  | "MISSING_CREDENTIAL"
  | "INVALID_CREDENTIAL"
  | "AUTH_FAILED"
  | "ACCOUNT_UNAVAILABLE"
  | "UPSTREAM_UNAVAILABLE"
  | "TIMEOUT"
  | "CANCELLED"
  | "UNKNOWN_FAILURE"
  | "NOT_CHECKED";

export interface DoctorHostModelOutcome {
  status: DoctorHostModelStatus;
  code: DoctorHostModelCheckCode;
  durationMs: number;
}

export type DoctorHostModelProbeUnavailableReason =
  | "host-not-ready"
  | "unauthenticated"
  | "forbidden"
  | "endpoint-missing"
  | "unexpected-response"
  | "response-too-large"
  | "request-failed";

export type DoctorHostModelCheckResult =
  | {
    kind: "result";
    modelService: DoctorHostModelOutcome;
    credentials: DoctorHostModelOutcome;
  }
  | {
    kind: "unavailable";
    reason: DoctorHostModelProbeUnavailableReason;
  };

/**
 * Internal-only bridge. It receives the current Electron-session request
 * cancellation and returns only a validated, non-secret outcome vocabulary.
 */
export type DoctorHostModelProbe = (signal: AbortSignal) => Promise<DoctorHostModelCheckResult>;

export interface DoctorConfig {
  /** The whole run is always capped at five seconds; smaller values are useful to callers/tests. */
  totalBudgetMs?: number;
  runtime?: DoctorRuntimeConfig;
  storage?: DoctorStorageConfig;
  timeReference?: DoctorHttpProbe;
  modelService?: DoctorHttpProbe;
  credentials?: DoctorCredentialsProbe;
  /** Main-process-only DSH bridge. It supersedes the two explicit legacy probes for this run. */
  hostModelProbe?: DoctorHostModelProbe;
  campusService?: DoctorHttpProbe;
  searchEndpoints?: readonly DoctorHttpProbe[];
  proxy?: DoctorProxyProbe;
  /** Only fixed, pre-redacted diagnostic codes are accepted; raw logs are deliberately unsupported. */
  diagnosticEvents?: readonly DoctorDiagnosticEvent[];
}

export interface DoctorCheckResult {
  id: DoctorCheckId;
  label: string;
  status: DoctorStatus;
  message: string;
  action: string;
  durationMs: number;
}

export interface DoctorRunResult {
  overallStatus: DoctorStatus;
  totalDurationMs: number;
  checks: readonly DoctorCheckResult[];
  recentDiagnostics: readonly DoctorDiagnosticEvent[];
}

type CheckContent = Omit<DoctorCheckResult, "id" | "label" | "durationMs">;

interface DoctorRunContext {
  config: DoctorConfig;
  globalSignal: AbortSignal;
  externalSignal?: AbortSignal;
  didBudgetExpire(): boolean;
}

const CHECK_LABELS: Record<DoctorCheckId, string> = {
  "system-version": "系统版本",
  architecture: "系统架构",
  "disk-space": "磁盘空间",
  "home-writable": "用户目录写入权限",
  loopback: "本机回环网络",
  "system-time": "系统时间",
  "model-service": "模型服务连通性",
  credentials: "模型密钥有效性",
  "campus-service": "校园服务连通性",
  "search-endpoint": "搜索端点",
  proxy: "代理连通性",
};

class DoctorAbortError extends Error {
  constructor() {
    super("doctor probe aborted");
    this.name = "DoctorAbortError";
  }
}

class DoctorConfigurationError extends Error {
  constructor() {
    super("doctor probe configuration is invalid");
    this.name = "DoctorConfigurationError";
  }
}

function content(status: DoctorStatus, message: string, action: string): CheckContent {
  return { status, message, action };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DoctorAbortError();
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DoctorAbortError) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ABORT_ERR";
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function defaultSystemVersion(): string | undefined {
  const electronProcess = process as NodeJS.Process & { getSystemVersion?: () => string };
  return electronProcess.getSystemVersion?.();
}

function storagePath(config: DoctorConfig): string {
  return config.storage?.path ?? homedir();
}

async function nearestExistingDirectory(path: string): Promise<string> {
  let candidate = resolve(path);
  while (true) {
    try {
      const stats = await fs.stat(candidate);
      if (stats.isDirectory()) return candidate;
    } catch {
      // The writable-home probe may create a new runtime directory in parallel.
      // Use its existing parent for the same filesystem's free-space check.
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new DoctorConfigurationError();
    candidate = parent;
  }
}

function isHealthyHttpStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 400;
}

function attachAbortSignals(context: DoctorRunContext): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  context.globalSignal.addEventListener("abort", forwardAbort, { once: true });
  context.externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (context.globalSignal.aborted || context.externalSignal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    dispose() {
      context.globalSignal.removeEventListener("abort", forwardAbort);
      context.externalSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

async function runCheck(
  id: DoctorCheckId,
  context: DoctorRunContext,
  perform: (signal: AbortSignal) => Promise<CheckContent>,
): Promise<DoctorCheckResult> {
  const startedAt = performance.now();
  const abort = attachAbortSignals(context);
  try {
    throwIfAborted(abort.signal);
    const result = await perform(abort.signal);
    // A probe may resolve at the same time as the global deadline. Never let a
    // result that arrived after cancellation be reported as a pass.
    throwIfAborted(abort.signal);
    return { id, label: CHECK_LABELS[id], durationMs: elapsedMs(startedAt), ...result };
  } catch (error) {
    let result: CheckContent;
    if (context.didBudgetExpire()) {
      result = content("warn", "检测超时，未阻塞启动。", "可在设置中稍后重新检测。");
    } else if (abort.signal.aborted || isAbortError(error)) {
      result = content("unavailable", "检测已取消，未取得结果。", "可在设置中重新检测。");
    } else {
      result = content("warn", "检测未能完成。", "可在设置中重新检测；若持续出现请联系技术同事。");
    }
    return { id, label: CHECK_LABELS[id], durationMs: elapsedMs(startedAt), ...result };
  } finally {
    abort.dispose();
  }
}

interface HttpResponseInfo {
  statusCode: number;
  dateHeader?: string;
}

interface ChatResponseInfo {
  statusCode: number;
  hasRecognizedChatResponse: boolean;
}

function parseHttpUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DoctorConfigurationError();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DoctorConfigurationError();
  }
  return parsed;
}

function requestUrl(
  url: URL,
  method: DoctorHttpMethod,
  signal: AbortSignal,
  headers?: Record<string, string>,
  path?: string,
): Promise<HttpResponseInfo> {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers,
      agent: false,
      signal,
      ...(path === undefined ? {} : { path }),
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      ...options,
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const dateHeader = typeof response.headers.date === "string" ? response.headers.date : undefined;
      response.once("error", reject);
      response.once("end", () => resolve({ statusCode, dateHeader }));
      response.resume();
    });
    request.once("error", reject);
    request.end();
  });
}

async function requestProbe(probe: DoctorHttpProbe, signal: AbortSignal): Promise<HttpResponseInfo> {
  throwIfAborted(signal);
  return await requestUrl(parseHttpUrl(probe.url), probe.method ?? "HEAD", signal);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function hasRecognizedChatResponse(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.choices)) return false;
  return value.choices.some((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message)) return false;
    return choice.message.role === "assistant" && (typeof choice.message.content === "string" || choice.message.content === null);
  });
}

function requestCredentialProbe(credentials: DoctorCredentialsProbe, signal: AbortSignal): Promise<ChatResponseInfo> {
  const url = parseHttpUrl(credentials.url);
  const payload = JSON.stringify({
    model: credentials.model,
    messages: [{ role: "user", content: CREDENTIAL_PROBE_MESSAGE }],
    max_tokens: 1,
    stream: false,
  });
  return new Promise((resolve, reject) => {
    let responseBody = "";
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "POST",
      agent: false,
      signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.apiKey}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
      },
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        responseBody += chunk;
        if (Buffer.byteLength(responseBody) > MAX_CREDENTIAL_RESPONSE_BYTES) {
          response.destroy(new DoctorConfigurationError());
        }
      });
      response.once("error", reject);
      response.once("end", () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(responseBody);
        } catch {
          parsed = undefined;
        }
        resolve({ statusCode, hasRecognizedChatResponse: hasRecognizedChatResponse(parsed) });
      });
    });
    request.once("error", reject);
    request.end(payload);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function checkSystemVersion(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  throwIfAborted(signal);
  const platform = config.runtime?.platform ?? process.platform;
  const systemVersion = config.runtime?.systemVersion ?? defaultSystemVersion();
  if (!systemVersion) {
    return content("unavailable", "未取得宿主系统版本。", "请在桌面主进程中重新检测。");
  }
  const major = Number.parseInt(systemVersion.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major)) {
    return content("unavailable", "系统版本格式无法验证。", "请联系技术同事检查系统信息。");
  }
  if (platform === "darwin") {
    return major >= 12
      ? content("pass", "系统版本符合桌面端要求。", "无需处理。")
      : content("fail", "系统版本过低，Mochi 需要 macOS 12 以上。", "请升级系统或使用兼容设备。");
  }
  if (platform === "win32") {
    return major >= 10
      ? content("pass", "系统版本符合桌面端要求。", "无需处理。")
      : content("fail", "系统版本过低，Mochi 需要 Windows 10 以上。", "请升级系统或使用兼容设备。");
  }
  return content("unavailable", "当前系统尚无桌面端最低版本规则。", "请联系技术同事确认兼容性。");
}

async function checkArchitecture(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  throwIfAborted(signal);
  const expectedArchitecture = config.runtime?.expectedArchitecture;
  if (!expectedArchitecture) {
    return content("unavailable", "未提供安装包目标架构。", "请在安装包元数据接入后重新检测。");
  }
  const actualArchitecture = config.runtime?.arch ?? process.arch;
  return actualArchitecture === expectedArchitecture
    ? content("pass", "系统架构与安装包一致。", "无需处理。")
    : content("fail", "这个安装包不适用于当前电脑。", "请换用对应架构的安装包。");
}

async function checkDiskSpace(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  throwIfAborted(signal);
  try {
    const stats = await fs.statfs(await nearestExistingDirectory(storagePath(config)));
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes < 0) {
      return content("unavailable", "无法读取可验证的磁盘空间。", "请联系技术同事检查磁盘状态。");
    }
    return freeBytes >= DEFAULT_MIN_FREE_BYTES
      ? content("pass", "磁盘可用空间满足要求。", "无需处理。")
      : content("fail", "磁盘空间不足，请至少留出 2 GB。", "清理磁盘空间后重新检测。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("fail", "无法读取磁盘空间。", "请检查磁盘是否可用，或联系技术同事。");
  }
}

async function checkHomeWritable(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  const directory = storagePath(config);
  const probePath = join(directory, `.mochi-doctor-${randomUUID()}`);
  try {
    throwIfAborted(signal);
    await fs.mkdir(directory, { recursive: true });
    throwIfAborted(signal);
    await fs.writeFile(probePath, "ok", { encoding: "utf8", flag: "wx" });
    throwIfAborted(signal);
    await fs.unlink(probePath);
    return content("pass", "用户目录可以写入。", "无需处理。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("fail", "没有用户目录写入权限。", "请更换用户账户或联系管理员。");
  } finally {
    await fs.rm(probePath, { force: true }).catch(() => undefined);
  }
}

function listenLoopback(server: Server, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      server.close();
      reject(new DoctorAbortError());
    };
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", onAbort);
      server.off("error", finish);
      if (error) reject(error);
      else resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    server.once("error", finish);
    server.once("listening", () => finish());
    server.listen(0, "127.0.0.1");
  });
}

function connectLoopback(port: number, signal: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = connect({ host: "127.0.0.1", port });
    const onAbort = () => {
      client.destroy();
      reject(new DoctorAbortError());
    };
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", onAbort);
      client.off("error", finish);
      if (error) reject(error);
      else resolve(client);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    client.once("error", finish);
    client.once("connect", () => finish());
  });
}

async function checkLoopback(signal: AbortSignal): Promise<CheckContent> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => socket.end());
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let client: Socket | null = null;
  try {
    await listenLoopback(server, signal);
    const address = server.address();
    if (!address || typeof address === "string") throw new DoctorConfigurationError();
    client = await connectLoopback(address.port, signal);
    client.end();
    return content("pass", "本机回环网络可用。", "无需处理。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("fail", "本机回环网络异常。", "请检查防火墙或安全软件后重新检测。");
  } finally {
    client?.destroy();
    for (const socket of sockets) socket.destroy();
    await closeServer(server);
  }
}

async function checkSystemTime(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  const reference = config.timeReference;
  if (!reference) {
    return content("unavailable", "未提供可信时间参考，不能验证系统时间。", "连接可信 HTTPS 时间服务后重新检测。");
  }
  let url: URL;
  try {
    url = parseHttpUrl(reference.url);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("unavailable", "时间参考配置无效。", "请配置可信 HTTPS 时间服务后重新检测。");
  }
  if (url.protocol !== "https:") {
    return content("unavailable", "时间参考不是可信 HTTPS 服务，不能验证系统时间。", "请配置可信 HTTPS 时间服务后重新检测。");
  }
  try {
    const response = await requestUrl(url, reference.method ?? "HEAD", signal);
    if (!isHealthyHttpStatus(response.statusCode)) {
      return content("warn", "可信时间参考未返回可用响应。", "请检查网络后重新检测。");
    }
    const referenceTime = response.dateHeader ? Date.parse(response.dateHeader) : Number.NaN;
    if (!Number.isFinite(referenceTime)) {
      return content("unavailable", "时间参考未提供可验证的 Date 响应。", "请更换可信 HTTPS 时间服务后重新检测。");
    }
    const driftMs = Math.abs(Date.now() - referenceTime);
    return driftMs < TIME_DRIFT_WARN_MS
      ? content("pass", "系统时间与 HTTPS 参考一致。", "无需处理。")
      : content("warn", "系统时间可能不准确，可能导致联网失败。", "请开启系统自动同步时间。")
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("warn", "无法连接可信时间参考。", "请检查网络后重新检测。");
  }
}

async function checkModelService(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  if (!config.modelService) {
    return content("unavailable", "未提供模型服务探测配置。", "在设置接入模型服务后重新检测。");
  }
  try {
    const response = await requestProbe(config.modelService, signal);
    return response.statusCode < 500
      ? content("pass", "模型服务已响应。", "无需处理。")
      : content("fail", "模型服务暂时不可用。", "请检查校园网、代理或服务状态。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("fail", "无法连接模型服务。", "请检查校园网、代理或服务状态。");
  }
}

async function checkCredentials(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  const credentials = config.credentials;
  if (!credentials || credentials.apiKey.trim().length === 0 || credentials.model.trim().length === 0) {
    return content("unavailable", "未提供受控凭据探测配置。", "在设置中确认模型密钥后重新检测。");
  }
  try {
    const response = await requestCredentialProbe(credentials, signal);
    if (response.statusCode === 401 || response.statusCode === 402) {
      return content("fail", "模型密钥无效或额度不可用。", "请在设置中更换密钥后重新检测。");
    }
    return response.statusCode >= 200 && response.statusCode < 300 && response.hasRecognizedChatResponse
      ? content("pass", "模型密钥已通过最小验证。", "无需处理。")
      : content("warn", "模型服务返回了未确认的凭据结果。", "请在设置中确认密钥与额度。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("fail", "无法验证模型密钥。", "请检查网络后重新检测。");
  }
}

async function checkCampusService(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  if (!config.campusService) {
    return content("unavailable", "未提供校园服务探测配置。", "配置校园服务后重新检测。");
  }
  try {
    const response = await requestProbe(config.campusService, signal);
    return response.statusCode === 200
      ? content("pass", "校园服务已响应。", "无需处理。")
      : content("warn", "校园服务暂时不可用，其他功能仍可继续使用。", "请稍后重新检测或联系校园技术同事。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("warn", "无法连接校园服务，其他功能仍可继续使用。", "请检查校园网后重新检测。");
  }
}

async function checkSearchEndpoints(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  const probes = config.searchEndpoints;
  if (!probes || probes.length === 0) {
    return content("unavailable", "未提供搜索端点探测配置。", "配置搜索服务后重新检测。");
  }
  try {
    const responses = await Promise.all(probes.map(async (probe) => {
      try {
        return await requestProbe(probe, signal);
      } catch (error) {
        if (isAbortError(error)) throw error;
        return null;
      }
    }));
    return responses.some((response) => response !== null && isHealthyHttpStatus(response.statusCode))
      ? content("pass", "至少一个搜索端点可用。", "无需处理。")
      : content("warn", "搜索端点暂时不可用，搜索功能将降级。", "请检查网络或稍后重新检测。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("warn", "搜索端点暂时不可用，搜索功能将降级。", "请检查网络或稍后重新检测。");
  }
}

async function requestProxy(probe: DoctorProxyProbe, signal: AbortSignal): Promise<HttpResponseInfo> {
  const proxy = parseHttpUrl(probe.proxyUrl);
  const target = parseHttpUrl(probe.targetUrl);
  if (target.protocol !== "http:") throw new DoctorConfigurationError();
  return await requestUrl(proxy, "HEAD", signal, { host: target.host }, target.toString());
}

async function checkProxy(config: DoctorConfig, signal: AbortSignal): Promise<CheckContent> {
  if (!config.proxy) {
    return content("unavailable", "未提供代理探测配置。", "如校园网络使用代理，请在设置中配置后重新检测。");
  }
  try {
    const response = await requestProxy(config.proxy, signal);
    return response.statusCode < 400
      ? content("pass", "代理已响应探测请求。", "无需处理。")
      : content("warn", "代理可能影响联网。", "请检查代理设置或联系网络管理员。");
  } catch (error) {
    if (isAbortError(error)) throw error;
    return content("warn", "代理探测未通过，可能影响联网。", "请检查代理设置或联系网络管理员。");
  }
}

function safeDiagnosticEvents(events: readonly DoctorDiagnosticEvent[] | undefined): DoctorDiagnosticEvent[] {
  if (!events) return [];
  return events
    .filter((event) => event.stage === "web-host" && [
      "WEB_HOST_RUNTIME_MISSING",
      "WEB_HOST_TIMEOUT",
      "WEB_HOST_EXITED",
      "WEB_HOST_START_FAILED",
    ].includes(event.code))
    .slice(-20)
    .map((event) => ({ stage: event.stage, code: event.code }));
}

function overallStatus(checks: readonly DoctorCheckResult[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  if (checks.some((check) => check.status === "unavailable")) return "unavailable";
  return "pass";
}

/**
 * Runs every fixed doctor item concurrently. Network and filesystem probes are
 * best effort: a five-second total budget turns unfinished work into warnings
 * instead of delaying the DSH sidecar startup.
 */
export async function runDoctor(config: DoctorConfig = {}, signal?: AbortSignal): Promise<DoctorRunResult> {
  const startedAt = performance.now();
  const requestedBudgetMs = config.totalBudgetMs ?? DEFAULT_DOCTOR_BUDGET_MS;
  const budgetMs = Number.isFinite(requestedBudgetMs)
    ? Math.max(1, Math.min(requestedBudgetMs, DEFAULT_DOCTOR_BUDGET_MS))
    : DEFAULT_DOCTOR_BUDGET_MS;
  const controller = new AbortController();
  let budgetExpired = false;
  const budgetTimer = setTimeout(() => {
    budgetExpired = true;
    controller.abort();
  }, budgetMs);
  const context: DoctorRunContext = {
    config,
    globalSignal: controller.signal,
    externalSignal: signal,
    didBudgetExpire: () => budgetExpired,
  };
  try {
    const checks = await Promise.all([
      runCheck("system-version", context, (checkSignal) => checkSystemVersion(config, checkSignal)),
      runCheck("architecture", context, (checkSignal) => checkArchitecture(config, checkSignal)),
      runCheck("disk-space", context, (checkSignal) => checkDiskSpace(config, checkSignal)),
      runCheck("home-writable", context, (checkSignal) => checkHomeWritable(config, checkSignal)),
      runCheck("loopback", context, checkLoopback),
      runCheck("system-time", context, (checkSignal) => checkSystemTime(config, checkSignal)),
      runCheck("model-service", context, (checkSignal) => checkModelService(config, checkSignal)),
      runCheck("credentials", context, (checkSignal) => checkCredentials(config, checkSignal)),
      runCheck("campus-service", context, (checkSignal) => checkCampusService(config, checkSignal)),
      runCheck("search-endpoint", context, (checkSignal) => checkSearchEndpoints(config, checkSignal)),
      runCheck("proxy", context, (checkSignal) => checkProxy(config, checkSignal)),
    ]);
    return {
      overallStatus: overallStatus(checks),
      totalDurationMs: elapsedMs(startedAt),
      checks,
      recentDiagnostics: safeDiagnosticEvents(config.diagnosticEvents),
    };
  } finally {
    clearTimeout(budgetTimer);
  }
}

/**
 * Produces the only export intended for a teacher-facing copy/save action.
 * It serializes a fixed whitelist and never serializes endpoints, credentials,
 * raw errors, environment variables, paths, stdout/stderr, or user content.
 */
export function createRedactedDoctorReport(result: DoctorRunResult): string {
  return JSON.stringify({
    format: "mochi-doctor/v1",
    overallStatus: result.overallStatus,
    totalDurationMs: result.totalDurationMs,
    checks: result.checks.map((check) => ({
      id: check.id,
      label: check.label,
      status: check.status,
      message: check.message,
      action: check.action,
      durationMs: check.durationMs,
    })),
    recentDiagnostics: result.recentDiagnostics.map((event) => ({
      stage: event.stage,
      code: event.code,
    })),
  }, null, 2);
}
