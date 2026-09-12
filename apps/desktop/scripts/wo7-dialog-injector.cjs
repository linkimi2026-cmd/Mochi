// [Mochi 2026-09-11] WO-7 实机自验的对话框替身注入器。
//
// 主进程的 `app.whenReady()` 会在 inspector 连接之前就调用角色对话框，所以
// 不能等到连上 inspector 再打补丁。这个文件作为 Electron 的入口先被执行，
// 在 require 真正的 main 之前就把 `dialog.showMessageBox` 换掉，并把每次调用
// 的参数写到磁盘，供测试进程断言。
const { writeFileSync, appendFileSync, existsSync } = require("node:fs");

const logPath = process.env.MOCHI_WO7_DIALOG_LOG;
const responseFile = process.env.MOCHI_WO7_DIALOG_RESPONSE;

function record(entry) {
  if (!logPath) return;
  try {
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  } catch {
    // 记录失败不影响被测行为。
  }
}

function nextResponse() {
  if (!responseFile || !existsSync(responseFile)) return undefined;
  try {
    const raw = require("node:fs").readFileSync(responseFile, "utf8").trim();
    if (raw === "") return undefined;
    return Number(raw);
  } catch {
    return undefined;
  }
}

const electron = require("electron");
if (electron.dialog && !globalThis.__wo7Patched) {
  const original = electron.dialog.showMessageBox.bind(electron.dialog);
  electron.dialog.showMessageBox = async (...args) => {
    const options = Array.isArray(args) ? args.find((value) => value && typeof value === "object" && !("webContents" in value)) ?? args[0] : args;
    record({ options: JSON.parse(JSON.stringify(options ?? {})) });
    const response = nextResponse();
    if (response !== undefined && Number.isFinite(response)) {
      return { response, checkboxChecked: false };
    }
    return await original(...args);
  };
  globalThis.__wo7Patched = true;
}

// 入口脚本需要把真正的产品入口拉起来，行为与 `electron .` 一致。
require(process.env.MOCHI_WO7_MAIN_ENTRY);
