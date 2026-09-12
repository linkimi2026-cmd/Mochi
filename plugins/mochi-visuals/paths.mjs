// mochi-visuals · 路径安全边界。
//
// 与 plugins/mochi-files/paths.mjs 保持同一套判定语义（同一份 isDescendant），
// 但允许根多了一条「视觉产物输出根」：它由宿主/本插件自己创建，用于存放
// image_edit / diagram_draw 的产物，默认是会话工作区下的 `Mochi Visuals/`，
// 没有受管工作区时退回系统临时目录下的 mochi-visuals/。
//
// 三层防护（抄自 mochi-files，未做削弱）：
//   1. 逻辑层：path.resolve 消掉 `.`/`..` 后必须落在某个允许根之内。
//   2. 符号链接层：对目标「最深已存在的祖先」做 realpath，realpath 结果仍必须
//      落在该根的 realpath 之内（挡住 root/link -> /etc 这类穿越）。
//   3. 根目录层：允许根本身必须是普通目录（不能是符号链接），且永远拒绝把
//      文件系统根（`/`）设为允许根。
//
// 允许根来源（按优先级，同样取第一个可用来源，不做跨来源合并）：
//   A. apply(ctx, { allowedRoots }) —— 宿主/测试显式指定；
//   B. 环境变量 MOCHI_VISUALS_ROOTS，其次兼容 MOCHI_FILES_ROOTS；
//   C. 本机数据根下 files/allowed-roots.json（老师显式授权过的目录）；
//   D. 当前会话的受管工作区（sandboxPolicy.workspaceRoot 或 session.header.cwd）。
// 数据根沿用 mochi-files 的约定：MOCHI_HOME → DSH_HOME → ~/.mochi-home。
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter as PATH_DELIMITER, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export const OUTPUT_DIR_NAME = 'Mochi Visuals';
export const TEMP_OUTPUT_DIR_NAME = 'mochi-visuals';

export class MochiVisualsError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MochiVisualsError';
    this.code = code;
    for (const [key, value] of Object.entries(details)) this[key] = value;
  }
}

export function toolFailure(code, message, details) {
  return new MochiVisualsError(code, message, details);
}

// 与 mochi-files / mochi-documents 的 isDescendant 完全同一判定语义。
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
    throw toolFailure('NO_ALLOWED_ROOT', '没有可用的允许根目录，视觉工具拒绝运行。');
  }
  const rootList = entries.map((entry) => entry.real);

  function matchEntry(candidate) {
    return entries.find((entry) => isDescendant(entry.logical, candidate) || isDescendant(entry.real, candidate)) || null;
  }

  // 目标可能还不存在（新建产物），沿父目录往上找到最深已存在的祖先做 realpath。
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
    /** 解析并校验一个工具入参路径（可指向尚不存在的目标）。 */
    async resolve(input, { field = '路径' } = {}) {
      const { path, entry } = resolveLogical(input, field);
      const realAncestor = await assertRealWithin(path, entry, field);
      return { path, realAncestor, entry };
    },
    /**
     * 解析并校验一个必须真实存在的普通文件；符号链接不接受。
     * 输入路径已确认落在允许根内时，返回 realpath 之后、仍在根内的真实路径。
     */
    async resolveExistingFile(input, { field = '文件', extensions } = {}) {
      const { path, entry } = await this.resolve(input, { field });
      const info = await statOrNull(path);
      if (!info) throw toolFailure('ENOENT', `${field}不存在：文件或目录不存在（ENOENT：${path}）。`, { target: path });
      if (info.isSymbolicLink()) throw toolFailure('PATH_UNSAFE', `${field}“${path}”是符号链接；为安全起见不接受符号链接。`, { target: path });
      if (!info.isFile()) throw toolFailure('PATH_UNSAFE', `${field}“${path}”不是普通文件。`, { target: path });
      const real = await realpath(path);
      if (!isDescendant(entry.real, real)) {
        throw toolFailure('PATH_ESCAPE', `${field}“${path}”的真实路径越出允许根（${real}），已拒绝。`, { attempted: path, resolvedTo: real });
      }
      if (Array.isArray(extensions) && extensions.length > 0) {
        const lower = real.toLowerCase();
        if (!extensions.some((extension) => lower.endsWith(extension))) {
          throw toolFailure('TYPE_UNSUPPORTED', `${field}必须是 ${extensions.join(' / ')} 文件，实际是：${real}`, { target: real });
        }
      }
      return { path: real, byteLength: info.size, mtime: info.mtime };
    },
  };
}

