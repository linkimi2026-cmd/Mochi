import { randomUUID } from "node:crypto";
import { BrowserWindow, dialog } from "electron";

export function isVerifiedTeacherIdentity(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const user = (value as { user?: Record<string, unknown> }).user;
  return !!user && user.role === "HEAD_TEACHER" && user.mustChangePassword === false
    && (typeof user.id === "number" || typeof user.id === "string");
}

/** Reuse campus login in an ephemeral partition; only the main process grants access. */
export async function verifyTeacherIdentity(campusUrl: string | undefined): Promise<boolean> {
  let origin: string;
  try {
    const url = new URL(campusUrl ?? "");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) return false;
    origin = url.origin;
  } catch { return false; }
  const window = new BrowserWindow({
    width: 880, height: 720, title: "验证教师身份 · Mochi", autoHideMenuBar: true,
    backgroundColor: "#f6f3ec",
    webPreferences: { partition: `mochi-role-verification-${randomUUID()}`, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const isolated = window.webContents.session;
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  window.webContents.on("will-redirect", (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  return new Promise<boolean>((resolve) => {
    let finished = false;
    let checking = false;
    const finish = (allowed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      isolated.webRequest.onCompleted(null);
      if (!window.isDestroyed()) window.destroy();
      void isolated.clearStorageData().catch(() => {});
      resolve(allowed);
    };
    const timeout = setTimeout(() => finish(false), 10 * 60 * 1000);
    window.once("closed", () => finish(false));
    isolated.webRequest.onCompleted({ urls: [`${origin}/api/auth/login`] }, async (request) => {
      if (finished || checking || request.method !== "POST" || request.statusCode !== 200) return;
      checking = true;
      try {
        const response = await isolated.fetch(`${origin}/api/auth/me`, { credentials: "include", headers: { "Cache-Control": "no-store" }, redirect: "error", signal: AbortSignal.timeout(10000) });
        if (finished) return;
        if (response.ok && isVerifiedTeacherIdentity(await response.json())) { finish(true); return; }
        await dialog.showMessageBox(window, { type: "warning", title: "未通过教师身份验证", message: "请使用已完成密码设置的班主任校园账号登录。", buttons: ["知道了"] });
      } catch {
        if (!finished && !window.isDestroyed()) await dialog.showMessageBox(window, { type: "warning", title: "暂时无法验证", message: "无法确认教师身份，请检查网络后重新登录。", buttons: ["知道了"] });
      } finally { checking = false; }
    });
    void window.loadURL(`${origin}/login`).catch((error: unknown) => {
      console.error("[mochi] 教师身份验证页面加载失败", (error as { code?: string })?.code ?? "LOAD_FAILED");
      finish(false);
    });
  });
}
