import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "electron";

export const CLASSROOM_STARTUP_ARG = "--mochi-classroom-startup";
const ENTRY_NAME = "Mochi Classroom";
const STARTUP_ARGS = ["--role=classroom", CLASSROOM_STARTUP_ARG];

export type ClassroomStartupState = {
  supported: boolean;
  enabled: boolean;
  needsApproval: boolean;
};

type LoginApp = Pick<App, "getLoginItemSettings" | "setLoginItemSettings">;

/** OS state is authoritative; the marker only prevents resetting a later user choice. */
export function createClassroomStartup(
  app: LoginApp,
  options: { platform: string; packaged: boolean; dataPath: string; executable: string },
) {
  const supported = options.packaged && ["darwin", "win32"].includes(options.platform);
  const windows = options.platform === "win32";
  const query = windows ? { path: options.executable, args: STARTUP_ARGS } : {};
  const marker = join(options.dataPath, "classroom-startup.json");
  const remember = () => {
    mkdirSync(options.dataPath, { recursive: true });
    if (!existsSync(marker)) writeFileSync(marker, '{"version":1}\n', { mode: 0o600, flag: "wx" });
  };
  const get = (): ClassroomStartupState => {
    if (!supported) return { supported: false, enabled: false, needsApproval: false };
    const state = app.getLoginItemSettings(query);
    const enabled = state.openAtLogin && (!windows || state.launchItems.some(item =>
      item.name === ENTRY_NAME && item.enabled && item.args.join("\0") === STARTUP_ARGS.join("\0")));
    return { supported: true, enabled, needsApproval: state.status === "requires-approval" };
  };
  const set = (enabled: boolean): ClassroomStartupState => {
    if (!supported) return get();
    app.setLoginItemSettings({
      openAtLogin: enabled,
      ...(windows ? { ...query, name: ENTRY_NAME, enabled } : {}),
    });
    remember();
    return get();
  };
  return {
    get,
    set,
    initialize() { return supported && !existsSync(marker) ? set(true) : get(); },
  };
}
