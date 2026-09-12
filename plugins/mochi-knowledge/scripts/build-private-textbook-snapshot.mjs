#!/usr/bin/env node
// 从只读审计根制作可分发的私有教材快照；不会修改输入根，也不会把 SQLite sidecar 带入交付物。
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_BOOK_COUNT,
  TextbookSnapshotImportError,
  createSnapshotManifest,
} from './install-textbook-snapshot.mjs';

const SAFE_LIBRARY_FILE = /^tb-[a-f0-9]{64}\.pdf$/u;

function fail(code, message) {
  throw new TextbookSnapshotImportError(code, message);
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

async function assertNoSymbolicLinkComponents(path, label) {
  const absolute = resolve(path);
  const parsed = parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    const info = await lstatOrNull(current);
    if (!info) return;
    if (info.isSymbolicLink()) fail('SYMLINK_REJECTED', `${label}不能经过符号链接或重解析点。`);
  }
}

async function assertDirectory(path, label) {
  await assertNoSymbolicLinkComponents(path, label);
  const info = await lstatOrNull(path);
  if (!info?.isDirectory() || info.isSymbolicLink()) fail('DIRECTORY_INVALID', `${label}不是普通目录。`);
}

async function assertFile(path, label, { allowEmpty = false } = {}) {
  await assertNoSymbolicLinkComponents(path, label);
  const info = await lstatOrNull(path);
  if (!info?.isFile() || info.isSymbolicLink() || (!allowEmpty && info.size < 1)) fail('FILE_INVALID', `${label}不是有效普通文件。`);
  return info;
}

async function listSourceLibrary(sourceRoot) {
  const library = safeChildPath(sourceRoot, 'library', '教材源库');
  await assertDirectory(library, '教材源库');
  const names = (await readdir(library)).sort();
  if (names.length !== EXPECTED_BOOK_COUNT || names.some((name) => !SAFE_LIBRARY_FILE.test(name))) {
    fail('SNAPSHOT_INVALID', '教材源库不包含本次交付所需的 33 本教材。');
  }
  for (const name of names) await assertFile(safeChildPath(library, name, '教材源文件'), '教材源文件');
  return names;
}

async function assertSourceLayout(sourceRoot) {
  await assertDirectory(sourceRoot, '教材源根目录');
  const entries = await readdir(sourceRoot);
  const allowed = new Set(['textbook.sqlite', 'textbook.sqlite-shm', 'textbook.sqlite-wal', 'library']);
  if (entries.some((entry) => !allowed.has(entry)) || !entries.includes('textbook.sqlite') || !entries.includes('library')) {
    fail('SNAPSHOT_INVALID', '教材源根目录包含不受支持的文件布局。');
  }
  await assertFile(safeChildPath(sourceRoot, 'textbook.sqlite', '教材源索引'), '教材源索引');
  for (const sidecar of ['textbook.sqlite-shm', 'textbook.sqlite-wal']) {
    const path = safeChildPath(sourceRoot, sidecar, '教材源索引临时文件');
    if (await lstatOrNull(path)) await assertFile(path, '教材源索引临时文件', { allowEmpty: true });
  }
  return listSourceLibrary(sourceRoot);
}

async function copyLibrary(sourceRoot, stagingRoot, names) {
  const sourceLibrary = safeChildPath(sourceRoot, 'library', '教材源库');
  const destinationLibrary = safeChildPath(stagingRoot, 'library', '教材临时库');
  await mkdir(destinationLibrary, { recursive: true, mode: 0o700 });
  for (const name of names) {
    const source = safeChildPath(sourceLibrary, name, '教材源文件');
    const destination = safeChildPath(destinationLibrary, name, '教材临时文件');
    await assertFile(source, '教材源文件');
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    await assertFile(destination, '教材临时文件');
  }
}

async function vacuumDatabase(sourcePath, destinationPath) {
  let database;
  try {
    // `VACUUM INTO` creates one consistent standalone database that includes
    // committed WAL content without mutating the read-only audit source.
    database = new DatabaseSync(sourcePath, { readOnly: true });
    database.prepare('VACUUM INTO ?').run(destinationPath);
  } catch {
    fail('DATABASE_SNAPSHOT_FAILED', '教材索引无法生成一致性快照。');
  } finally {
    try { database?.close(); } catch { /* The prior snapshot failure is authoritative. */ }
  }
}

async function removeStaging(path) {
  const info = await lstatOrNull(path);
  if (!info) return;
  await rm(path, { recursive: true, force: true, maxRetries: 2 });
}

/**
 * Builds `<outputRoot>/{knowledge,textbook-snapshot-manifest.json}` atomically.
 * `knowledge` itself remains exactly `textbook.sqlite + library/`.
 */
export async function buildPrivateTextbookSnapshot({ sourceRoot, outputRoot } = {}) {
  const source = requiredAbsolutePath(sourceRoot, '教材源根目录');
  const output = requiredAbsolutePath(outputRoot, '私有教材交付目录');
  const parent = dirname(output);
  await assertDirectory(parent, '私有教材交付父目录');
  if (await lstatOrNull(output)) fail('OUTPUT_EXISTS', '私有教材交付目录已存在，未覆盖。');
  const sourceLibraryNames = await assertSourceLayout(source);
  const staging = join(parent, `.${basename(output)}.staging-${randomBytes(12).toString('hex')}`);
  let committed = false;
  try {
    await mkdir(staging, { mode: 0o700 });
    const knowledge = safeChildPath(staging, 'knowledge', '教材临时快照');
    await mkdir(knowledge, { mode: 0o700 });
    await vacuumDatabase(
      safeChildPath(source, 'textbook.sqlite', '教材源索引'),
      safeChildPath(knowledge, 'textbook.sqlite', '教材临时索引'),
    );
    await copyLibrary(source, knowledge, sourceLibraryNames);
    const manifest = await createSnapshotManifest({ snapshotRoot: knowledge });
    await writeFile(
      safeChildPath(staging, 'textbook-snapshot-manifest.json', '教材快照清单'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
    await rename(staging, output);
    committed = true;
    return Object.freeze({
      status: 'snapshot-built',
      bookCount: manifest.expected.bookCount,
      pageCount: manifest.expected.pageCount,
      fileCount: manifest.files.length,
    });
  } finally {
    if (!committed) await removeStaging(staging);
  }
}

function parseArgs(argv) {
  const values = {};
  const names = new Set(['--source-root', '--output-root']);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!names.has(name) || values[name]) fail('ARGUMENT_INVALID', `参数 ${name} 无效或重复。`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('ARGUMENT_INVALID', `参数 ${name} 缺少值。`);
    values[name] = value;
    index += 1;
  }
  if (!values['--source-root'] || !values['--output-root']) fail('ARGUMENT_INVALID', '必须指定教材源根和私有交付目录。');
  return { sourceRoot: values['--source-root'], outputRoot: values['--output-root'] };
}

export async function runCli(argv = process.argv.slice(2)) {
  try {
    const result = await buildPrivateTextbookSnapshot(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof TextbookSnapshotImportError ? error.message : '无法生成私有教材快照。';
    process.stderr.write(`私有教材快照生成失败：${message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await runCli();
}
