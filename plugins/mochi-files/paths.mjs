// mochi-files · 路径安全边界。
//
// 这是整个文件工具族唯一被信任的入口：所有工具参数里的路径都必须先过
// createPathGuard().resolve()，绝不允许工具自己拼路径。
//
// 三层防护：
//   1. 逻辑层：path.resolve 消掉 `.`/`..` 后，必须落在某个允许根目录之内。
//   2. 符号链接层：对目标「最深已存在的祖先」做 realpath，realpath 结果仍
//      必须落在该根的 realpath 之内（挡住 root/link -> /etc 这类穿越）。
//   3. 根目录层：允许根本身必须是普通目录（不能是符号链接），且永远拒绝
//      把文件系统根（`/`）设为允许根。
//
// 允许根来源（按优先级，取第一个可用来源，不做跨来源合并，避免歧义）：
//   A. apply(ctx, { allowedRoots }) —— 宿主/测试显式指定；
//   B. 环境变量 MOCHI_FILES_ROOTS（按平台 path.delimiter 分隔）；
//   C. 本机数据根下 files/allowed-roots.json（老师显式授权过的目录，由宿主写入）；
//   D. 当前会话的受管工作区（sandboxPolicy.workspaceRoot 或 session.header.cwd）。
// 数据根沿用 mochi-dispatch/store.mjs 的约定：MOCHI_HOME → DSH_HOME → ~/.mochi-home。
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { delimiter as PATH_DELIMITER, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export class MochiFilesError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MochiFilesError';
    this.code = code;
    for (const [key, value] of Object.entries(details)) this[key] = value;
  }
}

export function toolFailure(code, message, details) {
  return new MochiFilesError(code, message, details);
}

// 与 mochi-documents/plugin.mjs 的 isDescendant 保持同一判定语义。
export function isDescendant(parent, candidate) {
  const difference = relative(parent, candidate);
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
}

export async function realpathOrNull(target) {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

export async function statOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
}

// 允许根必须是普通目录：符号链接、文件、不存在的路径都不接受。
export async function ordinaryDirectory(target, label) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw toolFailure('ROOT_UNAVAILABLE', `${label}不存在：${target}`);
    throw toolFailure('ROOT_UNAVAILABLE', `${label}不可访问（${error?.code ?? '未知错误'}）：${target}`);
  }
  if (info.isSymbolicLink()) throw toolFailure('ROOT_UNSAFE', `${label}是符号链接，不是普通目录：${target}`);
  if (!info.isDirectory()) throw toolFailure('ROOT_UNSAFE', `${label}不是目录：${target}`);
}

/** 数据根：与 mochi-dispatch/store.mjs 的 defaultDbPath 同一套解析顺序。 */
export function defaultDataRoot(env = process.env) {
  return env.MOCHI_HOME || env.DSH_HOME || join(env.HOME || '/tmp', '.mochi-home');
}

export function defaultRootsFile(env = process.env) {
  return join(defaultDataRoot(env), 'files', 'allowed-roots.json');
}

export function parseRootList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text.split(PATH_DELIMITER).map((entry) => entry.trim()).filter(Boolean);
}

/** 读取老师显式授权的允许根。文件缺失/损坏时返回空数组，绝不猜。 */
export async function readAllowedRoots(file = defaultRootsFile()) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => String(entry ?? '').trim()).filter((entry) => entry && isAbsolute(entry));
}

/** 原子写入允许根列表（宿主/测试用；工具本身不会改它）。 */
export async function writeAllowedRoots(file, roots) {
  const clean = parseRootList(roots).filter((entry) => isAbsolute(entry));
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
  return clean;
}

async function canonicalRoots(candidates, { label, allowHome = false, env = process.env } = {}) {
  const entries = [];
  const skipped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const logical = resolve(candidate);
    // 永远拒绝文件系统根：把 `/` 开放成允许根等于开放整块磁盘。
    if (parse(logical).root === logical) {
      skipped.push({ path: logical, reason: '拒绝把文件系统根目录设为允许根' });
      continue;
    }
    if (!allowHome && env.HOME) {
      const home = await realpathOrNull(env.HOME);
      const realCandidate = await realpathOrNull(logical);
      if (home && realCandidate === home) {
        skipped.push({ path: logical, reason: '默认不开放整个用户主目录，请在主目录下指定具体文件夹' });
        continue;
      }
    }
    try {
      await ordinaryDirectory(logical, label);
    } catch (error) {
      skipped.push({ path: logical, reason: error?.message ?? '不可用' });
      continue;
    }
    const real = await realpathOrNull(logical);
    if (!real || seen.has(real)) {
      if (!real) skipped.push({ path: logical, reason: '无法解析真实路径' });
      continue;
    }
    seen.add(real);
    entries.push({ logical, real });
  }
  return { entries, skipped };
}

