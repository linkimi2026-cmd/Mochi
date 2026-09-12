#!/usr/bin/env node
// 只导入审核过的私有教材快照。目标由调用方显式给出，绝不猜测 DSH_HOME。
import { createHash, randomBytes } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_BOOK_COUNT = 33;
export const EXPECTED_PAGE_COUNT = 4_844;

const ROLE_MARKER_FILENAME = '.mochi-runtime-role.json';
const KNOWLEDGE_DIRECTORY = 'knowledge';
const SAFE_SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_BOOK_FILE = /^library\/tb-[a-f0-9]{64}\.pdf$/u;
const SAFE_BOOK_ID = /^tb-[a-f0-9]{64}$/u;
const ALLOWED_ROLES = new Set(['teacher', 'classroom']);
const MAX_MANIFEST_BYTES = 256 * 1024;

export class TextbookSnapshotImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TextbookSnapshotImportError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TextbookSnapshotImportError(code, message);
}

function abortError() {
  return new TextbookSnapshotImportError('IMPORT_CANCELLED', '教材导入已取消，未提交半成品。');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function requiredAbsolutePath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value)) fail('PATH_INVALID', `${label}必须是绝对路径。`);
  return resolve(value);
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function safeChildPath(root, child, label) {
  const candidate = resolve(root, child);
  if (!isInside(root, candidate)) fail('PATH_INVALID', `${label}超出受管目录。`);
  return candidate;
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/** Reject a path when an existing component is a symbolic link/reparse point. */
export async function assertNoSymbolicLinkComponents(path, label) {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  let current = parsed.root;
  const components = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  for (const component of components) {
    current = join(current, component);
    const info = await lstatOrNull(current);
    if (!info) return absolute;
    if (info.isSymbolicLink()) fail('SYMLINK_REJECTED', `${label}不能经过符号链接或重解析点。`);
  }
  return absolute;
}

async function assertPlainDirectory(path, label) {
  await assertNoSymbolicLinkComponents(path, label);
  const info = await lstatOrNull(path);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail('DIRECTORY_INVALID', `${label}不是普通目录。`);
}

async function assertPlainFile(path, label, { allowEmpty = false } = {}) {
  await assertNoSymbolicLinkComponents(path, label);
  const info = await lstatOrNull(path);
  if (!info?.isFile() || info.isSymbolicLink() || (!allowEmpty && info.size < 1)) fail('FILE_INVALID', `${label}不是有效普通文件。`);
  return info;
}

async function sha256File(path, signal) {
  throwIfAborted(signal);
  const hash = createHash('sha256');
  const input = createReadStream(path, { highWaterMark: 1024 * 1024 });
  try {
    for await (const chunk of input) {
      throwIfAborted(signal);
      hash.update(chunk);
    }
  } finally {
    input.destroy();
  }
  return hash.digest('hex');
}

function normalizedManifestPath(value) {
  if (value === 'textbook.sqlite' || SAFE_BOOK_FILE.test(String(value))) return value;
  fail('MANIFEST_INVALID', '教材快照清单包含不受支持的文件路径。');
}

function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('MANIFEST_INVALID', '教材快照清单格式无效。');
  if (raw.schemaVersion !== 1) fail('MANIFEST_INVALID', '教材快照清单版本不受支持。');
  if (raw?.expected?.bookCount !== EXPECTED_BOOK_COUNT || raw?.expected?.pageCount !== EXPECTED_PAGE_COUNT) {
    fail('MANIFEST_INVALID', '教材快照清单的册数或页数与本次交付不一致。');
  }
  if (!Array.isArray(raw.files) || raw.files.length !== EXPECTED_BOOK_COUNT + 1) {
    fail('MANIFEST_INVALID', '教材快照清单的文件数量不正确。');
  }

  const files = raw.files.map((entry) => {
    const path = normalizedManifestPath(entry?.path);
    const sha256 = String(entry?.sha256 || '').toLowerCase();
    if (!SAFE_SHA256.test(sha256)) fail('MANIFEST_INVALID', '教材快照清单包含无效 hash。');
    const bytes = Number(entry?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 1) fail('MANIFEST_INVALID', '教材快照清单包含无效文件大小。');
    return { path, sha256, bytes };
  }).sort((left, right) => left.path.localeCompare(right));

  const unique = new Set(files.map((entry) => entry.path));
  if (unique.size !== files.length || !unique.has('textbook.sqlite')) fail('MANIFEST_INVALID', '教材快照清单包含重复或缺失文件。');
  if (files.filter((entry) => SAFE_BOOK_FILE.test(entry.path)).length !== EXPECTED_BOOK_COUNT) {
    fail('MANIFEST_INVALID', '教材快照清单的教材 PDF 数量不正确。');
  }
  return Object.freeze({
    schemaVersion: 1,
    expected: Object.freeze({ bookCount: EXPECTED_BOOK_COUNT, pageCount: EXPECTED_PAGE_COUNT }),
    files: Object.freeze(files.map((entry) => Object.freeze(entry))),
  });
}

