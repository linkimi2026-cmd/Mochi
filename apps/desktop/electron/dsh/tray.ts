import { Menu, Tray, type NativeImage } from "electron";

export interface MochiTrayCallbacks {
  open(): void | Promise<void>;
  restart(): void | Promise<void>;
  quit(): void | Promise<void>;
}

export interface MochiTrayOptions extends MochiTrayCallbacks {
  icon: NativeImage;
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

  const tray = new Tray(options.icon);
  try {
    const menu = Menu.buildFromTemplate([
      {
        id: "mochi-tray-open",
        label: "打开",
        click: () => invoke(options.open),
      },
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
    tray.setToolTip("Mochi");
    tray.setContextMenu(menu);
    activeTray = { tray, menu };
    return activeTray;
  } catch (error) {
    tray.destroy();
    throw error;
  }
}
