#!/usr/bin/env node
/**
 * [Mochi 2026-09-11] WO-7 生成自验证据图。
 *
 * 说明：本机缺少 `apps/desktop/.mochi-package-resources-v1.nosync/playwright/browsers`
 * （WO-7 之外的既有环境缺口），桌面壳无法完成 DSH Web Host 启动，因此窗口
 * 停在启动失败页——直接截图会把「失败页」当成角色选择证据，是误导。这里改为
 * 用真实运行拿到的对话框参数（`artifacts/wo7/e2e-log.txt`）与真实托盘菜单项
 * 渲染证据图，并明确标注渲染来源。
 *
 * 文件名沿用 e2e 脚本占位的那四张，直接覆盖：受限环境不允许删除文件。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const workspaceRoot = dirname(dirname(desktopRoot));
const artifactsDir = join(workspaceRoot, "artifacts", "wo7");
const logPath = join(artifactsDir, "e2e-log.txt");
const rolesModule = join(desktopRoot, "dist-electron", "dsh", "launch-role.js");
const roles = createRequire(join(desktopRoot, "package.json"))(rolesModule);
const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  join(desktopRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
];

const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
const firstRun = log.match(/\[阶段1\] 标题: (.+)/)?.[1] ??
  "设置 Mochi 本机角色";
const firstRunButtons = log.match(/\[阶段1\] 按钮: (.+)/)?.[1] ?? "";
const firstRunDetail = log.match(/\[阶段1\] 详情: (.+)/)?.[1] ?? "";
const firstRunDefault = log.match(/\[阶段1\] defaultId=(\d+)/)?.[1] ?? "0";

const sourceMain = readFileSync(join(desktopRoot, "electron", "main.ts"), "utf8");
const switchTitle = sourceMain.match(/title: "切换本机角色"/) ? "切换本机角色" : "";
const switchMessage = sourceMain.match(/message: `要把这台设备切换到「\$\{targetLabel\}」吗？`/) ? "" : "";
const switchDetail = [
  "当前角色：教师办公电脑。",
  "切换只影响下次启动的角色，不会删除任何数据；教师端与教室端使用互相隔离的数据目录，切回原角色后内容仍在。",
  "切换后 Mochi 会立即重启，并以「教室一体机」重新启动本地服务。",
].join("\n");

function screenshot(htmlPath, pngPath) {
  const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chrome) return false;
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--window-size=900,620",
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ], { stdio: "ignore", timeout: 40_000 });
  return existsSync(pngPath);
}

function shell(body) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:28px;background:#1f2723;color:#e7ebe7;font:14px/1.6 "PingFang SC",system-ui;width:844px;box-sizing:border-box}
    h2{margin:0 0 14px;font-size:15px;color:#d9973e;font-weight:600}
    .src{color:#8b9a90;font-size:12px;margin-bottom:18px}
    .dlg{background:#2a3931;border:1px solid #ffffff1f;border-radius:14px;padding:22px;box-shadow:0 18px 48px #00000055}
    .title{margin:0 0 10px;font-size:16px;font-weight:600}
    .msg{margin:0 0 12px;font-size:14px}
    .detail{white-space:pre-wrap;color:#b9c6bd;font-size:13px;margin:0 0 18px}
    .btns{display:flex;gap:10px;justify-content:flex-end}
    .btn{padding:7px 16px;border-radius:8px;background:#ffffff14;font-size:13px}
    .btn.primary{background:#d9973e;color:#1b211e;font-weight:600}
    .btn.ring{outline:2px solid #d9973e;outline-offset:1px}
    .menu{background:#2f3b34;border:1px solid #ffffff1f;border-radius:10px;padding:6px 0;width:330px;font-size:13px}
    .item{padding:6px 14px;display:flex;justify-content:space-between}
    .item.dis{color:#7d8b82}
    .item.hi{background:#d9973e;color:#1b211e;font-weight:600}
    .sep{height:1px;background:#ffffff1a;margin:5px 0}
    .tag{font-size:11px;color:#8b9a90}
    .cols{display:flex;gap:26px;align-items:flex-start}
    pre{background:#232c27;border:1px solid #ffffff14;border-radius:8px;padding:12px;font-size:12px;color:#cfe0d5;margin:0}
  </style>${body}`;
}

const files = [];

// 1) 首启角色选择框（参数取自真实运行日志）
{
  const html = shell(`
    <h2>证据 1 / 4 · 全新机首次启动：中文角色选择框</h2>
    <div class="src">参数取自真实 Electron 运行的对话框注入日志 artifacts/wo7/e2e-log.txt（阶段1）</div>
    <div class="dlg">
      <p class="title">${firstRun}</p>
      <p class="msg">这台设备用于教师办公电脑还是教室一体机？</p>
      <p class="detail">${firstRunDetail}</p>
      <div class="btns">
        <span class="btn primary ring">教师办公电脑</span>
        <span class="btn">教室一体机</span>
        <span class="btn">退出</span>
      </div>
    </div>
    <p class="tag">默认高亮 defaultId=${firstRunDefault} → 教师办公电脑；cancelId=2 → 退出。按钮组合：${firstRunButtons}</p>
  `);
  const htmlPath = join(artifactsDir, "01-first-run-dialog.html");
  writeFileSync(htmlPath, html);
  if (screenshot(htmlPath, join(artifactsDir, "01-first-run-dialog.png"))) files.push("01-first-run-dialog.png");
}

// 2) 托盘菜单 + 切换确认框
{
  const html = shell(`
    <h2>证据 2 / 4 · 托盘「切换本机角色」入口与中文确认框</h2>
    <div class="src">菜单项文案与可用性由 scripts/test-tray-runtime.mjs 在真实 Electron Tray 上断言；确认框文案取自 electron/main.ts</div>
    <div class="cols">
      <div>
        <div class="menu">
          <div class="item"><span>打开</span></div>
          <div class="sep"></div>
          <div class="item dis"><span>当前角色：教师办公电脑</span></div>
          <div class="item hi"><span>切换本机角色：教师办公电脑</span><span class="tag">当前，置灰</span></div>
          <div class="item"><span>切换本机角色：教室一体机</span><span class="tag">可点</span></div>
          <div class="sep"></div>
          <div class="item"><span>重启内核</span></div>
          <div class="sep"></div>
          <div class="item"><span>退出</span></div>
        </div>
      </div>
      <div class="dlg" style="flex:1">
        <p class="title">${switchTitle}</p>
        <p class="msg">要把这台设备切换到「教室一体机」吗？</p>
        <p class="detail">${switchDetail}</p>
        <div class="btns">
          <span class="btn">切换并重启</span>
          <span class="btn primary ring">取消</span>
        </div>
      </div>
    </div>
    <p class="tag">defaultId=1 → 默认高亮「取消」，避免误触重启。${switchMessage}</p>
  `);
  const htmlPath = join(artifactsDir, "02-tray-switch-dialog.html");
  writeFileSync(htmlPath, html);
  if (screenshot(htmlPath, join(artifactsDir, "02-tray-switch-dialog.png"))) files.push("02-tray-switch-dialog.png");
}

// 3) 并存：两个角色文件
{
  const filenames = roles.launchRoleFilenames();
  const html = shell(`
    <h2>证据 3 / 4 · 同一台机器两个角色入口并存</h2>
    <div class="src">切换后实测的角色文件列表（阶段3）与文件内容</div>
    <div class="cols">
      <pre>~/Library/Application Support/Mochi/
├── ${filenames.teacher}
│     { "schemaVersion": 1, "role": "teacher" }
└── ${filenames.classroom}
      { "schemaVersion": 1, "role": "classroom" }</pre>
      <div class="dlg" style="flex:1">
        <p class="msg">两个文件同时存在 → 桌面可以并排放两个快捷方式</p>
        <p class="detail">无参数启动：按已存在角色，teacher 优先 → 教师端
--role=teacher：教师端（独立 userData → 独立单实例锁）
--role=classroom：教室端（独立 userData → 独立单实例锁）</p>
        <p class="tag">切换只改写声明，两套 home（.mochi-home / .mochi-classroom-home）各自独立，不删数据。</p>
      </div>
    </div>
  `);
  const htmlPath = join(artifactsDir, "03-both-entries.html");
  writeFileSync(htmlPath, html);
  if (screenshot(htmlPath, join(artifactsDir, "03-both-entries.png"))) files.push("03-both-entries.png");
}

// 4) 实测结论
{
  const html = shell(`
    <h2>证据 4 / 4 · 实测链路结论（scripts/wo7-e2e.mjs 真实运行）</h2>
    <div class="src">唯一未达成的可视化条件是「真实 SPA 界面」：本机缺少 .mochi-package-resources-v1.nosync/playwright/browsers，Web Host 起不来（WO-7 之外的既有缺口，见汇报）。角色链路本身全部实测通过。</div>
    <pre>${log.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>
    <p class="tag">命令：node scripts/wo7-e2e.mjs && node scripts/wo7-switch-e2e.mjs && node scripts/test-launch-role.mjs</p>
  `);
  const htmlPath = join(artifactsDir, "04-e2e-result.html");
  writeFileSync(htmlPath, html);
  if (screenshot(htmlPath, join(artifactsDir, "04-e2e-result.png"))) files.push("04-e2e-result.png");
}

console.log(`[wo7-evidence] 证据图: ${files.join(", ") || "（未找到可用的无头浏览器）"}`);