async function readManifest(manifestPath) {
  const info = await assertPlainFile(manifestPath, '教材快照清单');
  if (info.size > MAX_MANIFEST_BYTES) fail('MANIFEST_INVALID', '教材快照清单过大。');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    fail('MANIFEST_INVALID', '教材快照清单无法读取。');
  }
  return validateManifest(parsed);
}

async function listSnapshotFiles(snapshotRoot) {
  const files = [];
  async function visit(directory, prefix = '') {
    await assertPlainDirectory(directory, '教材快照目录');
    const names = await readdir(directory);
    for (const name of names) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const path = safeChildPath(snapshotRoot, relativePath, '教材快照文件');
      const info = await lstatOrNull(path);
      if (!info || info.isSymbolicLink()) fail('SYMLINK_REJECTED', '教材快照不能包含符号链接或重解析点。');
      if (info.isDirectory()) {
        await visit(path, relativePath);
      } else if (info.isFile()) {
        files.push({ path: relativePath, bytes: info.size });
      } else {
        fail('SNAPSHOT_INVALID', '教材快照包含不受支持的文件类型。');
      }
    }
  }
  await visit(snapshotRoot);
  return files.sort((left, right) => left.path.localeCompare(right));
}

function assertSnapshotFileSet(files) {
  if (files.length !== EXPECTED_BOOK_COUNT + 1) fail('SNAPSHOT_INVALID', '教材快照必须恰好包含一个索引和 33 本教材。');
  const names = new Set(files.map((entry) => entry.path));
  if (!names.has('textbook.sqlite')) fail('SNAPSHOT_INVALID', '教材快照缺少索引文件。');
  if (files.filter((entry) => SAFE_BOOK_FILE.test(entry.path)).length !== EXPECTED_BOOK_COUNT) {
    fail('SNAPSHOT_INVALID', '教材快照包含不受支持的文件布局。');
  }
  for (const entry of files) normalizedManifestPath(entry.path);
}

