import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** A reviewed resource manifest selects the physical runtime for every launcher. */
export function packagedModernRuntimeModules(resourcesPath: string): string | null {
  const root = join(resourcesPath, "mochi");
  const marker = join(root, "package-integrity.json");
  if (!existsSync(marker)) return null;
  const manifest = JSON.parse(readFileSync(marker, "utf8"));
  if (!manifest.modernRuntime) return null;
  if (manifest.modernRuntime.coreVersion !== "0.2.0-rc.2") throw new Error("Mochi 内核资源版本尚未适配。");
  const modules = join(root, "node_modules");
  const core = join(modules, "@deepseek-ai", "dsh");
  const metadata = join(core, "package.json");
  if (!existsSync(metadata) || !existsSync(join(core, "lib", "bin.js"))) throw new Error("Mochi 新版内核资源不完整，请重新安装。");
  if (JSON.parse(readFileSync(metadata, "utf8")).version !== manifest.modernRuntime.coreVersion) throw new Error("Mochi 内核与资源清单版本不一致。");
  return modules;
}

export function managedRuntimeNodeModulesPath(packaged: boolean, appPath: string, resourcesPath: string): string {
  if (process.env.MOCHI_RUNTIME_NODE_MODULES) return resolve(process.env.MOCHI_RUNTIME_NODE_MODULES);
  if (packaged) return packagedModernRuntimeModules(resourcesPath) ?? join(resourcesPath, "app.asar.unpacked", "node_modules");
  return join(appPath, "node_modules");
}
