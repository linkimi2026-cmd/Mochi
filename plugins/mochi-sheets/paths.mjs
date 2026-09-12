// mochi-sheets · 路径安全（本插件自己的实现，不跨插件 import）。
//
// 约定（照 mochi-files/paths.mjs 的既有做法，缺省根取会话工作区）：
//   1. apply(ctx, { allowedRoots }) 显式指定；
//   2. 环境变量 MOCHI_SHEETS_ROOTS（path.delimiter 分隔）；
//   3. 当前会话的受管工作区（sandboxPolicy.workspaceRoot 或 session.header.cwd）；
//   4. 兜底 process.cwd()。
// 缺省**从不**包含主目录、文件系统根、根目录本身；显式传进来的根必须真实存在且是目录。
// 所有待校验路径先 resolve，再把"最深的已存在祖先"realpath，最后逐段比较，
// 因此符号链接跳出允许根也会被拒。
import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

export class SheetsError extends Error {
  /**
   * @param {string} code 机器可读的错误码（MOCHI_SHEETS_* 之外的本插件内部码）。
   * @param {string} message 面向老师的中文说明，必须给出下一步。
   * @param {object} [details] 附加结构化信息。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SheetsError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  return new SheetsError(code, message, details);
}

function isInside(root, candidate) {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function parseRootList(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function proveRoot(requested, label) {
  if (!isAbsolute(requested)) {
    throw fail('INVALID_ROOT', `允许根「${label}」必须是绝对路径（收到：${requested || '空'}）。`);
  }
  const resolved = resolve(requested);
  if (resolved === parse(resolved).root) {
    throw fail('INVALID_ROOT', `不允许把文件系统根目录（${resolved}）当作允许根；请指定工作区这样的具体目录。`);
  }
  let canonical;
  try {
    canonical = await realpath(resolved);
  } catch {
    throw fail('INVALID_ROOT', `允许根「${resolved}」不存在或不可读；请确认目录存在后重试。`);
  }
  let info;
  try {
    info = await stat(canonical);
  } catch {
    throw fail('INVALID_ROOT', `允许根「${canonical}」无法读取；请确认权限后重试。`);
  }
  if (!info.isDirectory()) throw fail('INVALID_ROOT', `允许根「${canonical}」不是目录；请改成一个目录。`);
  return canonical;
}

function sessionWorkspace(ctx) {
  const policy = ctx?.sandboxPolicy;
  if (policy && typeof policy.resolve === 'function') {
    try {
      const resolvedPolicy = policy.resolve({ session: ctx?.session });
      const root = resolvedPolicy?.workspaceRoot;
      if (typeof root === 'string' && isAbsolute(root)) return root;
    } catch { /* 策略不可用时继续往下找。 */ }
  }
  const cwd = ctx?.session?.header?.cwd;
  if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd;
  return null;
}

/**
 * 解析允许根。返回按优先级去重后的真实路径数组（至少一个）。
 *
 * 优先级：显式 options.allowedRoots → MOCHI_SHEETS_ROOTS → 当前会话工作区。
 * `process.cwd()` **只在以上全部不可用时**才作为最后兜底，不会和用户工作区并列；
 * 缺省值永远不含主目录，也不含磁盘根。
 */