export function createPathGuard(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw toolFailure('NO_ALLOWED_ROOT', '没有可用的允许根目录，file_* 工具拒绝运行。');
  }
  const rootList = entries.map((entry) => entry.real);

  function matchEntry(candidate) {
    return entries.find((entry) => isDescendant(entry.logical, candidate) || isDescendant(entry.real, candidate)) || null;
  }

  // 目标可能还不存在（新建/复制目标），沿父目录往上找到最深已存在的祖先做 realpath。
  async function realExistingAncestor(target) {
    let current = target;
    for (;;) {
      const real = await realpathOrNull(current);
      if (real) return real;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }

  function resolveLogical(input, field) {
    const raw = String(input ?? '').trim();
    if (!raw) throw toolFailure('BAD_PATH', `${field}不能为空。`);
    if (raw.includes('\0')) throw toolFailure('BAD_PATH', `${field}包含非法字符（NUL）。`);
    const primary = entries[0];
    // 相对路径一律相对「第一个允许根」解析；绝对路径必须自身就在某个允许根内。
    const candidate = isAbsolute(raw) ? resolve(raw) : resolve(primary.logical, raw);
    const entry = matchEntry(candidate);
    if (!entry) {
      throw toolFailure('PATH_ESCAPE', `${field}“${raw}”越出允许的根目录（${rootList.join('、')}），已拒绝。`, { attempted: candidate });
    }
    return { path: candidate, entry };
  }

  async function assertRealWithin(candidate, entry, field) {
    const realAncestor = await realExistingAncestor(candidate);
    if (!realAncestor) throw toolFailure('PATH_UNAVAILABLE', `${field}所在目录不存在：${candidate}`, { attempted: candidate });
    if (!isDescendant(entry.real, realAncestor)) {
      throw toolFailure(
        'PATH_ESCAPE',
        `${field}“${candidate}”通过符号链接指向允许根之外（${realAncestor}），已拒绝。`,
        { attempted: candidate, resolvedTo: realAncestor },
      );
    }
    return realAncestor;
  }

  return {
    roots: rootList,
    entries,
    /**
     * 解析并校验一个工具入参路径。
     * @returns {Promise<{path: string, realAncestor: string, entry: object}>}
     */
    async resolve(input, { field = '路径' } = {}) {
      const { path, entry } = resolveLogical(input, field);
      const realAncestor = await assertRealWithin(path, entry, field);
      return { path, realAncestor, entry };
    },
  };
}

async function sessionWorkspace(ctx, exec) {
  const session = exec?.agent?.session;
  const policy = ctx?.sandboxPolicy?.resolve?.({ session });
  const fromPolicy = typeof policy?.workspaceRoot === 'string' && isAbsolute(policy.workspaceRoot) ? policy.workspaceRoot : null;
  const fromSession = typeof session?.header?.cwd === 'string' && isAbsolute(session.header.cwd) ? session.header.cwd : null;
  const root = fromPolicy || fromSession;
  // 只读会话仍然可以搜索/读取；写操作由各 handler 在 requireWritable 处拒绝。
  return root ? { root, readOnly: policy?.mode === 'read-only' } : null;
}

/**
 * 决定本次调用可读写的根目录。取第一个可用来源，不做跨来源合并。
 * @returns {Promise<{entries: Array<{logical:string, real:string}>, source: string, readOnly: boolean, skipped: Array}>}
 */
export async function resolveAllowedRoots({ ctx, exec, options = {}, env = process.env } = {}) {
  const configured = parseRootList(options.allowedRoots);
  if (configured.length) {
    const { entries, skipped } = await canonicalRoots(configured, { label: '允许根目录', allowHome: options.allowHome === true, env });
    if (!entries.length) {
      throw toolFailure('ROOT_UNAVAILABLE', `配置的允许根目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    }
    return { entries, source: 'configured', readOnly: false, skipped };
  }

  const fromEnv = parseRootList(env.MOCHI_FILES_ROOTS);
  if (fromEnv.length) {
    const { entries, skipped } = await canonicalRoots(fromEnv, { label: 'MOCHI_FILES_ROOTS 允许根', allowHome: true, env });
    if (!entries.length) {
      throw toolFailure('ROOT_UNAVAILABLE', `MOCHI_FILES_ROOTS 配置的目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    }
    return { entries, source: 'env:MOCHI_FILES_ROOTS', readOnly: false, skipped };
  }

  const stored = await readAllowedRoots(options.rootsFile || defaultRootsFile(env));
  if (stored.length) {
    const { entries, skipped } = await canonicalRoots(stored, { label: '已授权的允许根', allowHome: true, env });
    if (entries.length) return { entries, source: `file:${options.rootsFile || defaultRootsFile(env)}`, readOnly: false, skipped };
    if (skipped.length) {
      throw toolFailure('ROOT_UNAVAILABLE', `已授权的允许根目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    }
  }

  const session = await sessionWorkspace(ctx, exec);
  if (session) {
    const { entries, skipped } = await canonicalRoots([session.root], { label: '会话工作区', allowHome: false, env });
    if (entries.length) return { entries, source: 'session-workspace', readOnly: session.readOnly, skipped };
    throw toolFailure('ROOT_UNAVAILABLE', `会话工作区不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
  }

  throw toolFailure(
    'WORKSPACE_UNAVAILABLE',
    '当前会话没有受管工作区，也没有配置允许根目录。为避免越权读写磁盘，file_* 工具拒绝在没有允许根时运行。',
  );
}
