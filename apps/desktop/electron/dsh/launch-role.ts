// [Mochi 2026-09-11] WO-7 角色选择必须可选、可改、可并存
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 本机启动角色（桌面壳层专属）。
 *
 * WO-7 之前的实现只有一个全机单例文件 `mochi-launch.json`：一旦写入就永不
 * 再询问、也不允许修改，导致「装出来直接进教室端、连角色选择都没有」。这里
 * 把角色声明拆成三件事，互相独立：
 *
 * 1. **解析优先级**：启动参数 `--role=<teacher|classroom>` / 环境变量
 *    `MOCHI_RUNTIME_ROLE` > 本机已记录的角色文件 > 由调用方首启询问。
 * 2. **按角色分文件**：`mochi-launch-teacher.json` 与
 *    `mochi-launch-classroom.json`。两个文件可以同时存在，因此同一台机器
 *    既能保留教师端入口，也能保留教室端入口（各自一个快捷方式），不需要
 *    第二个数据目录或第二条单实例锁。
 * 3. **旧文件兼容**：机器上遗留的 `mochi-launch.json` 会被只读识别，并
 *    尽力迁移到新的角色文件名；迁移失败不影响本次启动。
 *
 * 安全边界不放松：这里只识别/记录「本机默认启动哪一端」，两套运行时的数据
 * 目录（`.mochi-home` / `.mochi-classroom-home`）仍由 profile 层各自决定，
 * 教室端不读取教师端的密钥、记忆与会话。网页设置无法触达本模块。
 */

export type MochiRuntimeRole = "teacher" | "classroom";

export const LAUNCH_ROLE_SCHEMA_VERSION = 1;
export const LEGACY_LAUNCH_ROLE_FILENAME = "mochi-launch.json";
export const LAUNCH_ROLE_ENV = "MOCHI_RUNTIME_ROLE";
export const LAUNCH_ROLE_ARG_PREFIX = "--role=";

export const MOCHI_RUNTIME_ROLES: readonly MochiRuntimeRole[] = ["teacher", "classroom"];

// [Mochi 2026-09-11] WO-7 托盘菜单与首启对话框共用同一份角色文案，避免两处
// 写成不同的中文导致用户以为点了另一个东西。
const ROLE_LABELS: Record<MochiRuntimeRole, string> = {
  teacher: "教师办公电脑",
  classroom: "教室一体机",
};

const LAUNCH_ROLE_FILENAMES: Record<MochiRuntimeRole, string> = {
  teacher: "mochi-launch-teacher.json",
  classroom: "mochi-launch-classroom.json",
};

export function launchRoleLabel(role: MochiRuntimeRole): string {
  return ROLE_LABELS[role];
}

export function isMochiRuntimeRole(value: unknown): value is MochiRuntimeRole {
  return value === "teacher" || value === "classroom";
}

export class LaunchRoleError extends Error {
  constructor(message = "Mochi 本机角色信息无法使用") {
    super(message);
    this.name = "LaunchRoleError";
  }
}

export function launchRolePathFor(userDataDir: string, role: MochiRuntimeRole): string {
  return join(userDataDir, LAUNCH_ROLE_FILENAMES[role]);
}

export function legacyLaunchRolePathFor(userDataDir: string): string {
  return join(userDataDir, LEGACY_LAUNCH_ROLE_FILENAME);
}

/**
 * `--role=` 启动参数优先于环境变量，两者都只接受完整角色名。无法识别的值
 * 视为「没有指定」而不是报错：桌面快捷方式里残留的错误参数不应该让应用
 * 变成一台打不开的机器，回落到已记录角色或首启询问即可。
 */
export function resolveRequestedRole(
  argv: readonly string[],
  environment: Record<string, string | undefined>,
): MochiRuntimeRole | null {
  let argument: string | null = null;
  for (const value of argv) {
    if (typeof value === "string" && value.startsWith(LAUNCH_ROLE_ARG_PREFIX)) {
      argument = value.slice(LAUNCH_ROLE_ARG_PREFIX.length).trim();
    }
  }
  if (isMochiRuntimeRole(argument)) return argument;

  const fromEnvironment = environment[LAUNCH_ROLE_ENV];
  if (typeof fromEnvironment === "string" && isMochiRuntimeRole(fromEnvironment.trim())) {
    return fromEnvironment.trim() as MochiRuntimeRole;
  }
  return null;
}

function readRoleFile(path: string): MochiRuntimeRole | null {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new LaunchRoleError();
  }
  // 符号链接与目录都不是我们写下的文件，宁可拒绝也不跟随。
  if (!stat.isFile() || stat.isSymbolicLink()) throw new LaunchRoleError();

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new LaunchRoleError();
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new LaunchRoleError();
  const record = value as Record<string, unknown>;
  // 字段集合与 schemaVersion 同时校验：多写的字段说明文件被改过，不认。
  if (Object.keys(record).length !== 2 || record.schemaVersion !== LAUNCH_ROLE_SCHEMA_VERSION) {
    throw new LaunchRoleError();
  }
  if (!isMochiRuntimeRole(record.role)) throw new LaunchRoleError();
  return record.role;
}

function writeRoleFile(path: string, role: MochiRuntimeRole): void {
  const content = `${JSON.stringify({ schemaVersion: LAUNCH_ROLE_SCHEMA_VERSION, role }, null, 2)}\n`;
  try {
    // 直接原地覆盖：这个文件表达的是「本机默认启动角色」，可重选是产品的
    // 明确要求。不做原子发布是因为它不承载不可重建的状态，损坏时用户可以
    // 重新选择，而多一步硬链接反而会在切换场景留下半成品路径。
    writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  } catch {
    throw new LaunchRoleError();
  }
  if (readRoleFile(path) !== role) throw new LaunchRoleError();
}