function inspectDatabase(databasePath) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const counts = database.prepare(`SELECT
      (SELECT COUNT(*) FROM textbook_books) AS book_count,
      (SELECT COUNT(*) FROM textbook_pages) AS page_count,
      (SELECT COALESCE(SUM(page_count), 0) FROM textbook_books) AS declared_page_count
    `).get();
    if (Number(counts?.book_count) !== EXPECTED_BOOK_COUNT
      || Number(counts?.page_count) !== EXPECTED_PAGE_COUNT
      || Number(counts?.declared_page_count) !== EXPECTED_PAGE_COUNT) {
      fail('DATABASE_INVALID', '教材索引的册数或页数与交付清单不一致。');
    }

    const rows = database.prepare(`SELECT b.id, b.library_file, b.page_count,
      (SELECT COUNT(*) FROM textbook_pages p WHERE p.textbook_id = b.id) AS indexed_page_count
      FROM textbook_books b ORDER BY b.id`).all();
    const libraryFiles = new Set();
    for (const row of rows) {
      if (!SAFE_BOOK_ID.test(String(row.id)) || !SAFE_BOOK_FILE.test(`library/${String(row.library_file)}`)) {
        fail('DATABASE_INVALID', '教材索引包含不受支持的教材标识。');
      }
      if (Number(row.page_count) !== Number(row.indexed_page_count) || !libraryFiles.add(String(row.library_file))) {
        fail('DATABASE_INVALID', '教材索引的页码或文件关联不完整。');
      }
    }
    if (libraryFiles.size !== EXPECTED_BOOK_COUNT) fail('DATABASE_INVALID', '教材索引的文件数量不正确。');
    return { bookCount: Number(counts.book_count), pageCount: Number(counts.page_count), libraryFiles };
  } catch (error) {
    if (error instanceof TextbookSnapshotImportError) throw error;
    fail('DATABASE_INVALID', '教材索引无法验证。');
  } finally {
    try { database?.close(); } catch { /* The prior validation error is authoritative. */ }
  }
}

async function inspectSnapshotRoot(snapshotRoot, signal) {
  await assertPlainDirectory(snapshotRoot, '教材快照根目录');
  const files = await listSnapshotFiles(snapshotRoot);
  assertSnapshotFileSet(files);
  throwIfAborted(signal);
  const database = inspectDatabase(safeChildPath(snapshotRoot, 'textbook.sqlite', '教材索引'));
  const librarySet = new Set(files.filter((entry) => SAFE_BOOK_FILE.test(entry.path)).map((entry) => entry.path.slice('library/'.length)));
  if (librarySet.size !== database.libraryFiles.size || [...librarySet].some((name) => !database.libraryFiles.has(name))) {
    fail('DATABASE_INVALID', '教材索引与教材文件集合不一致。');
  }
  return { files, database };
}

/** Build a deterministic, non-secret manifest for a vetted private snapshot. */
export async function createSnapshotManifest({ snapshotRoot, signal } = {}) {
  const root = requiredAbsolutePath(snapshotRoot, '教材快照根目录');
  const { files } = await inspectSnapshotRoot(root, signal);
  const entries = [];
  for (const file of files) {
    throwIfAborted(signal);
    const path = safeChildPath(root, file.path, '教材快照文件');
    await assertPlainFile(path, '教材快照文件');
    entries.push({ path: file.path, bytes: file.bytes, sha256: await sha256File(path, signal) });
  }
  return validateManifest({
    schemaVersion: 1,
    expected: { bookCount: EXPECTED_BOOK_COUNT, pageCount: EXPECTED_PAGE_COUNT },
    files: entries,
  });
}

/** Verify hashes, layout and the database before a snapshot is allowed into a user home. */
export async function verifySnapshot({ snapshotRoot, manifestPath, signal } = {}) {
  const root = requiredAbsolutePath(snapshotRoot, '教材快照根目录');
  const manifest = await readManifest(requiredAbsolutePath(manifestPath, '教材快照清单'));
  const { files, database } = await inspectSnapshotRoot(root, signal);
  const actual = new Map(files.map((entry) => [entry.path, entry]));
  for (const entry of manifest.files) {
    throwIfAborted(signal);
    const source = actual.get(entry.path);
    if (!source || source.bytes !== entry.bytes) fail('HASH_MISMATCH', '教材快照文件大小校验失败。');
    const path = safeChildPath(root, entry.path, '教材快照文件');
    await assertPlainFile(path, '教材快照文件');
    if (await sha256File(path, signal) !== entry.sha256) fail('HASH_MISMATCH', '教材快照文件 hash 校验失败。');
  }
  if (actual.size !== manifest.files.length) fail('SNAPSHOT_INVALID', '教材快照的文件集合不一致。');
  return Object.freeze({ manifest, bookCount: database.bookCount, pageCount: database.pageCount, fileCount: manifest.files.length });
}

