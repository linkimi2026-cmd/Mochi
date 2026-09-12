// mochi-files · 六个文件工具的真实实现（node:fs/promises，没有模拟结果）。
//
// 每个 handler 的签名都是 (args, exec)，与 ctx.tools.register 的 execute 一致。
// 所有路径入参都先过 createPathGuard().resolve()，本文件不自行拼路径。
import { copyFile, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createPathGuard, MochiFilesError, resolveAllowedRoots, statOrNull, toolFailure } from './paths.mjs';

export const DEFAULT_MAX_READ_BYTES = 256 * 1024;
export const HARD_MAX_READ_BYTES = 4 * 1024 * 1024;
export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 200;
export const DEFAULT_MAX_DEPTH = 6;
export const MAX_MAX_DEPTH = 32;
export const MAX_SCAN_ENTRIES = 50_000;

const ERRNO_ZH = {
  ENOENT: '文件或目录不存在',
  EACCES: '没有访问权限',
  EPERM: '操作不被允许',
  EEXIST: '目标已存在',
  ENOTDIR: '路径中有一段不是目录',
  EISDIR: '目标是目录',
  ENOTEMPTY: '目录非空',
  EXDEV: '跨设备，不能直接移动',
  ELOOP: '符号链接层级过多',
  ENAMETOOLONG: '路径过长',
  EMFILE: '打开的文件过多',
  ENOSPC: '磁盘空间不足',
  EROFS: '目标文件系统是只读的',
  EBUSY: '资源被占用',
  EINVAL: '参数无效',
  EIO: '底层读写错误',
};

function fsFailure(error, action, target) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(error.code) ? error.code : 'EUNKNOWN';
  const zh = ERRNO_ZH[code] || '操作系统返回未知错误';
  return toolFailure(code, `${action}失败：${target}（${code}：${zh}）。`, { target: String(target) });
}

function missingFailure(action, detail) {
  return fsFailure({ code: 'ENOENT' }, action, detail);
}

/**
 * 二进制文件被 `file_read` 拒了以后，模型该改调哪个工具？
 *
 * 为什么不只写一句"请用对应的文档工具"：模型读了宿主附件句柄文本
 * （「verbatim read-only copy saved at <路径>。Read that path with your file tools」）
 * 之后，最先想到的就是本工具——它是目录里唯一"给路径就读"的通用读取器。这时
 * 如果只回一句含糊的"请用对应的文档工具"，模型并不知道工具**叫什么名字**，
 * 常见结局是改去 web_search、或者干脆告诉老师"读不了这个文件"。
 *
 * 所以这里按后缀点名具体工具，把拒绝消息本身变成路由器。表里的名字全部是
 * 真实注册过的模型可见工具名（mochi-documents / mochi-sheets / mochi-presentations /
 * 底座 tool-fs），不会指错路。认不出来的二进制类型就如实说不支持，不硬编一个名字。
 */
export function readerHint(filePath) {
  const lower = String(filePath ?? '').toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  switch (ext) {
    case '.docx':
      return '这是 Word 文档，请改用 doc_read 读取（要改内容用 doc_edit，要导出 PDF 用 doc_export）。';
    case '.doc':
      return '这是旧版 .doc（BIFF）格式，本机不支持直接解析；请先用 Word 或 WPS 另存为 .docx，再用 doc_read 读取。';
    case '.pdf':
      return '这是 PDF，请改用 pdf_read 读取（可按页返回真实文本）。';
    case '.xlsx':
      return '这是 Excel 工作簿，请改用 spreadsheet_read 读取（可按工作表与区域返回单元格）。';
    case '.csv':
      return '这是 CSV，请改用 spreadsheet_read 读取（不要用 file_read 猜编码与分隔符）。';
    case '.xls':
      return '这是旧版 .xls（BIFF）格式，本机不支持；请先另存为 .xlsx，再用 spreadsheet_read 读取。';
    case '.pptx':
      return '这是 PowerPoint 课件，请改用 ppt_inspect 读取结构；要生成或修订课件用 mochi_ppt_create / mochi_ppt_revise。';
    case '.ppt':
      return '这是旧版 .ppt 格式，本机不支持；请先另存为 .pptx，再用 ppt_inspect 读取。';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.gif':
      return '这是图片，请改用 read_image 查看（它能真的把图画出来给你看，前提是当前模型支持图像输入）。';
    default:
      return '本机没有能读取这种二进制格式的工具，请如实告诉老师无法读取，不要猜内容、也不要改成用别的工具硬读。';
  }
}