function writeRoleFileIfAbsent(path: string, role: MochiRuntimeRole): void {
  try {
    writeRoleFile(path, role);
  } catch {
    // 同名文件已存在且内容不同、或被拒绝读取，都只影响迁移，不影响启动。
  }
}

/**
 * 兼容 WO-7 之前的单文件布局。旧文件内容合法时返回其中的角色，并尽力把它
 * 迁移成新的角色文件名；旧文件保持不变，避免迁移过程中丢掉用户状态。
 * 返回 `migrated` 表示新布局已经能独立表达这个角色，可以清理旧文件。
 */
function readLegacyLaunchRole(
  userDataDir: string,
  declared: ReadonlySet<MochiRuntimeRole>,
): { role: MochiRuntimeRole; migrated: boolean } | null {
  const legacyPath = legacyLaunchRolePathFor(userDataDir);
  let legacy: MochiRuntimeRole | null;
  try {
    legacy = readRoleFile(legacyPath);
  } catch {
    return null;
  }
  if (legacy === null) return null;
  if (declared.has(legacy)) return { role: legacy, migrated: true };
  if (declared.size > 0) {
    // 这台机器已经用新布局选了另一个角色，旧文件只是升级残留：保留它会让
    // 「切回教室端」被旧内容反复覆盖，因此按用户的新选择为准。
    return { role: legacy, migrated: false };
  }
  writeRoleFileIfAbsent(launchRolePathFor(userDataDir, legacy), legacy);
  return { role: legacy, migrated: true };
}

function discardLegacyLaunchRoleFile(userDataDir: string): void {
  try {
    rmSync(legacyLaunchRolePathFor(userDataDir), { force: true });
  } catch {
    // 清理失败只留下一个不再被读取的文件。
  }
}

/**
 * 读取这台机器已经记录的角色。返回 `null` 表示没有任何可信记录，调用方
 * 应当弹出首次启动的角色选择框（或按默认角色启动）。
 */
export function resolveLaunchRole(
  userDataDir: string,
  requested: MochiRuntimeRole | null = null,
): MochiRuntimeRole | null {
  if (requested !== null) return requested;

  const declared = new Set<MochiRuntimeRole>();
  for (const role of MOCHI_RUNTIME_ROLES) {
    const recorded = readRoleFile(launchRolePathFor(userDataDir, role));
    if (recorded !== null) {
      declared.add(recorded);
      // 文件名与内容不一致说明被手工改过：以内容为准并修正文件名。
      if (recorded !== role) writeRoleFileIfAbsent(launchRolePathFor(userDataDir, recorded), recorded);
    }
  }

  const legacy = readLegacyLaunchRole(userDataDir, declared);
  if (legacy !== null && legacy.migrated) discardLegacyLaunchRoleFile(userDataDir);
  if (legacy !== null && declared.size === 0 && legacy.migrated) return legacy.role;
  if (declared.size === 0) return null;
  // 两个角色文件同时存在时，teacher 是产品主用户，默认进教师端。
  return declared.has("teacher") ? "teacher" : "classroom";
}

/**
 * 记录本机默认启动角色。切换角色只是改写这一行声明，**不删除任何数据**：
 * 两套 home 各自独立，切回来时内容原样还在。
 */
export function persistLaunchRole(userDataDir: string, role: MochiRuntimeRole): void {
  mkdirSync(userDataDir, { recursive: true });
  writeRoleFile(launchRolePathFor(userDataDir, role), role);
}

/** 列出这台机器上已经存在的角色入口，用于「切换本机角色」的确认文案。 */
export function listLaunchRoles(userDataDir: string): MochiRuntimeRole[] {
  const roles: MochiRuntimeRole[] = [];
  for (const role of MOCHI_RUNTIME_ROLES) {
    try {
      if (readRoleFile(launchRolePathFor(userDataDir, role)) !== null) roles.push(role);
    } catch {
      // 不可读的角色文件不作为一个可切换的入口。
    }
  }
  return roles;
}

/**
 * 启动早期调用一次：把磁盘上遗留的旧单文件布局收敛到分文件布局，然后清掉
 * 旧文件。旧文件只有在新布局尚未选择角色、或它记录的角色与新布局一致时才
 * 会被补写进去；如果这台机器已经用新布局选了另一个角色，就以新选择为准，
 * 旧文件只作为升级残留清理掉。全程只读校验，不做任何数据删除。
 */
export function adoptLegacyLaunchRole(userDataDir: string): void {
  const legacyPath = legacyLaunchRolePathFor(userDataDir);
  let legacy: MochiRuntimeRole | null;
  try {
    legacy = readRoleFile(legacyPath);
  } catch {
    return;
  }
  if (legacy === null) return;

  const declared = new Set<MochiRuntimeRole>();
  for (const role of MOCHI_RUNTIME_ROLES) {
    try {
      if (readRoleFile(launchRolePathFor(userDataDir, role)) !== null) declared.add(role);
    } catch {
      // 已有但不可读的角色文件不参与迁移判断。
    }
  }

  if (declared.size === 0 || declared.has(legacy)) {
    writeRoleFileIfAbsent(launchRolePathFor(userDataDir, legacy), legacy);
  }
  discardLegacyLaunchRoleFile(userDataDir);
}

// 允许打包/调试脚本在没有窗口的情况下直接跑一遍角色解析。
export function launchRoleFilenames(): Record<MochiRuntimeRole, string> {
  return { ...LAUNCH_ROLE_FILENAMES };
}