async function sessionWorkspace(ctx, exec) {
  const session = exec?.agent?.session;
  const policy = ctx?.sandboxPolicy?.resolve?.({ session });
  const fromPolicy = typeof policy?.workspaceRoot === 'string' && isAbsolute(policy.workspaceRoot) ? policy.workspaceRoot : null;
  const fromSession = typeof session?.header?.cwd === 'string' && isAbsolute(session.header.cwd) ? session.header.cwd : null;
  const root = fromPolicy || fromSession;
  // 只读会话仍然可以检索/预览；写操作由各工具在 requireWritable 处拒绝。
  return root ? { root, readOnly: policy?.mode === 'read-only' } : null;
}

/**
 * 决定本次调用可读写的根目录，并额外准备「视觉产物输出根」。
 * @returns {Promise<{entries: Array, source: string, readOnly: boolean, skipped: Array, outputRoot: string, outputSource: string}>}
 */
export async function resolveVisualRoots({ ctx, exec, options = {}, env = process.env } = {}) {
  let entries = [];
  let source = 'none';
  let readOnly = false;
  let skipped = [];

  const configured = parseRootList(options.allowedRoots);
  const fromEnv = parseRootList(env.MOCHI_VISUALS_ROOTS ?? env.MOCHI_FILES_ROOTS);

  if (configured.length) {
    const canonical = await canonicalRoots(configured, { label: '允许根目录', allowHome: options.allowHome === true, env });
    entries = canonical.entries;
    skipped = canonical.skipped;
    source = 'configured';
    if (!entries.length) {
      throw toolFailure('ROOT_UNAVAILABLE', `配置的允许根目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    }
  } else if (fromEnv.length) {
    const canonical = await canonicalRoots(fromEnv, { label: 'MOCHI_VISUALS_ROOTS 允许根', allowHome: true, env });
    entries = canonical.entries;
    skipped = canonical.skipped;
    source = 'env:MOCHI_VISUALS_ROOTS';
    if (!entries.length) {
      throw toolFailure('ROOT_UNAVAILABLE', `MOCHI_VISUALS_ROOTS 配置的目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    }
  } else {
    const stored = await readAllowedRoots(options.rootsFile || defaultRootsFile(env));
    if (stored.length) {
      const canonical = await canonicalRoots(stored, { label: '已授权的允许根', allowHome: true, env });
      skipped = canonical.skipped;
      if (canonical.entries.length) {
        entries = canonical.entries;
        source = `file:${options.rootsFile || defaultRootsFile(env)}`;
      } else if (skipped.length) {
        throw toolFailure('ROOT_UNAVAILABLE', `已授权的允许根目录都不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
      }
    }
  }

  const session = await sessionWorkspace(ctx, exec);
  if (!entries.length && session) {
    const canonical = await canonicalRoots([session.root], { label: '会话工作区', allowHome: false, env });
    skipped = canonical.skipped;
    if (!canonical.entries.length) {
      throw toolFailure('ROOT_UNAVAILABLE', `会话工作区不可用：${skipped.map((item) => `${item.path}（${item.reason}）`).join('；')}`);
    }
    entries = canonical.entries;
    source = 'session-workspace';
  }
  if (session) readOnly = session.readOnly;

  if (!entries.length) {
    throw toolFailure(
      'WORKSPACE_UNAVAILABLE',
      '当前会话没有受管工作区，也没有配置允许根目录。为避免越权读写磁盘，视觉工具拒绝在没有允许根时运行。',
    );
  }

  // ── 视觉产物输出根 ─────────────────────────────────────────────────────
  const primaryRoot = entries[0].logical;
  const candidates = [];
  const configuredOutput = parseRootList(options.outputRoot)[0]
    || parseRootList(env.MOCHI_VISUALS_OUTDIR)[0];
  if (configuredOutput) {
    candidates.push({ path: isAbsolute(configuredOutput) ? configuredOutput : resolve(primaryRoot, configuredOutput), source: 'configured' });
  }
  if (session) candidates.push({ path: join(session.root, OUTPUT_DIR_NAME), source: 'session-workspace' });
  candidates.push({ path: join(tmpdir(), TEMP_OUTPUT_DIR_NAME), source: 'temp-dir' });

  let outputRoot = null;
  let outputSource = null;
  const outputProblems = [];
  for (const candidate of candidates) {
    try {
      await mkdir(candidate.path, { recursive: true, mode: 0o700 });
      await ordinaryDirectory(candidate.path, '视觉产物输出目录');
      const real = await realpath(candidate.path);
      if (!real) throw new Error('无法解析真实路径');
      outputRoot = real;
      outputSource = candidate.source;
      if (!entries.some((entry) => entry.real === real)) {
        entries.push({ logical: resolve(candidate.path), real });
      }
      break;
    } catch (error) {
      outputProblems.push(`${candidate.path}（${error?.message ?? '不可用'}）`);
    }
  }
  if (!outputRoot) {
    throw toolFailure('OUTPUT_ROOT_UNAVAILABLE', `没有可用的视觉产物输出目录：${outputProblems.join('；')}`);
  }

  return { entries, source, readOnly, skipped, outputRoot, outputSource };
}
