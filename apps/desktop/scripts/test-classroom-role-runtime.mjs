#!/usr/bin/env node
/**
 * Verifies the classroom role against the real Electron ABI, not the browser
 * UI: its managed profile loads only the classroom preset and cannot expose
 * teacher tools through globally registered product plugins.
 *
 * The LAN plugin is configured in this disposable probe with loopback/port 0
 * and discovery disabled. No campus service, model request, LAN broadcast,
 * credential, or user DSH home is touched.
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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const resourceRoot = join(desktopRoot, "resources", "mochi-web");
const requireFromDesktop = createRequire(join(desktopRoot, "package.json"));
const runtime = requireFromDesktop(join(resourceRoot, "runtime-profile.cjs"));
const electronBin = process.env.MOCHI_CLASSROOM_ELECTRON ?? requireFromDesktop("electron");
const dshBin = process.env.MOCHI_DSH_BIN ?? requireFromDesktop.resolve("@deepseek-ai/dsh/lib/bin.js");
const testRoot = mkdtempSync(join(tmpdir(), "mochi-classroom-role-runtime-"));
const classroomHome = join(testRoot, "classroom-home");
const probeRoot = join(testRoot, "classroom-runtime-probe");
const expectedProfilePlugins = Object.freeze({
  headless: ["mochi-hello", "mochi-llm-mimo", "mochi-knowledge"],
  mochi: ["mochi-hello", "mochi-llm-mimo", "mochi-knowledge", "mochi-approval"],
  "mochi-web": [
    "mochi-hello",
    "mochi-llm-mimo",
    "mochi-knowledge",
    "jxl-theme",
    "jxl-brand",
    "mochi-lan",
    "mochi-lan-client",
  ],
});
const excludedWebPlugins = Object.freeze([
  "mochi-dispatch",
  "mochi-campus",
  "mochi-web-search",
  "mochi-grades",
  "mochi-presentations",
  "mochi-documents",
  "mochi-modeling",
  "mochi-memory",
  "jxl-campus",
  "mochi-model-presets",
  "dsh-better-sidebar",
]);

function redact(value) {
  return String(value).replace(/(?:token|api[_-]?key|authorization)=[^\s]+/gi, "$1=[redacted]");
}

function writeEvidence(result) {
  const requested = process.env.MOCHI_CLASSROOM_ROLE_EVIDENCE_DIR;
  if (requested === undefined) return;
  assert.equal(isAbsolute(requested), true, "MOCHI_CLASSROOM_ROLE_EVIDENCE_DIR must be absolute");
  const outputRoot = resolve(requested);
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

function configuredRow(patch, id) {
  const match = patch.match(new RegExp(`^\\s*- id: ${id}\\n(?:\\s+name: .+\\n)?\\s+config: (.+)$`, "m"));
  assert.ok(match, `profile omitted ${id} configuration`);
  return JSON.parse(match[1]);
}

function writeProbePackage() {
  mkdirSync(join(probeRoot, "node_modules"), { recursive: true });
  symlinkSync(join(desktopRoot, "node_modules", "@deepseek-ai"), join(probeRoot, "node_modules", "@deepseek-ai"), "dir");
  writeFileSync(join(probeRoot, "package.json"), `${JSON.stringify({
    name: "classroom-runtime-probe",
    private: true,
    type: "module",
    main: "index.mjs",
  }, null, 2)}\n`);
  writeFileSync(join(probeRoot, "index.mjs"), [
    'export const name = "classroom-runtime-probe";',
    'export const inject = ["agents", "sessionController", "tools", "mochiLan", "llm"];',
    'export function apply(ctx) {',
    '  setTimeout(() => { void (async () => {',
    '    try {',
    '      const created = await ctx.sessionController.create({',
    '        cwd: process.env.MOCHI_CLASSROOM_PROBE_CWD,',
    '        agentPreset: "classroom",',
    '      });',
    '      const agent = ctx.agents.get(created.sessionId);',
    '      if (agent === undefined) throw new Error("classroom session did not mount an agent");',
    '      const tools = ctx.tools.schemas(agent).map((schema) => schema.name).sort();',
    '      const models = (await ctx.llm.listModels("mochi-mimo")).map((model) => model.id).sort();',
    '      console.log("MOCHI_CLASSROOM_ROLE=" + JSON.stringify({',
    '        selected: created.agentPreset,',
    '        tools,',
    '        lockedRole: ctx.mochiLan.snapshot().lockedRole,',
    '        models,',
    '      }));',
    '      process.exit(0);',
    '    } catch (error) {',
    '      console.error("MOCHI_CLASSROOM_ROLE_ERROR=" + String(error));',
    '      process.exit(1);',
    '    }',
    '  })(); }, 200);',
    '}',
    '',
  ].join("\n"));
}

async function runDsh() {
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(electronBin, ["--expose-internals", dshBin, "--profile", "mochi-web", "--port", "0", "--no-open"], {
      cwd: workspaceRoot,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: classroomHome,
        DSH_HOME: classroomHome,
        DSH_TELEMETRY_DISABLED: "1",
        NO_COLOR: "1",
        ELECTRON_RUN_AS_NODE: "1",
        MOCHI_CLASSROOM_PROBE_CWD: workspaceRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputText = "";
    const append = (chunk) => { outputText = (outputText + chunk.toString()).slice(-24_000); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`classroom runtime probe timed out\n${redact(outputText)}`));
    }, 45_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(outputText);
      else reject(new Error(`classroom runtime probe exited code=${String(code)} signal=${String(signal)}\n${redact(outputText)}`));
    });
  });
  const marker = output.split("\n").find((line) => line.startsWith("MOCHI_CLASSROOM_ROLE="));
  assert.ok(marker, `classroom runtime probe did not emit a result\n${redact(output)}`);
  return JSON.parse(marker.slice("MOCHI_CLASSROOM_ROLE=".length));
}

try {
  assert.equal(existsSync(electronBin), true, `Electron runner is missing: ${electronBin}`);
  assert.equal(existsSync(dshBin), true, `DSH entry is missing: ${dshBin}`);

  const first = runtime.provisionMochiProfiles({
    homeDir: classroomHome,
    resourceRoot,
    skillsDir: join(workspaceRoot, "skills"),
    workspaceRoot,
    runtimeNodeModulesRoot: join(desktopRoot, "node_modules"),
    role: "classroom",
  });
  assert.equal(first.role, "classroom");
  assert.deepEqual(JSON.parse(readFileSync(join(classroomHome, ".mochi-runtime-role.json"), "utf8")), {
    schemaVersion: 1,
    role: "classroom",
  });
  assert.deepEqual(
    runtime.provisionMochiProfiles({
      homeDir: classroomHome,
      resourceRoot,
      skillsDir: join(workspaceRoot, "skills"),
      workspaceRoot,
      runtimeNodeModulesRoot: join(desktopRoot, "node_modules"),
      role: "classroom",
    }).updated,
    [],
    "a classroom provision must be idempotent",
  );
  assert.throws(
    () => runtime.provisionMochiProfiles({
      homeDir: classroomHome,
      resourceRoot,
      skillsDir: join(workspaceRoot, "skills"),
      workspaceRoot,
      runtimeNodeModulesRoot: join(desktopRoot, "node_modules"),
      role: "teacher",
    }),
    /已绑定 classroom 角色/,
    "one runtime home must not switch between classroom and teacher",
  );

  const unboundHome = join(testRoot, "unbound-classroom-home");
  mkdirSync(unboundHome, { recursive: true });
  writeFileSync(join(unboundHome, "existing.txt"), "do not reuse\n");
  assert.throws(
    () => runtime.provisionMochiProfiles({
      homeDir: unboundHome,
      resourceRoot,
      skillsDir: join(workspaceRoot, "skills"),
      workspaceRoot,
      runtimeNodeModulesRoot: join(desktopRoot, "node_modules"),
      role: "classroom",
    }),
    /不能复用已有未绑定/,
    "a classroom role must not claim an existing unbound home",
  );

  for (const [profileName, expectedPlugins] of Object.entries(expectedProfilePlugins)) {
    const profileDir = join(classroomHome, "profiles", profileName);
    const profileManifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(profileManifest.dependencies).sort(), [...expectedPlugins].sort(), `${profileName} role whitelist changed`);
    for (const pluginName of expectedPlugins) {
      assert.equal(existsSync(join(profileDir, "node_modules", pluginName)), true, `${profileName} omitted ${pluginName}`);
    }
    for (const pluginName of excludedWebPlugins) {
      assert.equal(existsSync(join(profileDir, "node_modules", pluginName)), false, `${profileName} retained excluded ${pluginName}`);
    }
  }

  const webPatchPath = join(classroomHome, "profiles", "mochi-web", "cordis.patch.yml");
  const webPatch = readFileSync(webPatchPath, "utf8");
  const presetConfig = configuredRow(webPatch, "agent-presets");
  assert.deepEqual(presetConfig, {
    default: "classroom",
    roots: [{ path: join(resourceRoot, "classroom-agent-presets"), trust: "system" }],
    includeShippedRoot: false,
    includeUserRoot: false,
  });
  const lanConfig = configuredRow(webPatch, "mochi-lan");
  assert.deepEqual(lanConfig, { dataRoot: join(classroomHome, "mochi-lan"), lockedRole: "classroom" });

  writeProbePackage();
  const webProfileDir = join(classroomHome, "profiles", "mochi-web");
  const webManifestPath = join(webProfileDir, "package.json");
  const webManifest = JSON.parse(readFileSync(webManifestPath, "utf8"));
  webManifest.dependencies["classroom-runtime-probe"] = `link:${probeRoot}`;
  writeFileSync(webManifestPath, `${JSON.stringify(webManifest, null, 2)}\n`);
  symlinkSync(probeRoot, join(webProfileDir, "node_modules", "classroom-runtime-probe"), "dir");
  const probeLanConfig = {
    dataRoot: join(classroomHome, "mochi-lan"),
    lockedRole: "classroom",
    bindHost: "127.0.0.1",
    port: 0,
    discoveryEnabled: false,
  };
  const controlledPatch = webPatch.replace(
    `config: ${JSON.stringify(lanConfig)}`,
    `config: ${JSON.stringify(probeLanConfig)}`,
  );
  assert.notEqual(controlledPatch, webPatch, "probe did not replace the LAN network configuration");
  writeFileSync(webPatchPath, `${controlledPatch}\n- insert:\n    - id: classroom-runtime-probe\n      name: classroom-runtime-probe\n`);

  const runtimeResult = await runDsh();
  assert.deepEqual(runtimeResult, {
    selected: "classroom",
    tools: ["mochi_knowledge_page", "mochi_knowledge_page_image", "mochi_knowledge_search"],
    lockedRole: "classroom",
    models: ["mimo-v2.5", "mimo-v2.5-pro"],
  });

  const evidence = {
    schemaVersion: 1,
    result: "passed",
    runner: "Electron RUN_AS_NODE with the installed desktop Electron runtime",
    role: "classroom",
    profilePlugins: expectedProfilePlugins,
    runtime: runtimeResult,
    network: "LAN discovery disabled; loopback port 0; no model request",
  };
  writeEvidence(evidence);
  console.log(`[test-classroom-role-runtime] PASS: classroom role has ${runtimeResult.tools.length} model tools and a locked local LAN service.`);
} finally {
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
}