async function withFs(action, target, work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MochiFilesError) throw error;
    throw fsFailure(error, action, target);
  }
}

function clampInt(value, fallback, min, max, label, notes) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    notes.push(`${label}不是有效数字，已改用默认值 ${fallback}。`);
    return fallback;
  }
  const floored = Math.floor(number);
  const bounded = Math.min(Math.max(floored, min), max);
  if (bounded !== floored) notes.push(`${label} ${floored} 超出范围 ${min}–${max}，已收敛到 ${bounded}。`);
  return bounded;
}

function wildcardMatcher(query) {
  if (/[*?]/.test(query)) {
    const escaped = query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    const pattern = new RegExp(`^${escaped}$`, 'iu');
    return (name) => pattern.test(name);
  }
  const needle = query.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

async function describeEntry(parent, name, kind) {
  const target = join(parent, name);
  const info = await statOrNull(target);
  return {
    名称: name,
    路径: target,
    类型: kind === 'directory' ? '文件夹' : '文件',
    ...(info && kind !== 'directory' ? { 大小字节: info.size } : {}),
    ...(info ? { 修改时间: info.mtime.toISOString() } : {}),
  };
}

export function createFileHandlers({ ctx, options = {} } = {}) {
  const cache = new Map();

  async function guardFor(exec) {
    const { entries, source, readOnly } = await resolveAllowedRoots({ ctx, exec, options });
    const key = `${source}::${readOnly ? 'ro' : 'rw'}::${entries.map((entry) => entry.real).join('|')}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = { guard: createPathGuard(entries), readOnly };
      cache.set(key, cached);
    }
    return cached;
  }

  function requireWritable(readOnly, action) {
    if (readOnly) {
      throw toolFailure('WORKSPACE_READ_ONLY', `当前会话是只读模式，${action}已被拒绝；只读会话只能搜索和读取文件。`);
    }
  }

  // 目标路径（可能尚不存在）的通用检查：符号链接一律拒绝覆盖，已存在要显式 overwrite。
  async function prepareDestination(guard, rawPath, { field, overwrite, action }) {
    const { path: target } = await guard.resolve(rawPath, { field });
    const info = await statOrNull(target);
    let overwritten = null;
    if (info) {
      if (info.isSymbolicLink()) {
        throw toolFailure('MOCHI_FILES_SYMLINK_TARGET', `${action}失败：目标 ${target} 是符号链接，为避免写到允许根之外，拒绝覆盖。`, { target });
      }
      if (info.isDirectory()) {
        throw toolFailure('EISDIR', `${action}失败：目标 ${target} 是已存在的目录（EISDIR：目标是目录）。`, { target });
      }
      if (!overwrite) {
        throw toolFailure('MOCHI_FILES_TARGET_EXISTS', `${action}失败：目标 ${target} 已存在。默认不覆盖已有文件；确认要覆盖时请显式传 overwrite: true。`, { target });
      }
      overwritten = { 路径: target, 原大小字节: info.size, 原修改时间: info.mtime.toISOString() };
    }
    return { target, overwritten };
  }

  async function afterWrite(guard, target, action, rollback) {
    try {
      return await guard.resolve(target, { field: '目标路径' });
    } catch (error) {
      if (typeof rollback === 'function') await rollback().catch(() => {});
      throw toolFailure(error.code, `${action}后复检发现目标越出允许根，已回滚：${error.message}`, { target });
    }
  }

  return {
    // ── file_search ────────────────────────────────────────────────────────
    async search(args = {}, exec) {
      const notes = [];
      const { guard } = await guardFor(exec);
      const query = String(args.query ?? '').trim();
      if (!query) throw toolFailure('MOCHI_FILES_BAD_QUERY', 'file_search 需要 query：文件名或通配符，例如“期中*.docx”或“光的折射”。');
      const limit = clampInt(args.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT, 'limit', notes);
      const maxDepth = clampInt(args.maxDepth, DEFAULT_MAX_DEPTH, 0, MAX_MAX_DEPTH, 'maxDepth', notes);
      const recursive = args.recursive !== false;
      const type = ['file', 'directory', 'any'].includes(args.type) ? args.type : 'any';
      const { path: searchRoot } = await guard.resolve(args.directory || '.', { field: '搜索目录' });
      const rootInfo = await statOrNull(searchRoot);
      if (!rootInfo) throw missingFailure('搜索', `目录不存在：${searchRoot}`);
      if (!rootInfo.isDirectory()) throw toolFailure('ENOTDIR', `搜索失败：${searchRoot} 不是目录（ENOTDIR：路径中有一段不是目录）。`, { target: searchRoot });

      const matcher = wildcardMatcher(query);
      const matches = [];
      const stack = [{ dir: searchRoot, depth: 0 }];
      let scannedDirs = 0;
      let scannedEntries = 0;
      let skipped = 0;
      let truncatedByLimit = false;
      let truncatedByScan = false;

      while (stack.length) {
        const { dir, depth } = stack.pop();
        scannedDirs += 1;
        let dirents;
        try {
          dirents = await readdir(dir, { withFileTypes: true });
        } catch {
          skipped += 1;
          continue;
        }
        for (const dirent of dirents) {
          scannedEntries += 1;
          if (scannedEntries > MAX_SCAN_ENTRIES) {
            truncatedByScan = true;
            stack.length = 0;
            break;
          }
          if (dirent.isSymbolicLink()) {
            // 不跟随符号链接：它可能指向允许根之外，也可能成环。
            skipped += 1;
            continue;
          }
          const isDirectory = dirent.isDirectory();
          if (isDirectory && recursive && depth < maxDepth) stack.push({ dir: join(dir, dirent.name), depth: depth + 1 });
          if ((isDirectory && type === 'file') || (!isDirectory && type === 'directory')) continue;
          if (matcher(dirent.name)) matches.push({ dir, name: dirent.name, kind: isDirectory ? 'directory' : 'file' });
          if (matches.length > limit) {
            truncatedByLimit = true;
            break;
          }
        }
        if (matches.length > limit) break;
      }

      const truncated = truncatedByLimit || truncatedByScan;
      const shown = matches.slice(0, limit);
      const results = await Promise.all(shown.map((entry) => describeEntry(entry.dir, entry.name, entry.kind)));
      results.sort((a, b) => a.名称.localeCompare(b.名称, 'zh-Hans-CN'));
      if (truncatedByLimit) notes.push(`匹配结果达到上限（${limit} 条），只显示前 ${limit} 条，还有更多结果未列出。`);
      if (truncatedByScan) notes.push(`扫描条目超过 ${MAX_SCAN_ENTRIES} 条后停止搜索；结果可能不完整。`);

      return {
        ok: true,
        搜索目录: searchRoot,
        模式: query,
        匹配方式: /[*?]/.test(query) ? '通配符（* 和 ?，不跨目录分隔符）' : '文件名包含（不区分大小写）',
        类型过滤: type,
        递归: recursive,
        最大深度: recursive ? maxDepth : 0,
        结果数: results.length,
        条数上限: limit,
        是否截断: truncated,
        扫描目录数: scannedDirs,
        扫描条目数: scannedEntries,
        跳过的符号链接或不可读项: skipped,
        结果: results,
        说明: [
          '结果的路径都是允许根之内的真实绝对路径；搜索不跟随符号链接。',
          ...notes,
        ].join(' '),
      };
    },

    // ── file_read ──────────────────────────────────────────────────────────
    async read(args = {}, exec) {
      const notes = [];
      const { guard } = await guardFor(exec);
      const { path: filePath } = await guard.resolve(args.path, { field: '文件路径' });
      const info = await statOrNull(filePath);
      if (!info) {
        throw missingFailure('读取', `文件不存在：${filePath}`);
      }
      if (info.isDirectory()) throw toolFailure('EISDIR', `读取失败：${filePath} 是目录，不是文件（EISDIR：目标是目录）。`, { target: filePath });
      if (!info.isFile()) throw toolFailure('MOCHI_FILES_NOT_REGULAR_FILE', `读取失败：${filePath} 不是普通文件。`, { target: filePath });

      const requested = args.maxBytes;
      const maxBytes = clampInt(requested, DEFAULT_MAX_READ_BYTES, 1, HARD_MAX_READ_BYTES, 'maxBytes', notes);
      if (requested !== undefined && Number(requested) > HARD_MAX_READ_BYTES) {
        notes.push(`maxBytes 超过硬上限 ${HARD_MAX_READ_BYTES} 字节，已按硬上限执行。`);
      }

      const handle = await withFs('读取', filePath, () => open(filePath, 'r'));
      let size = 0;
      let data = Buffer.alloc(0);
      try {
        size = (await handle.stat()).size;
        const toRead = Math.min(maxBytes, size);
        const buffer = Buffer.alloc(toRead);
        const { bytesRead } = await handle.read(buffer, 0, toRead, 0);
        data = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close().catch(() => {});
      }

      const byteTruncated = size > data.length;
      if (data.includes(0)) {
        throw toolFailure(
          'MOCHI_FILES_NOT_TEXT',
          `读取失败：${filePath} 看起来是二进制文件（含 NUL 字节），file_read 只能读纯文本。${readerHint(filePath)}`,
          { target: filePath, hint: readerHint(filePath) },
        );
      }
      if (byteTruncated) {
        notes.push(`文件共 ${size} 字节，超过本次上限 ${maxBytes} 字节，只读取了前 ${data.length} 字节，内容被截断。`);
      }

      const text = data.toString('utf8');
      const allLines = text.split(/\r\n|\r|\n/);
      const startLine = clampInt(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER, 'startLine', notes);
      const endLineRaw = clampInt(args.endLine, allLines.length, 1, Number.MAX_SAFE_INTEGER, 'endLine', notes);
      const endLine = Math.max(startLine, endLineRaw);
      const selected = allLines.slice(startLine - 1, endLine);
      if (startLine > allLines.length) {
        notes.push(`startLine ${startLine} 超过已读取范围（共 ${allLines.length} 行），返回空内容。`);
      }
      const totalLines = byteTruncated ? null : allLines.length;
      if (totalLines === null) notes.push('因为内容被截断，总行数无法确定，只报告已读取的行数。');

      return {
        ok: true,
        路径: filePath,
        文件大小字节: size,
        读取字节数: data.length,
        是否截断: byteTruncated,
        行范围: { 起始行: startLine, 结束行: endLine },
        总行数: totalLines,
        已读取行数: selected.length,
        正文: selected.join('\n'),
        说明: notes.length ? notes.join(' ') : '已按请求完整读取该文本文件。',
      };
    },

    // ── file_copy ──────────────────────────────────────────────────────────
    async copy(args = {}, exec) {
      const overwrite = args.overwrite === true;
      const { guard, readOnly } = await guardFor(exec);
      requireWritable(readOnly, '复制文件');
      const { path: source } = await guard.resolve(args.source, { field: '来源路径' });
      const sourceInfo = await statOrNull(source);
      if (!sourceInfo) throw missingFailure('复制', `来源文件不存在：${source}`);
      if (sourceInfo.isDirectory()) throw toolFailure('MOCHI_FILES_SOURCE_IS_DIRECTORY', `复制失败：${source} 是目录。当前 file_copy 只复制文件，不复制整个目录。`, { target: source });
      if (!sourceInfo.isFile()) throw toolFailure('MOCHI_FILES_NOT_REGULAR_FILE', `复制失败：${source} 不是普通文件。`, { target: source });

      const { target, overwritten } = await prepareDestination(guard, args.destination, { field: '目标路径', overwrite, action: '复制' });
      if (target === source) throw toolFailure('MOCHI_FILES_SAME_PATH', `复制失败：来源和目标相同（${source}）。`);

      await withFs('复制', target, () => copyFile(source, target));
      await afterWrite(guard, target, '复制', () => unlink(target));

      return {
        ok: true,
        操作: '复制文件',
        来源: source,
        目标: target,
        已覆盖: overwritten !== null,
        覆盖说明: overwritten
          ? `目标原本已存在，已按 overwrite: true 覆盖（原大小 ${overwritten.原大小字节} 字节，原修改时间 ${overwritten.原修改时间}）。`
          : '目标原本不存在，没有覆盖任何文件。',
        字节: sourceInfo.size,
        说明: '已用 node:fs copyFile 真实写入目标绝对路径。',
      };
    },

    // ── file_move ──────────────────────────────────────────────────────────
    async move(args = {}, exec) {
      const overwrite = args.overwrite === true;
      const { guard, readOnly } = await guardFor(exec);
      requireWritable(readOnly, '移动文件');
      const { path: source } = await guard.resolve(args.source, { field: '来源路径' });
      const sourceInfo = await statOrNull(source);
      if (!sourceInfo) throw missingFailure('移动', `来源不存在：${source}`);
      if (sourceInfo.isDirectory()) throw toolFailure('MOCHI_FILES_SOURCE_IS_DIRECTORY', `移动失败：${source} 是目录。当前 file_move 只移动文件，不移动整个目录。`, { target: source });

      const { target, overwritten } = await prepareDestination(guard, args.destination, { field: '目标路径', overwrite, action: '移动' });
      if (target === source) throw toolFailure('MOCHI_FILES_SAME_PATH', `移动失败：来源和目标相同（${source}）。`);

      let crossDevice = false;
      try {
        await rename(source, target);
      } catch (error) {
        if (error?.code === 'EXDEV') {
          crossDevice = true;
          await withFs('移动', target, () => copyFile(source, target));
          await withFs('移动', source, () => unlink(source));
        } else {
          throw fsFailure(error, '移动', `${source} → ${target}`);
        }
      }
      await afterWrite(guard, target, '移动', async () => {
        if (crossDevice) await unlink(target).catch(() => {});
        else await rename(target, source).catch(() => {});
      });

      return {
        ok: true,
        操作: '移动文件',
        来源: source,
        目标: target,
        已覆盖: overwritten !== null,
        覆盖说明: overwritten
          ? `目标原本已存在，已按 overwrite: true 覆盖（原大小 ${overwritten.原大小字节}，原修改时间 ${overwritten.原修改时间}）。`
          : '目标原本不存在，没有覆盖任何文件。',
        跨设备回退: crossDevice,
        字节: sourceInfo.size,
        说明: crossDevice
          ? '目标与来源不在同一文件系统，真实回退为「复制后删除来源」。'
          : '来源已被真实移走，原路径不再存在。',
      };
    },

    // ── file_rename ────────────────────────────────────────────────────────
    async renameFile(args = {}, exec) {
      const overwrite = args.overwrite === true;
      const { guard, readOnly } = await guardFor(exec);
      requireWritable(readOnly, '重命名文件');
      const { path: source } = await guard.resolve(args.path, { field: '原路径' });
      const sourceInfo = await statOrNull(source);
      if (!sourceInfo) throw missingFailure('重命名', `原路径不存在：${source}`);

      const newName = String(args.newName ?? '').trim();
      if (!newName) throw toolFailure('MOCHI_FILES_BAD_NAME', 'file_rename 需要 newName：只写新文件名本身，不要带目录。');
      if (newName.includes('/') || newName.includes('\\') || newName.includes('\0') || newName === '.' || newName === '..') {
        throw toolFailure('MOCHI_FILES_BAD_NAME', `重命名失败：newName “${newName}” 只能是文件名本身，不能包含路径分隔符或 . / .. 。`);
      }

      const target = join(dirname(source), newName);
      await guard.resolve(target, { field: '新路径' });
      if (target === source) {
        return { ok: true, 操作: '重命名', 原路径: source, 新路径: target, 已覆盖: false, 说明: '新名称与原名称相同，未做任何改动。' };
      }

      const targetInfo = await statOrNull(target);
      let overwritten = null;
      if (targetInfo) {
        if (targetInfo.isSymbolicLink()) throw toolFailure('MOCHI_FILES_SYMLINK_TARGET', `重命名失败：目标 ${target} 是符号链接，拒绝覆盖。`, { target });
        if (targetInfo.isDirectory()) throw toolFailure('EISDIR', `重命名失败：目标 ${target} 是已存在的目录（EISDIR：目标是目录）。`, { target });
        if (!overwrite) {
          throw toolFailure('MOCHI_FILES_TARGET_EXISTS', `重命名失败：目标 ${target} 已存在。默认不覆盖；确认要覆盖时请显式传 overwrite: true。`, { target });
        }
        overwritten = { 原大小字节: targetInfo.size, 原修改时间: targetInfo.mtime.toISOString() };
      }

      await withFs('重命名', `${source} → ${target}`, () => rename(source, target));
      await afterWrite(guard, target, '重命名', () => rename(target, source));

      return {
        ok: true,
        操作: '重命名',
        原路径: source,
        新路径: target,
        已覆盖: overwritten !== null,
        覆盖说明: overwritten
          ? `目标原本已存在，已按 overwrite: true 覆盖（原大小 ${overwritten.原大小字节}，原修改时间 ${overwritten.原修改时间}）。`
          : '目标原本不存在，没有覆盖任何文件。',
        说明: '在同一目录内真实改名；原路径不再存在。',
      };
    },

    // ── file_create_folder ─────────────────────────────────────────────────
    async createFolder(args = {}, exec) {
      const { guard, readOnly } = await guardFor(exec);
      requireWritable(readOnly, '新建文件夹');
      const { path: target } = await guard.resolve(args.path, { field: '文件夹路径' });
      const recursive = args.recursive !== false;
      const existing = await statOrNull(target);
      if (existing) {
        if (existing.isSymbolicLink()) throw toolFailure('MOCHI_FILES_SYMLINK_TARGET', `新建文件夹失败：${target} 是符号链接，拒绝处理。`, { target });
        if (existing.isDirectory()) {
          return { ok: true, 操作: '新建文件夹', 路径: target, 已创建: false, 说明: '该文件夹已经存在，没有做任何改动。' };
        }
        throw toolFailure('EEXIST', `新建文件夹失败：${target} 已存在且是文件，不是文件夹（EEXIST：目标已存在）。`, { target });
      }

      await withFs('新建文件夹', target, () => mkdir(target, { recursive }));
      await afterWrite(guard, target, '新建文件夹', () => rmdir(target).catch(() => {}));

      return {
        ok: true,
        操作: '新建文件夹',
        路径: target,
        已创建: true,
        递归创建: recursive,
        说明: recursive ? '已按 recursive 真实创建（父目录不存在时会一并创建）。' : '已创建；recursive=false 时父目录必须已存在。',
      };
    },
  };
}
