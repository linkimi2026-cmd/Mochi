import { app, BrowserWindow, clipboard, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  createRedactedDoctorReport,
  runDoctor,
  type DoctorConfig,
  type DoctorDiagnosticEvent,
  type DoctorRunResult,
  type DoctorStatus,
} from "./doctor";

const DOCTOR_RERUN_URL = "mochi-doctor://rerun";
const DOCTOR_COPY_URL = "mochi-doctor://copy";
const DOCTOR_SAVE_URL = "mochi-doctor://save";
const DOCTOR_FILE_NAME = "Mochi-环境诊断.json";

type DoctorRunner = (config: DoctorConfig, signal?: AbortSignal) => Promise<DoctorRunResult>;

export interface DesktopDoctorConfigInput {
  storagePath: string;
  campusOrigin?: string;
  searxngEndpoint?: string;
  diagnosticEvents?: readonly DoctorDiagnosticEvent[];
}

export interface DoctorWindowController {
  open(): void;
  cancel(): void;
}

export interface DoctorWindowDependencies {
  run?: DoctorRunner;
  chooseSavePath?: (window: BrowserWindow) => Promise<string | undefined>;
  writeClipboard?: (text: string) => void;
  writeReport?: (path: string, text: string) => Promise<void>;
}

interface DoctorWindowOptions {
  createConfig(): DoctorConfig;
  dependencies?: DoctorWindowDependencies;
}

function isHttpUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
    ) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Maps only already-supported, non-secret product settings into Doctor probes.
 * Credential values and campus sessions deliberately remain inside the DSH
 * process, so their validation stays unavailable until a DSH-side bridge exists.
 */
