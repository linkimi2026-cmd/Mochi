#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { closeSync, openSync, chmodSync } = require("node:fs");

function usage() {
  console.error("用法：run-detached.cjs --log <path> -- <command> [args...]");
}

const args = process.argv.slice(2);
const separator = args.indexOf("--");
const logFlag = args.indexOf("--log");
if (separator < 0 || logFlag < 0 || logFlag + 1 >= separator || separator + 1 >= args.length) {
  usage();
  process.exit(2);
}

const logPath = args[logFlag + 1];
const command = args[separator + 1];
const commandArgs = args.slice(separator + 2);
let logFd;
try {
  logFd = openSync(logPath, "w", 0o600);
  chmodSync(logPath, 0o600);
} catch {
  console.error("无法创建受限启动日志。");
  process.exit(1);
}

const child = spawn(command, commandArgs, {
  detached: true,
  stdio: ["ignore", logFd, logFd],
});

let settled = false;
child.once("error", () => {
  if (settled) return;
  settled = true;
  closeSync(logFd);
  console.error("无法启动后台进程。");
  process.exitCode = 1;
});
child.once("spawn", () => {
  if (settled) return;
  settled = true;
  child.unref();
  closeSync(logFd);
  process.stdout.write(`${child.pid}\n`);
});
