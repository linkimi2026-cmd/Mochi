#!/usr/bin/env node
/**
 * Start an isolated official alpha web profile and create one session for each
 * teacher preset. No model, credential, network, student data, or user home is
 * used. The probe prints only preset IDs, expected capability booleans, and
 * exits after cleanup.
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(dirname(scriptDir));
const harnessRoot = process.env.MOCHI_PRESET_HARNESS_ROOT;
assert.ok(harnessRoot, "MOCHI_PRESET_HARNESS_ROOT must name an installed fixed alpha consumer");
const consumerRoot = resolve(harnessRoot);
const shippedPresetRoot = resolve(process.env.MOCHI_SHIPPED_PRESET_ROOT
  ?? join(consumerRoot, "node_modules", "@deepseek-ai", "dsh-agent-presets", "presets"));
const dshBin = join(consumerRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
assert.ok(existsSync(dshBin), "fixed consumer does not contain @deepseek-ai/dsh/lib/bin.js");
assert.ok(existsSync(shippedPresetRoot), "fixed consumer does not contain the shipped preset resource root");

const expected = [
  {
    id: "lesson-planning",
    persona: "备课与课件",
    tools: ["bash", "read", "glob", "grep", "skill", "web_search", "web_fetch"],
    skills: ["class-meeting-prep", "teaching-material-find"],
  },
  {
    id: "materials-assessment",
    persona: "资料与试卷",
    tools: ["bash", "read", "glob", "grep", "skill", "web_search", "web_fetch"],
    skills: ["teaching-material-find"],
  },
  {
    id: "grade-analysis",
    persona: "成绩分析",
    tools: ["bash", "read", "glob", "grep", "skill"],
    skills: [],
  },
  {
    id: "classroom-coordination",
    persona: "班级与教室",
    tools: ["bash", "read", "glob", "grep", "skill"],
    skills: ["teacher-daily-brief", "student-movement-request"],
  },
];

function redact(value) {
  return String(value).replace(/token=[^\s]+/gi, "token=[redacted]");
}

function runDsh(args, env, timeoutMs = 45_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [dshBin, ...args], {
      cwd: workspaceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-48_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("dsh teacher preset probe timed out\n" + redact(output)));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(output);
      else reject(new Error("dsh teacher preset probe exited code=" + String(code)
        + " signal=" + String(signal) + "\n" + redact(output)));
    });
  });
}

function writeProbePackage(dir) {
  mkdirSync(dir, { recursive: true });
  const probeNodeModulesDir = join(dir, "node_modules");
  mkdirSync(probeNodeModulesDir, { recursive: true });
  // Node resolves imports from the linked probe's own directory, not from the
  // adjacent profile directory. Keep this link explicit so the probe always
  // exercises the fixed consumer packages rather than a workspace alias.
  symlinkSync(join(consumerRoot, "node_modules", "@deepseek-ai"), join(probeNodeModulesDir, "@deepseek-ai"), "dir");
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "teacher-preset-runtime-probe",
    private: true,
    type: "module",
    main: "index.mjs",
  }, null, 2) + "\n");
  writeFileSync(join(dir, "index.mjs"), [
    'import { assembleContextFor } from "@deepseek-ai/dsh-agent";',
    'export const name = "teacher-preset-runtime-probe";',
    'export const inject = ["agents", "sessionController", "sessionSkillCatalog", "skills", "tools", "systemPrompt"];',
    'const expected = ' + JSON.stringify(expected) + ';',
    'export function apply(ctx) {',
    '  const timer = setTimeout(() => {',
    '    void (async () => {',
    '      let exitCode = 1;',
    '      try {',
    '        const result = [];',
    '        for (const item of expected) {',
    '          const created = await ctx.sessionController.create({',
    '            cwd: process.env.MOCHI_TEACHER_PRESET_PROBE_CWD,',
    '            agentPreset: item.id,',
    '          });',
    '          const agent = ctx.agents.get(created.sessionId);',
    '          const names = agent === undefined ? [] : ctx.tools.schemas(agent).map((schema) => schema.name);',
    '          const catalog = await ctx.sessionSkillCatalog.list({ sessionId: created.sessionId }, new AbortController().signal);',
    '          const prompt = agent === undefined ? undefined : await ctx.systemPrompt.assemble(assembleContextFor(agent));',
    '          const promptText = JSON.stringify(prompt);',
    '          result.push({',
    '            id: item.id,',
    '            selected: created.agentPreset === item.id,',
    '            tools: item.tools.every((name) => names.includes(name)),',
    '            skills: item.skills.every((name) => catalog.skills.some((skill) => skill.name === name)),',
    '            persona: promptText.includes(item.persona),',
    '          });',
    '        }',
    '        const passed = result.every((item) => item.selected && item.tools && item.skills && item.persona);',
    '        console.log("MOCHI_TEACHER_PRESETS=" + JSON.stringify({ result, passed }));',
    '        exitCode = passed ? 0 : 1;',
    '      } catch (error) {',
    '        console.error("MOCHI_TEACHER_PRESETS_ERROR=" + String(error));',
    '      } finally {',
    '        setTimeout(() => process.exit(exitCode), 20);',
    '      }',
    '    })();',
    '  }, 100);',
    '  ctx.effect(() => () => clearTimeout(timer), "teacher-preset-runtime-probe");',
    '}',
    '',
  ].join("\n"));
}

function writeProfile(home, probeDir) {
  const profileDir = join(home, "profiles", "teacher-preset-runtime-probe");
  const nodeModulesDir = join(profileDir, "node_modules");
  mkdirSync(nodeModulesDir, { recursive: true });
  writeFileSync(join(profileDir, "cordis.yml"), "[]\n");
  writeFileSync(join(profileDir, "profile.json"), "{}\n");
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({
    name: "mochi-teacher-preset-runtime-profile",
    private: true,
    dependencies: {
      "teacher-preset-runtime-probe": "link:" + probeDir,
    },
    dsh: {
      profile: {
        bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
        patchReload: "startup",
      },
    },
  }, null, 2) + "\n");
  symlinkSync(probeDir, join(nodeModulesDir, "teacher-preset-runtime-probe"), "dir");
  symlinkSync(join(consumerRoot, "node_modules", "@deepseek-ai"), join(nodeModulesDir, "@deepseek-ai"), "dir");
  writeFileSync(join(profileDir, "cordis.patch.yml"), [
    "- id: skill-filesystem",
    "  disabled: false",
    "  config:",
    "    providerName: filesystem",
    "    includeDefaultRoots: false",
    "    customSkillDirs:",
    "      - " + JSON.stringify(join(workspaceRoot, "skills")),
    "",
    "- id: agent-presets",
    "  config:",
    "    default: lesson-planning",
    "    roots:",
    "      - path: " + JSON.stringify(scriptDir),
    "        trust: system",
    "      - path: " + JSON.stringify(shippedPresetRoot),
    "        trust: system",
    "    includeShippedRoot: false",
    "    includeUserRoot: true",
    "",
    "- insert:",
    "    - id: teacher-preset-runtime-probe",
    "      name: teacher-preset-runtime-probe",
    "",
  ].join("\n"));
}

function resultMarker(output) {
  const line = output.split("\n").find((value) => value.startsWith("MOCHI_TEACHER_PRESETS="));
  assert.ok(line, "probe did not emit a result marker\n" + redact(output));
  const result = JSON.parse(line.slice("MOCHI_TEACHER_PRESETS=".length));
  assert.equal(result.passed, true);
  assert.equal(result.result.length, expected.length);
  return result;
}

const home = mkdtempSync(join(tmpdir(), "mochi-teacher-preset-runtime-"));
try {
  const probeDir = join(home, "teacher-preset-runtime-probe");
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
    MOCHI_TEACHER_PRESET_PROBE_CWD: workspaceRoot,
    NO_COLOR: "1",
  };
  const result = resultMarker(await runDsh(["--profile", "teacher-preset-runtime-probe", "--port", "0", "--no-open"], env));
  console.log("[teacher-agent-presets] runtime PASS: " + result.result.map((item) => item.id).join(", "));
} finally {
  if (process.env.MOCHI_PRESET_KEEP_RUNTIME === "1") {
    console.log("[teacher-agent-presets] retained runtime fixture: " + home);
  } else if (existsSync(home)) {
    rmSync(home, { recursive: true, force: true });
  }
}
