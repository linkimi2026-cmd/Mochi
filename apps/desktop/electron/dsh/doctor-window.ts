import { PAPER_WINDOW_CSS } from "./window-theme";
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
const DOCTOR_CLOSE_URL = "mochi-doctor://close";
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

type DoctorNotice = { text: string; error?: boolean };
type ReportAction = "copy" | "save";

function doctorPage(result: DoctorRunResult | undefined, notice: DoctorNotice | undefined, running: boolean, exporting?: ReportAction): string {
  const rows = result?.checks.map((check) => `
    <article class="check" data-check-id="${escapeHtml(check.id)}">
      <div class="check-title"><h2>${escapeHtml(check.label)}</h2><span class="status ${escapeHtml(check.status)}">${escapeHtml(statusLabel(check.status))}</span></div>
      <p>${escapeHtml(check.message)}</p>
      <p class="action">建议：${escapeHtml(check.action)}</p>
      <small>耗时 ${Math.max(0, Math.round(check.durationMs))} ms</small>
    </article>`).join("") ?? "";
  const codes = result?.recentDiagnostics.map(event => event.code) ?? [];
  const recovery = codes.length ? `<section class="recovery" aria-labelledby="recovery-title"><h2 id="recovery-title">最近记录过工作界面启动失败</h2><p>${codes.includes("WEB_HOST_PROFILE_PREPARATION_FAILED") ? "旧配置升级准备未完成；原设置仍保留，请勿删除配置目录。" : "这是一条历史启动记录，环境检查通过并不代表工作界面已经恢复。"}</p><p>如果工作界面仍未打开，请退出 Mochi 后重新打开；仍失败时可复制下方脱敏报告。重新检测只检查环境，不会重启工作界面。</p><small>诊断代码：${codes.map(escapeHtml).join("、")}</small></section>` : "";
  const overview = running ? "正在进行环境检测…" : result
    ? `本次检测 ${statusLabel(result.overallStatus)}，总耗时 ${Math.max(0, Math.round(result.totalDurationMs))} ms。`
    : notice?.error ? "这次环境检测未完成。" : "环境检测尚未开始。";
  const disabled = running || exporting ? " disabled" : "";
  const actions = `<button id="doctor-rerun" type="button"${disabled}>${running ? "正在检测…" : "重新检测"}</button>`
    + (result ? `<button id="doctor-copy" class="secondary" type="button"${disabled}>${exporting === "copy" ? "正在复制…" : "复制脱敏报告"}</button><button id="doctor-save" class="secondary" type="button"${disabled}>${exporting === "save" ? "正在保存…" : "保存脱敏报告"}</button>` : "")
    + `<button id="doctor-close" class="secondary" type="button">关闭</button>`;
  const message = notice ? `<p class="notice${notice.error ? " error" : ""}" role="${notice.error ? "alert" : "status"}" aria-atomic="true">${escapeHtml(notice.text)}</p>` : "";
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mochi 环境诊断</title><style>
    ${PAPER_WINDOW_CSS}body{margin:0;background:var(--paper-canvas);color:var(--paper-ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:860px;margin:auto;padding:30px 24px 42px}h1{margin:0;font-size:25px;line-height:1.2;letter-spacing:-.02em}.intro{color:var(--paper-muted);margin:10px 0 0}.privacy{margin:17px 0;padding:12px 14px;border-radius:12px;background:var(--paper-recess);color:var(--paper-muted)}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}button{border:0;border-radius:10px;background:var(--paper-accent);color:#1b211e;min-height:44px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}button.secondary{background:var(--paper-recess);color:var(--paper-ink)}button:disabled{opacity:.62;cursor:wait}.notice{padding:10px 12px;border-radius:9px;background:var(--paper-recess);color:var(--paper-success)}.notice.error{color:var(--paper-ink);border:1px solid var(--paper-line)}.checks{display:grid;gap:10px}.check,.recovery{border:1px solid var(--paper-line);border-radius:14px;padding:14px 16px;background:var(--paper-surface)}.recovery{margin-top:18px}.recovery h2,.check h2{margin:0;font-size:17px;line-height:1.35}.recovery p,.check p{margin:7px 0}.recovery small{overflow-wrap:anywhere;color:var(--paper-muted)}.check-title{display:flex;gap:12px;align-items:center;justify-content:space-between}.action,.check small{color:var(--paper-muted)}.status{border-radius:999px;padding:3px 9px;font-size:13px;font-weight:700;flex-shrink:0}.status.pass{background:#1f6b42;color:#e6ffef}.status.warn{background:#745318;color:#fff0c3}.status.fail{background:#782f35;color:#ffe9ea}.status.unavailable{background:#485652;color:#e6ece8}.footer{margin-top:18px;color:var(--paper-muted);font-size:13px}@media(max-width:680px){.page{padding:24px 18px 32px}}@media(prefers-contrast:more){.check,.recovery,button{outline:1px solid currentColor}}</style>
    <main class="page" tabindex="-1" aria-labelledby="doctor-title"><h1 id="doctor-title">Mochi 环境诊断</h1><p class="intro" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(overview)}</p>${recovery}<p class="privacy">报告包含检查状态和恢复建议，不含密钥或聊天内容。</p>${message}<div class="actions" aria-busy="${String(Boolean(running || exporting))}">${actions}</div>${result ? `<section class="checks" aria-label="详细检查结果">${rows}</section>` : ""}<p class="footer">“未检测”表示这项检查尚未完成，不代表功能不可用。工作界面恢复后，可到模型设置检查连接。</p></main><script>
      const go=(target)=>{location.href=target};
      document.getElementById("doctor-rerun")?.addEventListener("click",()=>go(${JSON.stringify(DOCTOR_RERUN_URL)}));
      document.getElementById("doctor-copy")?.addEventListener("click",()=>go(${JSON.stringify(DOCTOR_COPY_URL)}));
      document.getElementById("doctor-save")?.addEventListener("click",()=>go(${JSON.stringify(DOCTOR_SAVE_URL)}));
      document.getElementById("doctor-close")?.addEventListener("click",()=>go(${JSON.stringify(DOCTOR_CLOSE_URL)}));
      document.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();go(${JSON.stringify(DOCTOR_CLOSE_URL)})}});
    </script></html>`;
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
  private notice: DoctorNotice | undefined;
  private exporting: ReportAction | undefined;
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
      backgroundColor: "#f6f3ec",
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
      if (url === DOCTOR_CLOSE_URL) {
        event.preventDefault();
        window.close();
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
    this.exporting = undefined;
  }

  private isCurrentWindow(window: BrowserWindow, generation: number): boolean {
    return this.window === window && !window.isDestroyed() && this.generation === generation;
  }

  private async render(focusId?: string): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const page = doctorPage(this.currentResult, this.notice, this.running, this.exporting);
    let scrollY = 0;
    if (this.currentPage && window.webContents.getURL() === this.currentPage) {
      try {
        const state = await window.webContents.executeJavaScript("({focusId:document.activeElement?.id,scrollY:window.scrollY})");
        focusId ??= typeof state?.focusId === "string" ? state.focusId : undefined;
        scrollY = Number.isFinite(state?.scrollY) ? Math.max(0, state.scrollY) : 0;
      } catch { /* A closing renderer has no focus to retain. */ }
    }
    this.currentPage = page;
    try {
      await window.loadURL(page);
      if (this.window !== window || window.isDestroyed() || this.currentPage !== page) return;
      await window.webContents.executeJavaScript(`(()=>{window.scrollTo(0,${scrollY});const wanted=document.getElementById(${JSON.stringify(focusId ?? "doctor-rerun")});(wanted&&!wanted.disabled?wanted:document.querySelector('main')).focus({preventScroll:true})})()`);
    } catch {
      // Closing a local renderer while rendering is not a user-visible error.
    }
  }

  private async runChecks(): Promise<void> {
    if (this.running || this.exporting) return;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.running = true;
    this.notice = undefined;
    this.currentResult = undefined;
    await this.render();
    if (!this.isCurrentWindow(window, generation)) return;
    try {
      const result = await this.run(this.options.createConfig(), abort.signal);
      if (!this.isCurrentWindow(window, generation)) return;
      this.currentResult = result;
    } catch {
      if (!this.isCurrentWindow(window, generation)) return;
      this.notice = { text: "环境检测未能完成。请点“重新检测”再试；本次没有生成可导出的报告。", error: true };
    } finally {
      if (this.isCurrentWindow(window, generation)) {
        this.abort = null;
        this.running = false;
        await this.render();
      }
    }
  }

  private async copyReport(): Promise<void> {
    if (!this.currentResult || this.running || this.exporting) return;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const generation = this.generation;
    this.exporting = "copy";
    this.notice = undefined;
    await this.render("doctor-copy");
    if (!this.isCurrentWindow(window, generation)) return;
    try {
      this.writeClipboard(createRedactedDoctorReport(this.currentResult));
      this.notice = { text: "脱敏报告已复制。" };
    } catch {
      this.notice = { text: "未能复制报告，请稍后重新尝试。", error: true };
    } finally {
      if (this.isCurrentWindow(window, generation)) {
        this.exporting = undefined;
        await this.render("doctor-copy");
      }
    }
  }

  private async saveReport(): Promise<void> {
    const window = this.window;
    if (!window || window.isDestroyed() || !this.currentResult || this.running || this.exporting) return;
    const report = createRedactedDoctorReport(this.currentResult);
    const generation = this.generation;
    this.exporting = "save";
    this.notice = undefined;
    await this.render("doctor-save");
    if (!this.isCurrentWindow(window, generation)) return;
    try {
      const destination = await this.chooseSavePath(window);
      if (!destination || !this.isCurrentWindow(window, generation)) return;
      await this.writeReport(destination, report);
      if (this.window === window) this.notice = { text: "脱敏报告已保存。" };
    } catch {
      if (this.window === window) this.notice = { text: "未能保存报告，请重新选择位置。", error: true };
    } finally {
      if (this.isCurrentWindow(window, generation)) {
        this.exporting = undefined;
        await this.render("doctor-save");
      }
    }
  }

}

export function createDoctorWindowController(options: DoctorWindowOptions): DoctorWindowController {
  return new NativeDoctorWindow(options);
}

export function installDoctorMenu(controller: DoctorWindowController): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Mochi",
      submenu: [{ role: "about", label: "关于 Mochi" }, { type: "separator" }, { role: "quit", label: "退出 Mochi" }],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" },
        { role: "delete", label: "删除" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "窗口",
      submenu: [{ role: "minimize", label: "最小化" }, { role: "zoom", label: "缩放" }, { type: "separator" }, { role: "close", label: "关闭窗口" }],
    },
    {
      role: "help",
      label: "帮助",
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
