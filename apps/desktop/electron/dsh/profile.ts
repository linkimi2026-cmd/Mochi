import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { app } from "electron";

type RuntimeProfileOptions = {
  homeDir: string;
  resourceRoot: string;
  skillsDir: string;
  workspaceRoot?: string;
  pluginRoot?: string;
};

export type MochiServiceDefaults = {
  campusApiUrl?: string;
  searxngEndpoint?: string;
};

type RuntimeServiceDefaultsOptions = {
  resourceRoot: string;
  environment?: Record<string, string | undefined>;
};

type RuntimeProfileModule = {
  provisionMochiProfiles(options: RuntimeProfileOptions): { homeDir: string };
  resolveServiceDefaults(options: RuntimeServiceDefaultsOptions): MochiServiceDefaults;
};

const requireFromHere = createRequire(__filename);

/**
 * `DSH_HOME` is the explicit Harness override. `MOCHI_RUNTIME_HOME` provides
 * a product-level override for both the shell launcher and Electron. A source
 * checkout defaults to its existing `.mochi-home.nosync`; a packaged app has
 * no workspace and defaults to the user's non-iCloud `~/.mochi-home`.
 */
export function resolveMochiRuntimeHome(): string {
  const explicitHome = process.env.DSH_HOME ?? process.env.MOCHI_RUNTIME_HOME;
  if (explicitHome) return resolve(explicitHome);
  if (app.isPackaged) return join(homedir(), ".mochi-home");
  const workspaceRoot = resolve(process.env.MOCHI_WORKSPACE_ROOT ?? join(app.getAppPath(), "..", ".."));
  return join(workspaceRoot, ".mochi-home.nosync");
}

function resolveRuntimeResourceRoot(): string {
  if (process.env.MOCHI_RUNTIME_RESOURCES) return resolve(process.env.MOCHI_RUNTIME_RESOURCES);
  if (app.isPackaged) return join(process.resourcesPath, "mochi", "profile");
  return join(app.getAppPath(), "resources", "mochi-web");
}

function loadRuntimeProfileModule(resourceRoot: string): RuntimeProfileModule {
  const runtimeScript = join(resourceRoot, "runtime-profile.cjs");
  if (!existsSync(runtimeScript)) {
    throw new Error(`Mochi runtime profile 脚本不存在：${runtimeScript}`);
  }
  return requireFromHere(runtimeScript) as RuntimeProfileModule;
}

/**
 * Resolves only versioned, non-secret service defaults. Explicit process
 * environment values take precedence; absent values remain unconfigured.
 */
export function resolveMochiServiceDefaults(
  environment: Record<string, string | undefined> = process.env,
): MochiServiceDefaults {
  const resourceRoot = resolveRuntimeResourceRoot();
  return loadRuntimeProfileModule(resourceRoot).resolveServiceDefaults({ resourceRoot, environment });
}

/**
 * Rebuilds the reproducible Mochi profiles in the selected Harness home. The
 * versioned source is shared with `mochi.sh`; credentials, sessions, locks,
 * home-level patches and user-owned profile content are outside this operation.
 */
export function prepareDshHome(): string {
  const dshHome = resolveMochiRuntimeHome();
  const resourceRoot = resolveRuntimeResourceRoot();
  const skillsDir = process.env.MOCHI_SKILLS_DIR
    ? resolve(process.env.MOCHI_SKILLS_DIR)
    : app.isPackaged
      ? join(process.resourcesPath, "mochi", "skills")
      : join(app.getAppPath(), "..", "..", "skills");

  const options: RuntimeProfileOptions = {
    homeDir: dshHome,
    resourceRoot,
    skillsDir,
  };
  if (app.isPackaged || process.env.MOCHI_PLUGIN_ROOT) {
    options.pluginRoot = resolve(process.env.MOCHI_PLUGIN_ROOT ?? join(process.resourcesPath, "mochi", "plugins"));
  } else {
    options.workspaceRoot = resolve(process.env.MOCHI_WORKSPACE_ROOT ?? join(app.getAppPath(), "..", ".."));
  }

  loadRuntimeProfileModule(resourceRoot).provisionMochiProfiles(options);
  return dshHome;
}
