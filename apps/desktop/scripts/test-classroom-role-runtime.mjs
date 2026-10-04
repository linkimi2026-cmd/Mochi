#!/usr/bin/env node
/**
 * Verifies the classroom role against the real Electron ABI, not the browser
 * UI: its managed profile loads only the classroom preset and cannot expose
 * teacher tools through globally registered product plugins.
 *
 * The LAN plugin is configured in this disposable probe with loopback/port 0
 * and discovery disabled. Its first selected MiMo route is exercised against
 * an in-process fake gateway with a fixture-only key; no real service, key,
 * LAN broadcast, or user DSH home is touched.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
const fixtureKey = "fixture-classroom-role-key-never-a-real-secret";
const expectedProfilePlugins = Object.freeze({
  headless: ["mochi-hello", "mochi-llm-mimo", "mochi-knowledge"],
  mochi: ["mochi-hello", "mochi-llm-mimo", "mochi-knowledge", "mochi-approval"],
  "mochi-web": [
    "mochi-hello",
    "mochi-llm-mimo",
    "mochi-knowledge",
    "jxl-theme",
    "jxl-brand",
    "mochi-model-presets",
    "mochi-lan",
    "mochi-lan-client",
    "mochi-approval",
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
    'export const inject = ["agents", "sessionController", "tools", "mochiLan", "llm", "agentDefaultModel"];',
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
    '      const backgroundResult = await ctx.tools.execute({ callId: "probe-background", name: "mochi_set_campus_background", arguments: { background: "campus-route" }, agent, signal: new AbortController().signal });',
    '      if (backgroundResult.isError || backgroundResult.value?.background !== "campus-route") throw new Error("classroom background tool did not commit");',
    '      const models = (await ctx.llm.listModels("mochi-mimo")).map((model) => model.id).sort();',
    '      const defaultModel = ctx.agentDefaultModel.currentSelection();',
    '      for await (const _chunk of ctx.llm.stream({',
    '        provider: defaultModel.provider,',
    '        model: defaultModel.model,',
    '        messages: [{ role: "user", content: [{ type: "text", text: "fixture route probe" }] }],',
    '      })) {}',
    '      console.log("MOCHI_CLASSROOM_ROLE=" + JSON.stringify({',
    '        selected: created.agentPreset,',
    '        tools,',
    '        backgroundChanged: true,',
    '        lockedRole: ctx.mochiLan.snapshot().lockedRole,',
    '        models,',
    '        defaultModel,',
    '        firstRequest: "completed",',
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
        MIMO_API_KEY: fixtureKey,
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
  const fakeGatewayRequests = [];
  const fakeGateway = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      fakeGatewayRequests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"choices":[{"index":0,"delta":{"content":"fixture"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((resolvePromise, reject) => {
    fakeGateway.once("error", reject);
    fakeGateway.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = fakeGateway.address();
  assert.ok(address && typeof address === "object");
  let runtimeResult;
  try {
    const fakeGatewayURL = `http://127.0.0.1:${address.port}/v1`;
    const runtimeManifest = JSON.parse(readFileSync(join(resourceRoot, "runtime-profile.json"), "utf8"));
    const mimoDefaults = runtimeManifest.plugins["mochi-llm-mimo"].initialConfig;
    const localMimoConfig = { ...mimoDefaults, baseURL: fakeGatewayURL };
    const mimoConfigJson = JSON.stringify(mimoDefaults);
    assert.ok(controlledPatch.includes(`config: ${mimoConfigJson}`), "probe did not find the seeded MiMo configuration");
    const localPatch = controlledPatch.replace(`config: ${mimoConfigJson}`, `config: ${JSON.stringify(localMimoConfig)}`);
    assert.notEqual(localPatch, controlledPatch, "probe did not redirect MiMo to its local fake gateway");
    writeFileSync(webPatchPath, `${localPatch}\n- insert:\n    - id: classroom-runtime-probe\n      name: classroom-runtime-probe\n`);
    runtimeResult = await runDsh();
  } finally {
    await new Promise((resolvePromise) => fakeGateway.close(resolvePromise));
  }
  assert.deepEqual(runtimeResult, {
    selected: "classroom",
    tools: [
      "mochi_knowledge_page",
      "mochi_knowledge_page_image",
      "mochi_knowledge_search",
      "mochi_lan_configure_identity",
      "mochi_lan_decide_pairing",
      "mochi_lan_send_student_request",
      "mochi_lan_status",
      "mochi_set_campus_background",
    ],
    backgroundChanged: true,
    lockedRole: "classroom",
    models: ["mimo-v2.5", "mimo-v2.5-pro"],
    defaultModel: { provider: "mochi-mimo", model: "mimo-v2.5" },
    firstRequest: "completed",
  });
  assert.equal(fakeGatewayRequests.length, 1, "the selected default route must make exactly one model request");
  const [firstRequest] = fakeGatewayRequests;
  assert.equal(firstRequest.method, "POST");
  assert.equal(firstRequest.url, "/v1/chat/completions");
  assert.ok(firstRequest.authorization === `Bearer ${fixtureKey}`, "the first route request must use only the fixture credential");
  assert.equal(JSON.parse(firstRequest.body).model, runtimeResult.defaultModel.model);

  const evidence = {
    schemaVersion: 1,
    result: "passed",
    runner: "Electron RUN_AS_NODE with the installed desktop Electron runtime",
    role: "classroom",
    profilePlugins: expectedProfilePlugins,
    runtime: runtimeResult,
    network: "LAN discovery disabled; loopback port 0; first MiMo request served by in-process fixture gateway",
  };
  writeEvidence(evidence);
  console.log(`[test-classroom-role-runtime] PASS: classroom role has ${runtimeResult.tools.length} model tools, a locked local LAN service, and a fixture-only first MiMo request.`);
} finally {
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
}