export async function resolveAllowedRoots({ options = {}, env = process.env, ctx = null } = {}) {
  const candidates = [];
  if (Array.isArray(options.allowedRoots)) {
    candidates.push(...options.allowedRoots.filter((entry) => typeof entry === 'string'));
  }
  candidates.push(...parseRootList(env?.MOCHI_SHEETS_ROOTS));
  const workspace = sessionWorkspace(ctx);
  if (workspace) candidates.push(workspace);

  const roots = [];
  const rejected = [];
  const consider = async (candidate) => {
    try {
      const canonical = await proveRoot(candidate, candidate);
      if (!roots.includes(canonical)) roots.push(canonical);
    } catch (error) {
      rejected.push({ path: candidate, reason: error.message });
    }
  };

  for (const candidate of candidates) await consider(candidate);
  if (roots.length === 0) {
    // 最后兜底：当前工作目录（仍然拒绝磁盘根，仍然不是主目录）。
    // ⚠️ 这是一次"没有允许根也能跑"的放宽，和 mochi-files 的 fail-closed 标准不一致，
    // 所以**不允许静默**：至少留一条日志，方便排查"文件怎么写到奇怪的地方去了"。
    ctx?.logger?.warn?.(
      '[mochi-sheets] 没有解析到任何允许根（options/MOCHI_SHEETS_ROOTS/会话工作区都不可用），'
      + '已回退到当前工作目录；请检查宿主是否提供了 workspaceRoot。',
    );
    await consider(process.cwd());
  }
  if (roots.length === 0) {
    throw fail(
      'NO_ALLOWED_ROOT',
      '没有任何可用的允许根，无法安全读写表格文件。请把文件放在当前工作区目录内，或用 MOCHI_SHEETS_ROOTS 指定一个存在的绝对目录。'
      + `${rejected.length ? `（已拒绝：${rejected.map((item) => `${item.path}——${item.reason}`).join('；')}）` : ''}`,
    );
  }
  return { roots, rejected };
}

/** 允许根内路径的判定：返回命中的根，未命中返回 null。纯字符串比较，不做 IO。 */
export function matchRoot(roots, absolutePath) {
  for (const root of roots) if (isInside(root, absolutePath)) return root;
  return null;
}

/**
 * 老师**上传**的文件落在哪里？（与 mochi-documents 同一口径，2026-09-12）
 *
 * 宿主把上传原件按 verbatim 原样存到 `<DSH_HOME>/attachments/v1/files/<digest 前缀>/<digest>/<name>`，
 * 然后只给模型一句句柄文本：「verbatim read-only copy saved at <路径>。Read that path with your
 * file tools…」。这个位置**不在会话工作区里**，而本插件的允许根只认工作区，于是上传的
 * Excel/CSV 读不动——和「上传的 Word 打不开」是同一个根因。
 *
 * 判定：附件盘是宿主自己写下的**只读硬链接副本**（宿主文档明说 "read-only hard links"），
 * 读它不构成越权。所以这里把它作为**只读**根接进来，**写入路径一律不认它**：
 * `resolveInside` 只在 `mustExist: true`（读既有文件）时才会采用这些根。
 *
 * 根目录解析顺序与宿主一致：显式配置 → MOCHI_HOME → DSH_HOME → ~/.mochi-home / ~/.dsh。
 */
export function resolveAttachmentReadRoots({ configured = [], env = process.env, home = homedir() } = {}) {
  const candidates = [];
  for (const value of configured) candidates.push(value);
  for (const key of ['MOCHI_HOME', 'DSH_HOME']) {
    const value = env?.[key];
    if (typeof value === 'string' && value.trim().length > 0) candidates.push(value.trim());
  }
  candidates.push(join(home, '.mochi-home'), join(home, '.dsh'));
  const roots = [];
  for (const candidate of candidates) {
    const root = resolve(candidate, 'attachments', 'v1');
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}

/** 附件盘可能尚未创建（本次会话还没有上传）；解析不到就跳过，不做任何猜测。 */
export async function existingAttachmentReadRoots() {
  const usable = [];
  for (const root of resolveAttachmentReadRoots()) {
    try {
      const info = await stat(root);
      if (info.isDirectory()) usable.push(await realpath(root));
    } catch { /* 该候选不存在：忽略 */ }
  }
  return usable;
}

/**
 * 向上找到第一个真实存在的祖先（含自身）。返回 { ancestor, info, tail }；
 * tail 是从该祖先到目标之间的纯基名段，不含 `..`（resolve 已经把 `..` 折叠掉）。
 * 全都不存在时 ancestor 为 null。
 */
async function deepestExistingAncestor(requested) {
  let cursor = requested;
  const tail = [];
  for (;;) {
    try {
      return { ancestor: cursor, info: await stat(cursor), tail };
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) return { ancestor: null, info: null, tail };
      tail.unshift(cursor.slice(parent.length + 1) || cursor);
      cursor = parent;
    }
  }
}

