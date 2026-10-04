import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, parseDocument } from "yaml";

/** Seed only an unset preference; an explicit user opt-out always wins. */
export function seedSidebarDefaults(homeDir: string): boolean {
  const profilePath = join(homeDir, "profiles", "mochi-web", "package.json");
  if (existsSync(profilePath)) {
    const profile = JSON.parse(readFileSync(profilePath, "utf8"));
    // The candidate's official bundle and Config forms own defaults/imports.
    // Do not recreate a retired settings.yaml after upstream has imported it.
    if (profile.dsh?.profile?.bundles?.includes("dsh-better-sidebar")) return false;
  }
  const path = join(homeDir, "settings.yaml");
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  const document = parseDocument(source);
  if (document.errors.length || (document.contents !== null && !isMap(document.contents))) {
    throw new Error("设置文件格式无效，未修改侧边栏偏好");
  }
  const namespace = "dsh-better-sidebar";
  const section = document.get(namespace, true);
  if (section !== undefined && !isMap(section)) throw new Error("侧边栏设置格式无效，未修改已有内容");
  if (document.hasIn([namespace, "agentOpenTools"])) return false;
  document.setIn([namespace, "agentOpenTools"], true);
  mkdirSync(homeDir, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, document.toString(), { mode: 0o600 });
  renameSync(temporary, path);
  return true;
}