async function readRoleMarker(targetHome, expectedRole) {
  if (!ALLOWED_ROLES.has(expectedRole)) fail('ROLE_INVALID', '导入目标角色无效。');
  await assertPlainDirectory(targetHome, 'Mochi 运行目录');
  const markerPath = safeChildPath(targetHome, ROLE_MARKER_FILENAME, 'Mochi 角色元数据');
  await assertPlainFile(markerPath, 'Mochi 角色元数据');
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    fail('ROLE_MARKER_INVALID', 'Mochi 运行角色元数据无法读取。');
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)
    || marker.schemaVersion !== 1 || !ALLOWED_ROLES.has(marker.role)) {
    fail('ROLE_MARKER_INVALID', 'Mochi 运行角色元数据无效。');
  }
  if (marker.role !== expectedRole) fail('ROLE_MISMATCH', '所选教师或教室与该 Mochi 运行目录不一致，未导入。');
}

function inspectEmptyKnowledgeDatabase(databasePath) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    const counts = database.prepare(`SELECT
      (SELECT COUNT(*) FROM textbook_books) AS book_count,
      (SELECT COUNT(*) FROM textbook_pages) AS page_count
    `).get();
    if (tables.length !== 2 || tables[0] !== 'textbook_books' || tables[1] !== 'textbook_pages'
      || Number(counts?.book_count) !== 0 || Number(counts?.page_count) !== 0) {
      fail('TARGET_NONEMPTY', '检测到已有非空教材库，为保护现有内容，未覆盖。');
    }
  } catch (error) {
    if (error instanceof TextbookSnapshotImportError) throw error;
    fail('TARGET_NONEMPTY', '检测到无法确认的已有教材库，为保护现有内容，未覆盖。');
  } finally {
    try { database?.close(); } catch { /* The prior validation error is authoritative. */ }
  }
}

function assertNoActiveDatabaseTransaction(databasePath) {
  let database;
  try {
    database = new DatabaseSync(databasePath);
    database.exec('PRAGMA busy_timeout = 0;');
    database.exec('BEGIN EXCLUSIVE;');
    database.exec('ROLLBACK;');
  } catch {
    try { database?.exec('ROLLBACK;'); } catch { /* no transaction to roll back */ }
    fail('TARGET_BUSY', '请先完全退出 Mochi，确认教材库未被使用后再导入。');
  } finally {
    try { database?.close(); } catch { /* The caller already receives the actionable lock error. */ }
  }
}

async function classifyTarget(targetPath) {
  const info = await lstatOrNull(targetPath);
  if (!info) return Object.freeze({ kind: 'absent' });
  await assertNoSymbolicLinkComponents(targetPath, '教材目标目录');
  if (!info.isDirectory() || info.isSymbolicLink()) fail('TARGET_EXISTS', '教材目标路径已存在但不是普通目录，未导入。');
  const entries = await readdir(targetPath);
  const allowed = new Set(['textbook.sqlite', 'textbook.sqlite-shm', 'textbook.sqlite-wal', 'library']);
  if (entries.some((entry) => !allowed.has(entry)) || !entries.includes('textbook.sqlite') || !entries.includes('library')) {
    fail('TARGET_NONEMPTY', '检测到已有非空教材库，为保护现有内容，未覆盖。');
  }
  const databasePath = safeChildPath(targetPath, 'textbook.sqlite', '教材目标索引');
  const libraryPath = safeChildPath(targetPath, 'library', '教材目标目录');
  await assertPlainFile(databasePath, '教材目标索引');
  await assertPlainDirectory(libraryPath, '教材目标目录');
  if ((await readdir(libraryPath)).length > 0) fail('TARGET_NONEMPTY', '检测到已有非空教材库，为保护现有内容，未覆盖。');
  for (const transient of ['textbook.sqlite-shm', 'textbook.sqlite-wal']) {
    const path = safeChildPath(targetPath, transient, '教材目标索引临时文件');
    if (await lstatOrNull(path)) await assertPlainFile(path, '教材目标索引临时文件', { allowEmpty: true });
  }
  inspectEmptyKnowledgeDatabase(databasePath);
  return Object.freeze({ kind: 'pristine-empty', databasePath });
}