/**
 * 把候选路径规范化到允许根内。
 * - `mustExist` 为真时要求目标已存在（读、导出源）；
 * - 为假时允许目标不存在，但**其最近的已存在祖先**必须落在允许根内（防 ../ 与软链逃逸）。
 * - `readOnlyRoots`（宿主附件盘）**只在 `mustExist` 为真时可用**：附件盘里是老师上传原件的
 *   只读硬链接副本，读它合法；但输出绝不能落进去，所以写入判定只认 `roots`。
 * 返回 { path, root, exists }；越界抛 SheetsError。
 */
export async function resolveInside({ roots, readOnlyRoots = [], candidate, label, mustExist = true }) {
  const text = typeof candidate === 'string' ? candidate.trim() : '';
  if (!text) throw fail('EMPTY_PATH', `「${label}」不能为空；请给出绝对路径。`);
  if (!isAbsolute(text)) {
    throw fail('RELATIVE_PATH', `「${label}」必须是绝对路径（收到：${text}）。请用完整路径，例如 /Users/<你>/.../表格.xlsx。`);
  }
  const requested = resolve(text);
  const usableRoots = mustExist ? [...roots, ...readOnlyRoots.filter((root) => !roots.includes(root))] : roots;
  const rootHint = usableRoots.join('、');

  const { ancestor, info, tail } = await deepestExistingAncestor(requested);
  if (!ancestor) {
    throw fail('PATH_UNRESOLVABLE', `「${label}」所在的任何上级目录都不存在：${requested}。请确认路径拼写与挂载点。`);
  }
  if (mustExist && tail.length > 0) {
    throw fail('PATH_NOT_FOUND', `「${label}」不存在或不可读：${requested}。请确认路径后重试。`);
  }

  let canonicalAncestor;
  try {
    canonicalAncestor = await realpath(ancestor);
  } catch {
    throw fail('PATH_UNRESOLVABLE', `「${label}」无法规范化为真实路径：${ancestor}。请确认权限后重试。`);
  }
  const canonical = tail.length > 0 ? join(canonicalAncestor, ...tail) : canonicalAncestor;

  // 目标不存在时：先确认最近已存在祖先在根内，再把剩余段接回去。
  const root = matchRoot(usableRoots, canonicalAncestor);
  if (!root) {
    throw fail(
      'PATH_OUTSIDE_ALLOWED_ROOT',
      `「${label}」不在允许的根目录内，已拒绝：${requested}\n允许的根：${rootHint}\n下一步：把文件放到允许根目录下，或用 MOCHI_SHEETS_ROOTS 指定一个存在的绝对目录后重试。`,
      { requested, roots: usableRoots, label },
    );
  }
  if (!isInside(root, canonical)) {
    throw fail(
      'PATH_OUTSIDE_ALLOWED_ROOT',
      `「${label}」通过符号链接或相对路径跳出了允许根，已拒绝：${requested}\n允许的根：${root}`,
      { requested, roots: usableRoots, label },
    );
  }
  const exists = tail.length === 0;
  // 只有当"目标本身就是已存在的那个路径"时才可能是目录；有 tail 说明目标还不存在，
  // 此时 info 描述的是祖先目录，不能拿它来判目标。
  if (exists && info?.isDirectory()) {
    throw fail('PATH_IS_DIRECTORY', `「${label}」是一个目录，不是文件：${requested}。请指向具体文件。`);
  }
  return { path: canonical, root, exists };
}

/** 确保输出文件的父目录存在（仍然要求父目录已在允许根内，由调用方先 resolveInside）。 */
export async function ensureParentDirectory(filePath) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
}

/** 输出目标必须不存在：本插件全流程不覆盖已有文件。 */
export async function assertNotExists(filePath, label) {
  try {
    await stat(filePath);
  } catch {
    return;
  }
  throw fail(
    'OUTPUT_EXISTS',
    `「${label}」已存在，不会被覆盖：${filePath}\n下一步：换一个文件名或目录再调用（本插件不覆盖已有文件，避免误删老师的东西）。`,
    { path: filePath },
  );
}
