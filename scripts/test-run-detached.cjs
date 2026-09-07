const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const root = mkdtempSync(join(tmpdir(), "mochi-detached-launcher-"));
const logPath = join(root, "child.log");
const launcher = join(process.cwd(), "scripts", "run-detached.cjs");
let pid;
try {
  pid = Number(execFileSync(process.execPath, [
    launcher,
    "--log", logPath,
    "--",
    process.execPath,
    "-e", "setInterval(() => {}, 1000)",
  ], { encoding: "utf8" }).trim());
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.equal(existsSync(logPath), true);
  assert.equal(statSync(logPath).mode & 0o777, 0o600);
  process.kill(pid, 0);
  process.kill(pid, "SIGTERM");
  let exited = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      process.kill(pid, 0);
      execFileSync("/bin/sleep", ["0.1"]);
    } catch {
      exited = true;
      break;
    }
  }
  assert.equal(exited, true);
  console.log("detached launcher lifecycle verified");
} finally {
  if (pid) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  rmSync(root, { recursive: true, force: true });
}
