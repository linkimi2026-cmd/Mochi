import { execFile, spawn } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { join, isAbsolute, extname } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };

export async function findWindowsWps(env = process.env) {
  for (const hive of ['HKCU', 'HKLM']) {
    for (const view of ['64', '32']) {
      try {
        const { stdout } = await run('reg.exe', ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\wpp.exe`, '/ve', `/reg:${view}`], { timeout: 1000, windowsHide: true });
        const candidate = stdout.match(/REG_SZ\s+(.+)/)?.[1]?.trim().replace(/^"|"$/g, '');
        if (candidate && isAbsolute(candidate) && await exists(candidate)) return candidate;
      } catch { /* An absent registry key is normal for per-user installations. */ }
    }
  }
  for (const base of [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
    const root = join(base, 'Kingsoft', 'WPS Office');
    const versions = await readdir(root, { withFileTypes: true }).catch(() => []);
    const paths = [join(root, 'office6', 'wpp.exe'), ...versions.filter((row) => row.isDirectory()).sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true })).map((row) => join(root, row.name, 'office6', 'wpp.exe'))];
    for (const candidate of paths) if (await exists(candidate)) return candidate;
  }
  throw Object.assign(new Error('教室电脑尚未找到 WPS 演示，请先安装 WPS。'), { code: 'WPS_NOT_INSTALLED' });
}

// Only called with a revalidated received PPTX; no shell, arbitrary app or arguments.
export async function openPresentationInWps(path) {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.pptx') throw new Error('仅支持已接收并校验的 PPTX 课件。');
  if (process.platform === 'darwin') {
    try {
      await run('/usr/bin/open', ['-b', 'com.kingsoft.wpsoffice.mac', path], { timeout: 3000 });
    } catch {
      throw Object.assign(new Error('无法交给 WPS 打开，请检查教室电脑是否已安装 WPS。'), { code: 'WPS_OPEN_FAILED' });
    }
  } else if (process.platform === 'win32') {
    const executable = await findWindowsWps();
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [path], { shell: false, detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  } else throw Object.assign(new Error('当前系统尚不支持 WPS 打开课件。'), { code: 'WPS_PLATFORM_UNSUPPORTED' });
  return { status: 'LAUNCH_REQUESTED', detail: '已交给 WPS 打开；尚未确认幻灯片窗口完成加载。' };
}
