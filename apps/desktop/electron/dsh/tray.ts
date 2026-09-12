import { Menu, Tray, type MenuItemConstructorOptions, type NativeImage } from "electron";

// [Mochi 2026-09-11] WO-7 角色切换只走桌面壳层：网页设置拿不到这条路径。
export type MochiTrayRole = "teacher" | "classroom";

export interface MochiTrayCallbacks {
  open(): void | Promise<void>;
  restart(): void | Promise<void>;
  switchRole(role: MochiTrayRole): void | Promise<void>;
  quit(): void | Promise<void>;
}

export interface MochiTrayOptions extends MochiTrayCallbacks {
  icon: NativeImage;
  /** 当前角色中文名，只用于菜单文案，例如「当前角色：教师办公电脑」。 */
  currentRoleLabel?: string;
}

export interface MochiTrayHandle {
  menu: Menu;
  tray: Tray;
}

let activeTray: MochiTrayHandle | null = null;
let restartPromise: Promise<void> | null = null;

function invoke(callback: () => void | Promise<void>): void {
  void Promise.resolve().then(callback).catch(() => {
    // The lifecycle owner owns user-visible reporting for a failed action.
  });
}

function requestRestart(callback: () => void | Promise<void>): void {
  if (restartPromise !== null) return;
  const run = Promise.resolve().then(callback);
  restartPromise = run;
  void run.then(
    () => {
      if (restartPromise === run) restartPromise = null;
    },
    () => {
      if (restartPromise === run) restartPromise = null;
    },
  );
}

/**
 * [Mochi 2026-09-11] WO-7 角色菜单项：当前角色置灰，另一个角色可点。菜单是
 * 静态模板，角色在托盘存活期内不会变化（切换角色必然重启应用），因此这里
 * 只在构建时按状态设置 `enabled`，不需要在展开时刷新。
 */
function roleMenuItems(
  currentRoleLabel: string,
  switchRole: MochiTrayCallbacks["switchRole"],
): MenuItemConstructorOptions[] {
  return [
    {
      id: "mochi-tray-role-status",
      label: `当前角色：${currentRoleLabel}`,
      enabled: false,
    },
    {
      id: "mochi-tray-switch-teacher",
      label: "切换本机角色：教师办公电脑",
      enabled: currentRoleLabel !== "教师办公电脑",
      click: () => invoke(() => switchRole("teacher")),
    },
    {
      id: "mochi-tray-switch-classroom",
      label: "切换本机角色：教室一体机",
      enabled: currentRoleLabel !== "教室一体机",
      click: () => invoke(() => switchRole("classroom")),
    },
  ];
}

/**
 * Removes the current native tray icon before the application quits. The main
 * process owns the actual window and DSH shutdown sequence through `quit()`.
 */
export function destroyMochiTray(): void {
  const current = activeTray;
  activeTray = null;
  restartPromise = null;
  if (current !== null && !current.tray.isDestroyed()) current.tray.destroy();
}

/**
 * Installs one persistent native tray icon. Callers must supply the current
 * application icon through Electron's `app.getFileIcon()` or another verified
 * non-empty `NativeImage`; this module deliberately does not resolve package
 * paths or construct a second application lifecycle.
 */
export function initializeMochiTray(options: MochiTrayOptions): MochiTrayHandle {
  if (activeTray !== null && !activeTray.tray.isDestroyed()) return activeTray;
  activeTray = null;
  restartPromise = null;
  if (options.icon.isEmpty()) throw new Error("Mochi tray requires a non-empty application icon");

  const currentRoleLabel = options.currentRoleLabel ?? "未设置";
  const tray = new Tray(options.icon);
  try {
    const menu = Menu.buildFromTemplate([
      {
        id: "mochi-tray-open",
        label: "打开",
        click: () => invoke(options.open),
      },
      { type: "separator" },
      ...roleMenuItems(currentRoleLabel, options.switchRole),
      { type: "separator" },
      {
        id: "mochi-tray-restart",
        label: "重启内核",
        click: () => requestRestart(options.restart),
      },
      { type: "separator" },
      {
        id: "mochi-tray-quit",
        label: "退出",
        click: () => {
          destroyMochiTray();
          invoke(options.quit);
        },
      },
    ]);
    tray.setToolTip(`Mochi · ${currentRoleLabel}`);
    tray.setContextMenu(menu);
    activeTray = { tray, menu };
    return activeTray;
  } catch (error) {
    tray.destroy();
    throw error;
  }
}
