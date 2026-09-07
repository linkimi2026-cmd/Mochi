import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(process.cwd(), "mochi-dev-up.sh");

function writeExecutable(path, source) {
  writeFileSync(path, source, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function setupFixture(responseMode, { withWorkerConfig = true, withEnvFile = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mochi-dev-up-"));
  const bin = join(root, "bin");
  const source = join(root, "campus-source");
  const state = join(root, "state");
  const staticRoot = join(root, "campus-static");
  const logDir = join(root, "logs");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(source, "dist", "jyl_campus_health"), { recursive: true });
  mkdirSync(join(source, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(staticRoot, "assets"), { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  if (withWorkerConfig) {
    writeFileSync(join(source, "dist", "jyl_campus_health", "wrangler.json"), "{}\n");
  }
  if (withEnvFile) {
    writeFileSync(join(source, ".dev.vars"), "TEST_VARIABLE=fixture\n", { mode: 0o600 });
  }
  writeFileSync(join(staticRoot, "assets", "embed.js"), "export {};\n");
  writeFileSync(join(root, "scripts", "campus-paths.cjs"), "// resolved by mock node\n");
  writeFileSync(join(root, "scripts", "run-detached.cjs"), "// mocked by node\n");
  writeExecutable(join(bin, "lsof"), "#!/bin/sh\nexit 1\n");
  writeExecutable(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  writeExecutable(join(bin, "node"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0]?.endsWith('run-detached.cjs')) {
  const logPath = args[args.indexOf('--log') + 1];
  fs.writeFileSync(logPath, '', { mode: 0o600 });
  fs.appendFileSync(process.env.MOCK_LAUNCH_LOG, args.join(' ') + '\\n');
  process.stdout.write('4242\\n');
  process.exit(0);
}
const values = { source: ${JSON.stringify(source)}, state: ${JSON.stringify(state)}, static: ${JSON.stringify(staticRoot)} };
const field = args[args.indexOf('--field') + 1];
if (!values[field]) process.exit(2);
process.stdout.write(values[field]);
`);
  writeExecutable(join(bin, "curl"), `#!${process.execPath}
const url = process.argv.at(-1);
const failed = ${JSON.stringify(responseMode)} === 'api-500' && url.endsWith('/api/health');
process.stdout.write(failed ? '500' : url.endsWith('/api/health') ? '200' : '401');
`);
  return { root, bin, source, state, logDir };
}

function runFixture(responseMode, options) {
  const fixture = setupFixture(responseMode, options);
  const launchLog = join(fixture.root, "launch.log");
  writeFileSync(launchLog, "");
  const result = spawnSync("/bin/zsh", [script], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      MOCHI_WORKSPACE_ROOT: fixture.root,
      MOCHI_NODE_BINARY: join(fixture.bin, "node"),
      MOCHI_DEV_UP_LOG_DIR: fixture.logDir,
      MOCK_LAUNCH_LOG: launchLog,
      PATH: `${fixture.bin}:${process.env.PATH}`,
    },
  });
  return { ...fixture, result, launch: readFileSync(launchLog, "utf8") };
}

const success = runFixture("ready");
try {
  assert.equal(success.result.status, 0, success.result.stderr);
  assert.match(success.result.stdout, /api=200 mochi=401/);
  assert.match(success.result.stdout, /Mochi: http:\/\/127\.0\.0\.1:3090\//);
  assert.doesNotMatch(success.result.stdout, /token=/i);
  assert.match(success.launch, /--config .*campus-source\/dist\/jyl_campus_health\/wrangler\.json/);
  assert.match(success.launch, /--env-file .*campus-source\/\.dev\.vars/);
  assert.match(success.launch, /--persist-to .*state/);
  assert.equal(existsSync(join(success.logDir, "jxl-campus-api.log")), true);
  assert.equal(existsSync(join(success.logDir, "mochi-web-run.log")), true);
  assert.equal(statSync(success.logDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(success.logDir, "jxl-campus-api.log")).mode & 0o777, 0o600);
} finally {
  rmSync(success.root, { recursive: true, force: true });
}

const rejected = runFixture("api-500");
try {
  assert.notEqual(rejected.result.status, 0);
  assert.match(rejected.result.stdout, /api=500 mochi=401/);
  assert.match(rejected.result.stderr, /服务未在 40 秒内就绪/);
  assert.doesNotMatch(`${rejected.result.stdout}\n${rejected.result.stderr}`, /token=/i);
  assert.doesNotMatch(rejected.result.stdout, /── 入口/);
} finally {
  rmSync(rejected.root, { recursive: true, force: true });
}

const missingWorkerConfig = runFixture("ready", { withWorkerConfig: false });
try {
  assert.notEqual(missingWorkerConfig.result.status, 0);
  assert.match(missingWorkerConfig.result.stderr, /缺少校园 Worker 构建配置/);
  assert.match(missingWorkerConfig.result.stderr, /pnpm build/);
  assert.equal(missingWorkerConfig.launch, "");
} finally {
  rmSync(missingWorkerConfig.root, { recursive: true, force: true });
}

const missingEnvFile = runFixture("ready", { withEnvFile: false });
try {
  assert.notEqual(missingEnvFile.result.status, 0);
  assert.match(missingEnvFile.result.stderr, /缺少校园本地变量文件/);
  assert.equal(missingEnvFile.launch, "");
} finally {
  rmSync(missingEnvFile.root, { recursive: true, force: true });
}

console.log("mochi-dev-up readiness contract verified");