async function removeStaging(path) {
  const info = await lstatOrNull(path);
  if (!info) return;
  if (info.isSymbolicLink()) {
    await rm(path, { force: true });
    return;
  }
  await rm(path, { recursive: true, force: true, maxRetries: 2 });
}

async function copyVerifiedFile({ sourceRoot, stagingRoot, entry, signal, onFileCopied }) {
  throwIfAborted(signal);
  const source = safeChildPath(sourceRoot, entry.path, '教材快照文件');
  const destination = safeChildPath(stagingRoot, entry.path, '教材临时文件');
  await assertPlainFile(source, '教材快照文件');
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await assertNoSymbolicLinkComponents(dirname(destination), '教材临时目录');
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await assertPlainFile(destination, '教材临时文件');
  if (await sha256File(destination, signal) !== entry.sha256) fail('HASH_MISMATCH', '教材临时文件 hash 校验失败。');
  await onFileCopied?.(entry);
}

/**
 * Atomically copies a verified snapshot into an explicit role-bound Mochi home.
 * The staging directory is a sibling of `knowledge`, so the final rename stays
 * on the same volume and an interruption cannot expose a half-finished library.
 */
export async function installTextbookSnapshot({ snapshotRoot, manifestPath, targetHome, role, signal, onFileCopied } = {}) {
  const sourceRoot = requiredAbsolutePath(snapshotRoot, '教材快照根目录');
  const home = requiredAbsolutePath(targetHome, 'Mochi 运行目录');
  await readRoleMarker(home, role);
  const verified = await verifySnapshot({ snapshotRoot: sourceRoot, manifestPath, signal });
  const target = safeChildPath(home, KNOWLEDGE_DIRECTORY, '教材目标目录');
  const initialTarget = await classifyTarget(target);

  const staging = safeChildPath(home, `.mochi-knowledge-import-${randomBytes(12).toString('hex')}`, '教材临时目录');
  let committed = false;
  let backupRetained = false;
  try {
    await mkdir(staging, { mode: 0o700 });
    await assertPlainDirectory(staging, '教材临时目录');
    const [homeStat, stagingStat] = await Promise.all([stat(home), stat(staging)]);
    if (homeStat.dev !== stagingStat.dev) fail('STAGING_VOLUME_INVALID', '教材临时目录不在目标运行目录所在卷，未导入。');

    for (const entry of verified.manifest.files) {
      await copyVerifiedFile({ sourceRoot, stagingRoot: staging, entry, signal, onFileCopied });
    }
    throwIfAborted(signal);
    const staged = await verifySnapshot({ snapshotRoot: staging, manifestPath, signal });
    if (staged.bookCount !== EXPECTED_BOOK_COUNT || staged.pageCount !== EXPECTED_PAGE_COUNT) {
      fail('DATABASE_INVALID', '教材临时索引校验失败。');
    }
    const currentTarget = await classifyTarget(target);
    if (currentTarget.kind !== initialTarget.kind) fail('TARGET_CHANGED', '教材目标目录在导入期间发生变化，未导入。');
    if (currentTarget.kind === 'pristine-empty') {
      // This can reject an active transaction but cannot prove an idle Mochi
      // process is gone, so the double-click launcher must explicitly tell the
      // user to quit Mochi before it invokes this importer.
      assertNoActiveDatabaseTransaction(currentTarget.databasePath);
      const backup = safeChildPath(home, `knowledge-empty-before-import-${randomBytes(12).toString('hex')}`, '教材空库备份目录');
      await rename(target, backup);
      try {
        await rename(staging, target);
        backupRetained = true;
      } catch (error) {
        try {
          if (!await lstatOrNull(target)) await rename(backup, target);
        } catch {
          throw new TextbookSnapshotImportError('TARGET_RESTORE_FAILED', '教材导入未完成，原有空教材库备份需要人工恢复。');
        }
        throw error;
      }
    } else {
      await rename(staging, target);
    }
    committed = true;
    return Object.freeze({
      status: 'imported',
      role,
      bookCount: staged.bookCount,
      pageCount: staged.pageCount,
      fileCount: staged.fileCount,
      replacedPristineEmptyLibrary: initialTarget.kind === 'pristine-empty',
      emptyLibraryBackupRetained: backupRetained,
    });
  } finally {
    if (!committed) await removeStaging(staging);
  }
}

