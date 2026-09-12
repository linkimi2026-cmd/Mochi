#!/usr/bin/env node
/**
 * [Mochi 2026-09-11] WO-7 本机角色解析的纯 Node 单元测试。
 *
 * 覆盖工单要求的三件事：按角色分文件（一台机器可同时保留两个入口）、
 * `--role=` / `MOCHI_RUNTIME_ROLE` 启动覆盖、以及旧 `mochi-launch.json`
 * 的识别与迁移。不启动 Electron、不读真实 Mochi home、不接触任何凭据。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const roles = requireFromDesktop(join(desktopRoot, "dist-electron", "dsh", "launch-role.js"));

const TEACHER_FILE = "mochi-launch-teacher.json";
const CLASSROOM_FILE = "mochi-launch-classroom.json";
const LEGACY_FILE = "mochi-launch.json";
const root = mkdtempSync(join(tmpdir(), "mochi-launch-role-"));
let caseIndex = 0;

function newDir() {
  caseIndex += 1;
  const directory = join(root, `case-${caseIndex}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function writeRoleFile(directory, filename, content) {
  writeFileSync(join(directory, filename), content, { encoding: "utf8" });
}

try {
  for (const source of ["launch-role.ts"]) {
    assert.equal(existsSync(join(desktopRoot, "electron", "dsh", source)), true, `${source} must exist`);
  }

  // 1) 全新机器：没有任何记录 → 调用方应当弹首启对话框（返回 null）。
  {
    const directory = newDir();
    assert.equal(roles.resolveLaunchRole(directory), null, "a fresh machine must ask for the role");
    assert.deepEqual(roles.listLaunchRoles(directory), [], "a fresh machine must have no role entries");
  }

  // 2) 显式启动参数/环境变量优先，并且不要求磁盘上已有任何文件。
  {
    assert.equal(roles.resolveRequestedRole(["--role=classroom"], {}), "classroom");
    assert.equal(roles.resolveRequestedRole([], { MOCHI_RUNTIME_ROLE: "teacher" }), "teacher");
    assert.equal(
      roles.resolveRequestedRole(["--role=classroom"], { MOCHI_RUNTIME_ROLE: "teacher" }),
      "classroom",
      "the explicit argument must win over the environment",
    );
    assert.equal(roles.resolveRequestedRole(["--role="], { MOCHI_RUNTIME_ROLE: "teacher" }), "teacher");
    assert.equal(roles.resolveRequestedRole(["--role=nonsense"], {}), null, "an unknown role is not a request");
    assert.equal(roles.resolveRequestedRole([], { MOCHI_RUNTIME_ROLE: "TEACHER" }), null, "roles are exact lowercase");
  }

  // 2b) 显式启动参数只影响本次进程，不能悄悄改掉本机记录。
  {
    const directory = newDir();
    assert.equal(roles.resolveLaunchRole(directory, "classroom"), "classroom");
    assert.equal(existsSync(join(directory, CLASSROOM_FILE)), false, "an explicit launch role must not write a file");
  }

  // 3) 首启写入的是角色分文件，两次写不同角色互不覆盖 → 两个入口可并存。
  {
    const directory = newDir();
    roles.persistLaunchRole(directory, "teacher");
    assert.equal(existsSync(join(directory, TEACHER_FILE)), true);
    assert.equal(existsSync(join(directory, CLASSROOM_FILE)), false);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, TEACHER_FILE), "utf8")), {
      schemaVersion: 1,
      role: "teacher",
    });

    roles.persistLaunchRole(directory, "classroom");
    assert.equal(existsSync(join(directory, CLASSROOM_FILE)), true, "switching must keep the teacher entry");
    assert.equal(existsSync(join(directory, TEACHER_FILE)), true, "the previous role entry must survive a switch");
    // 两个文件都在时，教师端是主用户，无参数启动默认进教师端。
    assert.equal(roles.resolveLaunchRole(directory), "teacher", "teacher must win when both entries exist");

    // 切回教师端只是改写声明，教室端入口仍在。
    roles.persistLaunchRole(directory, "teacher");
    assert.equal(roles.resolveLaunchRole(directory), "teacher");
    assert.deepEqual(roles.listLaunchRoles(directory).sort(), ["classroom", "teacher"]);
  }

  // 4) 只有教室端入口时无参数启动进教室端（一台机器可只装教室端）。
  {
    const directory = newDir();
    roles.persistLaunchRole(directory, "classroom");
    assert.equal(roles.resolveLaunchRole(directory), "classroom");
    assert.deepEqual(roles.listLaunchRoles(directory), ["classroom"]);
  }

  // 5) 旧单文件布局：识别 + 迁移到新文件名，本次启动结果不变。
  {
    const directory = newDir();
    writeRoleFile(directory, LEGACY_FILE, `${JSON.stringify({ schemaVersion: 1, role: "classroom" })}\n`);
    assert.equal(roles.resolveLaunchRole(directory), "classroom", "the legacy file must still be recognized");
    assert.equal(existsSync(join(directory, CLASSROOM_FILE)), true, "the legacy role must be migrated to its file");
    assert.equal(existsSync(join(directory, LEGACY_FILE)), false, "the migrated legacy file must be cleaned up");

    // 迁移后显式切换回教师端：两个入口都在，旧文件不能再把启动拉回教室端。
    roles.persistLaunchRole(directory, "teacher");
    roles.adoptLegacyLaunchRole(directory);
    assert.equal(roles.resolveLaunchRole(directory), "teacher", "a later switch must not be reverted");
    assert.equal(existsSync(join(directory, CLASSROOM_FILE)), true, "the classroom entry must survive the switch");
  }

  // 6) 旧布局 + 新布局同时存在时，用户的新选择优先；启动迁移会清掉旧文件。
  {
    const directory = newDir();
    roles.persistLaunchRole(directory, "teacher");
    writeRoleFile(directory, LEGACY_FILE, `${JSON.stringify({ schemaVersion: 1, role: "classroom" })}\n`);
    assert.equal(roles.resolveLaunchRole(directory), "teacher", "the current layout must win over the legacy file");
    roles.adoptLegacyLaunchRole(directory);
    assert.equal(existsSync(join(directory, LEGACY_FILE)), false, "the stale legacy file must be cleaned up on startup");
    assert.equal(existsSync(join(directory, CLASSROOM_FILE)), false, "the stale legacy role must not create an entry");
    // 清掉之后，重复调用仍然稳定在教师端。
    assert.equal(roles.resolveLaunchRole(directory), "teacher");
  }

  // 7) 不可信内容一律拒绝：不猜、不降级、不把损坏文件当默认角色。
  {
    const directory = newDir();
    const invalidContents = [
      "{",
      "[]",
      "\"teacher\"",
      JSON.stringify({ schemaVersion: 1 }),
      JSON.stringify({ schemaVersion: 1, role: "teacher", extra: true }),
      JSON.stringify({ schemaVersion: 2, role: "teacher" }),
      JSON.stringify({ schemaVersion: 1, role: "admin" }),
    ];
    for (const [index, content] of invalidContents.entries()) {
      writeRoleFile(directory, TEACHER_FILE, content);
      assert.throws(
        () => roles.resolveLaunchRole(directory),
        roles.LaunchRoleError,
        `invalid role file #${index} must be rejected`,
      );
      rmSync(join(directory, TEACHER_FILE), { force: true });
    }
  }

  // 8) 符号链接不是我们写下的文件，拒绝跟随。
  {
    const directory = newDir();
    const target = join(directory, "elsewhere.json");
    writeFileSync(target, `${JSON.stringify({ schemaVersion: 1, role: "teacher" })}\n`, "utf8");
    symlinkSync(target, join(directory, TEACHER_FILE));
    assert.throws(() => roles.resolveLaunchRole(directory), roles.LaunchRoleError, "symlinked role files must be refused");
  }

  // 9) 迁移在目标文件已存在时绝不覆盖（并发/重复迁移都是安全的）。
  {
    const directory = newDir();
    roles.persistLaunchRole(directory, "teacher");
    roles.adoptLegacyLaunchRole(directory);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, TEACHER_FILE), "utf8")), {
      schemaVersion: 1,
      role: "teacher",
    });
    assert.equal(roles.launchRoleLabel("teacher"), "教师办公电脑");
    assert.equal(roles.launchRoleLabel("classroom"), "教室一体机");
    assert.deepEqual(roles.launchRoleFilenames(), { teacher: TEACHER_FILE, classroom: CLASSROOM_FILE });
  }

  console.log("[test-launch-role] PASS: per-role files coexist, launch overrides win, legacy files migrate, and tampered files are rejected.");
} finally {
  // 临时目录只用于本测试，但受限环境里的批量删除守卫可能拒绝清理；清理失败
  // 不应该把已经通过的断言变成一次失败。
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // 系统回收 /var/folders 下的临时目录。
  }
}
