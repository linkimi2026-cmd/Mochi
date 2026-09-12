#!/usr/bin/env node
/**
 * Boot an isolated official web profile and prove that its standard Agent sees
 * Mochi's seven user-invocable Skills through the real session skill catalog.
 *
 * This test creates its own DSH_HOME, credentials-free environment, probe
 * package and session. It never reads or writes a developer's live DSH home.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const dshBin = process.env.MOCHI_DSH_BIN ?? requireFromDesktop.resolve("@deepseek-ai/dsh/lib/bin.js");
const nodeBin = process.env.MOCHI_DSH_NODE ?? process.execPath;
const expectedSkills = [
  "class-meeting-prep",
  "classroom-deck",
  "mochi",
  "student-follow-up",
  "student-movement-request",
  "teacher-daily-brief",
  "teaching-material-find",
  "weekly-class-report",
];

function redact(value) {
  return value.replace(/token=[^\s]+/gi, "token=[redacted]");
}

function runDsh(args, env, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [dshBin, ...args], {
      cwd: workspaceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-32_768);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`dsh probe timed out after ${timeoutMs}ms\n${redact(output)}`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`dsh probe exited code=${String(code)} signal=${String(signal)}\n${redact(output)}`));
    });
  });
}

function writeProbePackage(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({
    name: "skill-catalog-probe",
    private: true,
    type: "module",
    main: "index.mjs",
  }, null, 2)}\n`);
  writeFileSync(join(dir, "index.mjs"), `
export const name = "skill-catalog-probe";
export const inject = ["agents", "sessionController", "sessionSkillCatalog", "skills", "tools"];

export function apply(ctx) {
  const timer = setTimeout(() => {
    void (async () => {
      let exitCode = 1;
      try {
        const created = await ctx.sessionController.create({
          cwd: process.env.MOCHI_SKILL_PROBE_CWD,
          agentPreset: "standard",
        });
        const catalog = await ctx.sessionSkillCatalog.list(
          { sessionId: created.sessionId },
          new AbortController().signal,
        );
        const agent = ctx.agents.get(created.sessionId);
        const loaded = agent === undefined
          ? undefined
          : await ctx.skills.get("teacher-daily-brief", {
              cwd: process.env.MOCHI_SKILL_PROBE_CWD,
              scope: agent,
            });
        const loadedStudentMovementRequest = agent === undefined
          ? undefined
          : await ctx.skills.get("student-movement-request", {
              cwd: process.env.MOCHI_SKILL_PROBE_CWD,
              scope: agent,
            });
        const result = {
          preset: created.agentPreset,
          names: catalog.skills.map((skill) => skill.name).sort(),
          standardSkillTool: agent !== undefined && ctx.tools.get("skill", agent) !== undefined,
          loadedTeacherDailyBrief: loaded?.name === "teacher-daily-brief",
          loadedStudentMovementRequest:
            loadedStudentMovementRequest?.name === "student-movement-request"
            && loadedStudentMovementRequest.content.includes("jxl_movement_request_create")
            && loadedStudentMovementRequest.content.includes("approval.request"),
        };
        console.log("MOCHI_SKILL_CATALOG=" + JSON.stringify(result));
        exitCode = result.preset === "standard"
          && result.standardSkillTool
          && result.loadedTeacherDailyBrief
          && result.loadedStudentMovementRequest
          ? 0
          : 1;
      } catch (error) {
        console.error("MOCHI_SKILL_CATALOG_ERROR=" + String(error));
      } finally {
        setTimeout(() => process.exit(exitCode), 20);
      }
    })();
  }, 100);
  ctx.effect(() => () => clearTimeout(timer), "skill-catalog-probe timer");
}
`);
}

function writeProfile(home, probeDir) {
  const profileDir = join(home, "profiles", "skill-catalog-probe");
  const nodeModulesDir = join(profileDir, "node_modules");
  mkdirSync(nodeModulesDir, { recursive: true });
  writeFileSync(join(profileDir, "cordis.yml"), "[]\n");
  writeFileSync(join(profileDir, "profile.json"), "{}\n");
  writeFileSync(join(profileDir, "package.json"), `${JSON.stringify({
    name: "mochi-skill-catalog-profile",
    private: true,
    dependencies: {
      "skill-catalog-probe": `link:${probeDir}`,
    },
    dsh: {
      profile: {
        bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
        patchReload: "startup",
      },
    },
  }, null, 2)}\n`);
  symlinkSync(probeDir, join(nodeModulesDir, "skill-catalog-probe"), "dir");
  writeFileSync(join(profileDir, "cordis.patch.yml"), `
- id: skill-filesystem
  disabled: false
  config:
    providerName: filesystem
    includeDefaultRoots: false
    customSkillDirs:
      - ${JSON.stringify(join(workspaceRoot, "skills"))}

- insert:
    - id: skill-catalog-probe
      name: skill-catalog-probe
`);
}

function marker(output) {
  const line = output.split("\n").find((value) => value.startsWith("MOCHI_SKILL_CATALOG="));
  assert.ok(line, `probe did not emit its catalog marker\n${redact(output)}`);
  return JSON.parse(line.slice("MOCHI_SKILL_CATALOG=".length));
}

const templatePath = join(desktopRoot, "resources", "mochi-web", "patches", "core.patch.yml");
const template = readFileSync(templatePath, "utf8");
assert.match(template, /- id: skill-filesystem[\s\S]{0,600}disabled: false/);
assert.match(template, /customSkillDirs:[\s\S]{0,120}__MOCHI_SKILLS_DIR_JSON__/);

const home = mkdtempSync(join(tmpdir(), "mochi-skill-profile-"));
try {
  const probeDir = join(home, "skill-catalog-probe");
  writeProbePackage(probeDir);
  writeProfile(home, probeDir);
  const env = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    HOME: home,
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(home, "agents"),
    DSH_TELEMETRY_DISABLED: "1",
    MOCHI_SKILL_PROBE_CWD: workspaceRoot,
    NO_COLOR: "1",
  };
  const dump = await runDsh(["--profile", "skill-catalog-probe", "--dump-config"], env);
  assert.match(dump, /id: skill-filesystem[\s\S]{0,300}disabled: false/);
  assert.match(dump, /customSkillDirs:[\s\S]{0,200}\/skills/);
  const catalog = marker(await runDsh(["--profile", "skill-catalog-probe", "--port", "0", "--no-open"], env));
  assert.equal(catalog.preset, "standard");
  assert.equal(catalog.standardSkillTool, true);
  assert.equal(catalog.loadedTeacherDailyBrief, true);
  assert.equal(catalog.loadedStudentMovementRequest, true);
  for (const name of expectedSkills) assert.ok(catalog.names.includes(name), `missing skill: ${name}`);
  console.log(`[test-profile-skills] PASS: standard Agent loaded ${expectedSkills.length} Mochi Skills and its native skill tool.`);
} finally {
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
}