export function createDesktopDoctorConfig(input: DesktopDoctorConfigInput): DoctorConfig {
  const campus = isHttpUrl(input.campusOrigin);
  const searxng = isHttpUrl(input.searxngEndpoint);
  if (campus) {
    // The campus plugin only accepts a bare origin, and the Worker exposes its
    // unauthenticated health contract at this exact path. Do not probe a root
    // SPA response or retain a configured query string in this diagnostic path.
    campus.pathname = "/api/health";
    campus.search = "";
    campus.hash = "";
  }
  if (searxng) {
    // Use the same harmless fixed query shape as mochi-web-search. This avoids
    // treating a bare SearXNG endpoint's query validation response as a pass.
    searxng.searchParams.set("q", "Mochi Doctor");
    searxng.searchParams.set("format", "json");
    searxng.searchParams.set("language", "zh-CN");
  }
  return {
    runtime: {
      platform: process.platform,
      arch: process.arch,
    },
    storage: { path: input.storagePath },
    ...(campus ? { campusService: { url: campus.toString(), method: "GET" as const } } : {}),
    ...(searxng ? { searchEndpoints: [{ url: searxng.toString(), method: "GET" as const }] } : {}),
    ...(input.diagnosticEvents ? { diagnosticEvents: input.diagnosticEvents } : {}),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function statusLabel(status: DoctorStatus): string {
  return {
    pass: "通过",
    warn: "注意",
    fail: "未通过",
    unavailable: "未检测",
  }[status];
}

function doctorPage(result: DoctorRunResult | undefined, notice: string | undefined, running: boolean): string {
  const rows = result?.checks.map((check) => `
    <article class="check" data-check-id="${escapeHtml(check.id)}">
      <div class="check-title"><h2>${escapeHtml(check.label)}</h2><span class="status ${escapeHtml(check.status)}">${escapeHtml(statusLabel(check.status))}</span></div>
      <p>${escapeHtml(check.message)}</p>
      <p class="action">建议：${escapeHtml(check.action)}</p>
      <small>耗时 ${Math.max(0, Math.round(check.durationMs))} ms</small>
    </article>`).join("") ?? "";
  const diagnostics = result?.recentDiagnostics.length
    ? `<p class="diagnostics">最近本地启动诊断：${result.recentDiagnostics.map((event) => escapeHtml(event.code)).join("、")}</p>`
    : "";
  const overview = running
    ? "正在进行环境检测…"
    : result
      ? `本次检测 ${statusLabel(result.overallStatus)}，总耗时 ${Math.max(0, Math.round(result.totalDurationMs))} ms。`
      : "环境检测尚未开始。";
  const actions = result && !running
    ? `<button id="doctor-rerun" type="button">重新检测</button><button id="doctor-copy" class="secondary" type="button">复制脱敏报告</button><button id="doctor-save" class="secondary" type="button">保存脱敏报告</button>`
    : `<button id="doctor-rerun" type="button" disabled>正在检测…</button>`;
  const message = notice ? `<p class="notice">${escapeHtml(notice)}</p>` : "";
  const details = result ? `<section class="checks">${rows}</section>${diagnostics}` : "";
  const html = `<!doctype html><meta charset="utf-8"><title>Mochi 环境诊断</title><style>
    :root{color-scheme:dark}body{margin:0;background:#18211d;color:#edf3ed;font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:860px;margin:auto;padding:30px 24px 42px}h1{margin:0;font-size:25px}.intro{color:#c5d1c4;margin:7px 0 0}.privacy{margin:17px 0;padding:12px 14px;border-radius:12px;background:#24352c;color:#d6e4d3}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}button{border:0;border-radius:10px;background:#d9973e;color:#1b211e;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}button.secondary{background:#ffffff18;color:#edf3ed}button:disabled{opacity:.62;cursor:wait}.notice{padding:10px 12px;border-radius:9px;background:#244b35;color:#d5f0da}.checks{display:grid;gap:10px}.check{border:1px solid #ffffff1c;border-radius:14px;padding:14px 16px;background:#213029}.check-title{display:flex;gap:12px;align-items:center;justify-content:space-between}.check h2{margin:0;font-size:17px}.check p{margin:7px 0}.action{color:#c9d9ca}.check small{color:#a7b8a8}.status{border-radius:999px;padding:3px 9px;font-size:13px;font-weight:700}.status.pass{background:#1f6b42;color:#e6ffef}.status.warn{background:#745318;color:#fff0c3}.status.fail{background:#782f35;color:#ffe9ea}.status.unavailable{background:#485652;color:#e6ece8}.diagnostics{color:#c5d1c4}.footer{margin-top:18px;color:#a7b8a8;font-size:13px}</style>
    <main class="page"><h1>Mochi 环境诊断</h1><p class="intro">${escapeHtml(overview)}</p><p class="privacy">报告只包含检查状态、中文说明、建议和耗时；不会包含密钥、URL、查询参数、原始日志或学生内容。</p>${message}<div class="actions">${actions}</div>${details}<p class="footer">模型密钥仍由 DSH 凭据服务管理。当前窗口不读取凭据文件，完整密钥有效性检测将在受限服务桥接后提供。</p></main><script>
      const go=(target)=>{location.href=target};
      document.getElementById("doctor-rerun")?.addEventListener("click",()=>go(${JSON.stringify(DOCTOR_RERUN_URL)}));
      document.getElementById("doctor-copy")?.addEventListener("click",()=>go(${JSON.stringify(DOCTOR_COPY_URL)}));
      document.getElementById("doctor-save")?.addEventListener("click",()=>go(${JSON.stringify(DOCTOR_SAVE_URL)}));
    </script>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

async function chooseDefaultSavePath(window: BrowserWindow): Promise<string | undefined> {
  const result = await dialog.showSaveDialog(window, {
    title: "保存 Mochi 环境诊断",
    defaultPath: join(app.getPath("documents"), DOCTOR_FILE_NAME),
    filters: [{ name: "JSON 报告", extensions: ["json"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  return result.canceled ? undefined : result.filePath;
}

class NativeDoctorWindow implements DoctorWindowController {
  private window: BrowserWindow | null = null;
  private currentPage: string | null = null;
  private currentResult: DoctorRunResult | undefined;
  private notice: string | undefined;
  private running = false;
  private abort: AbortController | null = null;
  private generation = 0;

  private readonly run: DoctorRunner;
  private readonly chooseSavePath: (window: BrowserWindow) => Promise<string | undefined>;
  private readonly writeClipboard: (text: string) => void;
  private readonly writeReport: (path: string, text: string) => Promise<void>;

  constructor(private readonly options: DoctorWindowOptions) {
    const dependencies = options.dependencies;
    this.run = dependencies?.run ?? runDoctor;
    this.chooseSavePath = dependencies?.chooseSavePath ?? chooseDefaultSavePath;
    this.writeClipboard = dependencies?.writeClipboard ?? ((text) => clipboard.writeText(text));
    this.writeReport = dependencies?.writeReport ?? ((path, text) => fs.writeFile(path, text, "utf8"));
  }

  open(): void {
    if (this.window && !this.window.isDestroyed()) {
      focusWindow(this.window);
      return;
    }
    const window = new BrowserWindow({
      width: 820,
      height: 760,
      minWidth: 640,
      minHeight: 520,
      title: "Mochi 环境诊断",
      backgroundColor: "#18211d",
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = window;
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) window.show();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url === this.currentPage) return;
      const isActiveDoctorPage = this.currentPage !== null && window.webContents.getURL() === this.currentPage;
      if (!isActiveDoctorPage) {
        event.preventDefault();
        return;
      }
      if (url === DOCTOR_RERUN_URL) {
        event.preventDefault();
        void this.runChecks();
        return;
      }
      if (url === DOCTOR_COPY_URL) {
        event.preventDefault();
        void this.copyReport();
        return;
      }
      if (url === DOCTOR_SAVE_URL) {
        event.preventDefault();
        void this.saveReport();
        return;
      }
      event.preventDefault();
    });
    window.on("closed", () => {
      if (this.window !== window) return;
      this.window = null;
      this.currentPage = null;
      this.cancel();
    });
    void this.runChecks();
  }

  cancel(): void {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.running = false;
  }

  private isCurrentWindow(window: BrowserWindow, generation: number): boolean {
    return this.window === window && !window.isDestroyed() && this.generation === generation;
  }

  private async render(): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const page = doctorPage(this.currentResult, this.notice, this.running);
    this.currentPage = page;
    try {
      await window.loadURL(page);
    } catch {
      // The page contains only static local markup. A window being closed while
      // a render is pending is not user-visible failure state.
    }
  }

  private async runChecks(): Promise<void> {
    if (this.running) return;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.running = true;
    this.notice = undefined;
    this.currentResult = undefined;
    await this.render();
    try {
      const result = await this.run(this.options.createConfig(), abort.signal);
      if (!this.isCurrentWindow(window, generation)) return;
      this.currentResult = result;
    } catch {
      if (!this.isCurrentWindow(window, generation)) return;
      this.notice = "环境检测未能完成，可稍后重新检测。";
    } finally {
      if (this.isCurrentWindow(window, generation)) {
        this.abort = null;
        this.running = false;
        await this.render();
      }
    }
  }

  private async copyReport(): Promise<void> {
    if (!this.currentResult || this.running) return;
    try {
      this.writeClipboard(createRedactedDoctorReport(this.currentResult));
      this.notice = "脱敏报告已复制。";
    } catch {
      this.notice = "未能复制报告，请稍后重新尝试。";
    }
    await this.render();
  }

  private async saveReport(): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed() || !this.currentResult || this.running) return;
    const report = createRedactedDoctorReport(this.currentResult);
    try {
      const destination = await this.chooseSavePath(window);
      if (!destination || window.isDestroyed()) return;
      await this.writeReport(destination, report);
      if (this.window === window) this.notice = "脱敏报告已保存。";
    } catch {
      if (this.window === window) this.notice = "未能保存报告，请重新选择位置。";
    }
    if (this.window === window && !window.isDestroyed()) await this.render();
  }
}

export function createDoctorWindowController(options: DoctorWindowOptions): DoctorWindowController {
  return new NativeDoctorWindow(options);
}

export function installDoctorMenu(controller: DoctorWindowController): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Mochi",
      submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
    },
    { role: "editMenu" },
    {
      label: "窗口",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [{
        id: "mochi-doctor-open",
        label: "环境诊断",
        accelerator: "CmdOrCtrl+Shift+D",
        click: () => controller.open(),
      }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