async function writeManifest(snapshotRoot, manifestPath, signal) {
  const output = requiredAbsolutePath(manifestPath, '教材快照清单输出路径');
  await assertNoSymbolicLinkComponents(dirname(output), '教材快照清单输出目录');
  await assertPlainDirectory(dirname(output), '教材快照清单输出目录');
  if (await lstatOrNull(output)) fail('MANIFEST_EXISTS', '教材快照清单输出路径已存在。');
  const manifest = await createSnapshotManifest({ snapshotRoot, signal });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return manifest;
}

function parseArgs(argv) {
  const values = {};
  let createManifest = false;
  const names = new Set(['--snapshot', '--manifest', '--target-home', '--role']);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--create-manifest') {
      if (createManifest) fail('ARGUMENT_INVALID', '参数 --create-manifest 不能重复。');
      createManifest = true;
      continue;
    }
    if (!names.has(name) || values[name]) fail('ARGUMENT_INVALID', `参数 ${name} 无效或重复。`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('ARGUMENT_INVALID', `参数 ${name} 缺少值。`);
    values[name] = value;
    index += 1;
  }
  if (!values['--snapshot'] || !values['--manifest']) fail('ARGUMENT_INVALID', '必须指定教材快照和清单。');
  if (!createManifest && (!values['--target-home'] || !values['--role'])) {
    fail('ARGUMENT_INVALID', '导入必须显式指定目标 Mochi 运行目录和教师/教室角色。');
  }
  return { createManifest, snapshotRoot: values['--snapshot'], manifestPath: values['--manifest'], targetHome: values['--target-home'], role: values['--role'] };
}

function publicFailureMessage(error) {
  if (error?.code === 'IMPORT_CANCELLED') return '教材导入已取消，未提交半成品。';
  if (error?.code === 'TARGET_NONEMPTY') return '检测到已有非空教材库，为保护现有内容，未覆盖。';
  if (error?.code === 'ROLE_MISMATCH') return '所选教师或教室与该 Mochi 运行目录不一致，未导入。';
  if (error instanceof TextbookSnapshotImportError) return `教材导入失败：${error.message}`;
  return '教材导入失败：无法完成受管教材库校验。';
}

export async function runCli(argv = process.argv.slice(2)) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const args = parseArgs(argv);
    if (args.createManifest) {
      const manifest = await writeManifest(args.snapshotRoot, args.manifestPath, controller.signal);
      process.stdout.write(`${JSON.stringify({ status: 'manifest-created', fileCount: manifest.files.length, bookCount: EXPECTED_BOOK_COUNT, pageCount: EXPECTED_PAGE_COUNT })}\n`);
      return 0;
    }
    const result = await installTextbookSnapshot({ ...args, signal: controller.signal });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${publicFailureMessage(error)}\n`);
    return error?.code === 'IMPORT_CANCELLED' ? 130 : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = await runCli();
}
