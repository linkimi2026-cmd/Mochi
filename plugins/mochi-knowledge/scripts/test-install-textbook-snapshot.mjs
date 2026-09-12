#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import test from 'node:test';
import {
  EXPECTED_BOOK_COUNT,
  EXPECTED_PAGE_COUNT,
  TextbookSnapshotImportError,
  createSnapshotManifest,
  installTextbookSnapshot,
} from './install-textbook-snapshot.mjs';
import { buildPrivateTextbookSnapshot } from './build-private-textbook-snapshot.mjs';
import { openKnowledgeStore } from '../knowledge-store.mjs';

const TEST_ROOT = mkdtempSync('/private/tmp/mochi-textbook-import-test-');

function bookHash(index) {
  return index.toString(16).padStart(64, '0');
}

function pageCountFor(index) {
  return index === 0 ? 172 : 146;
}

function buildFixture(name, role = 'teacher') {
  const root = join(TEST_ROOT, `${name}-${randomBytes(5).toString('hex')}`);
  const snapshot = join(root, 'snapshot');
  const library = join(snapshot, 'library');
  const home = join(root, 'home');
  const manifestPath = join(root, 'snapshot-manifest.json');
  mkdirSync(library, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, '.mochi-runtime-role.json'), `${JSON.stringify({ schemaVersion: 1, role })}\n`);

  const database = new DatabaseSync(join(snapshot, 'textbook.sqlite'));
  database.exec(`CREATE TABLE textbook_books (id TEXT PRIMARY KEY, library_file TEXT NOT NULL, page_count INTEGER NOT NULL);
    CREATE TABLE textbook_pages (textbook_id TEXT NOT NULL, pdf_page INTEGER NOT NULL);`);
  const insertBook = database.prepare('INSERT INTO textbook_books (id, library_file, page_count) VALUES (?, ?, ?)');
  const insertPage = database.prepare('INSERT INTO textbook_pages (textbook_id, pdf_page) VALUES (?, ?)');
  for (let index = 0; index < EXPECTED_BOOK_COUNT; index += 1) {
    const hash = bookHash(index);
    const id = `tb-${hash}`;
    const file = `tb-${hash}.pdf`;
    const pages = pageCountFor(index);
    writeFileSync(join(library, file), `fixture-pdf-${index}\n`);
    insertBook.run(id, file, pages);
    for (let page = 1; page <= pages; page += 1) insertPage.run(id, page);
  }
  database.close();
  return { root, snapshot, home, manifestPath };
}

async function writeManifest(fixture) {
  const manifest = await createSnapshotManifest({ snapshotRoot: fixture.snapshot });
  writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof TextbookSnapshotImportError && error.code === code);
}

test.after(() => rmSync(TEST_ROOT, { recursive: true, force: true }));

test('imports the complete fixed snapshot into an explicit teacher home', async () => {
  const fixture = buildFixture('success');
  await writeManifest(fixture);
  const result = await installTextbookSnapshot({
    snapshotRoot: fixture.snapshot,
    manifestPath: fixture.manifestPath,
    targetHome: fixture.home,
    role: 'teacher',
  });
  assert.deepEqual(result, {
    status: 'imported',
    role: 'teacher',
    bookCount: EXPECTED_BOOK_COUNT,
    pageCount: EXPECTED_PAGE_COUNT,
    fileCount: EXPECTED_BOOK_COUNT + 1,
    replacedPristineEmptyLibrary: false,
    emptyLibraryBackupRetained: false,
  });
  assert.equal(existsSync(join(fixture.home, 'knowledge', 'textbook.sqlite')), true);
  assert.equal(readdirSync(join(fixture.home, 'knowledge', 'library')).length, EXPECTED_BOOK_COUNT);
});

test('creates a standalone private delivery snapshot without SQLite sidecars', async () => {
  const fixture = buildFixture('build-private-snapshot');
  const output = join(fixture.root, 'Mochi-private-knowledge');
  const result = await buildPrivateTextbookSnapshot({ sourceRoot: fixture.snapshot, outputRoot: output });
  assert.deepEqual(result, {
    status: 'snapshot-built', bookCount: EXPECTED_BOOK_COUNT, pageCount: EXPECTED_PAGE_COUNT, fileCount: EXPECTED_BOOK_COUNT + 1,
  });
  assert.deepEqual(readdirSync(join(output, 'knowledge')).sort(), ['library', 'textbook.sqlite']);
  assert.equal(readdirSync(join(output, 'knowledge', 'library')).length, EXPECTED_BOOK_COUNT);
  assert.equal(existsSync(join(output, 'textbook-snapshot-manifest.json')), true);
});

test('rejects a manifest hash mismatch without creating a knowledge target', async () => {
  const fixture = buildFixture('hash-mismatch');
  const manifest = await writeManifest(fixture);
  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.files[0].sha256 = '0'.repeat(64);
  writeFileSync(fixture.manifestPath, `${JSON.stringify(tampered, null, 2)}\n`);
  await expectCode(installTextbookSnapshot({
    snapshotRoot: fixture.snapshot,
    manifestPath: fixture.manifestPath,
    targetHome: fixture.home,
    role: 'teacher',
  }), 'HASH_MISMATCH');
  assert.equal(existsSync(join(fixture.home, 'knowledge')), false);
});

test('does not overwrite an existing nonempty library', async () => {
  const fixture = buildFixture('existing-library');
  await writeManifest(fixture);
  const existing = join(fixture.home, 'knowledge');
  mkdirSync(existing);
  writeFileSync(join(existing, 'keep.txt'), 'existing user library\n');
  await expectCode(installTextbookSnapshot({
    snapshotRoot: fixture.snapshot,
    manifestPath: fixture.manifestPath,
    targetHome: fixture.home,
    role: 'teacher',
  }), 'TARGET_NONEMPTY');
  assert.equal(existsSync(join(existing, 'keep.txt')), true);
});

test('rejects a target whose actual marker binds the other role', async () => {
  const fixture = buildFixture('role-mismatch', 'classroom');
  await writeManifest(fixture);
  await expectCode(installTextbookSnapshot({
    snapshotRoot: fixture.snapshot,
    manifestPath: fixture.manifestPath,
    targetHome: fixture.home,
    role: 'teacher',
  }), 'ROLE_MISMATCH');
  assert.equal(existsSync(join(fixture.home, 'knowledge')), false);
});

test('replaces only the real zero-book library created by openKnowledgeStore and retains its backup', async () => {
  const fixture = buildFixture('pristine-library');
  await writeManifest(fixture);
  const pristinePath = join(fixture.home, 'knowledge');
  const pristine = openKnowledgeStore({ dataRoot: pristinePath });
  pristine.close();
  assert.equal(existsSync(join(pristinePath, 'textbook.sqlite')), true, 'the product creates its empty index before first import');
  assert.equal(existsSync(join(pristinePath, 'library')), true, 'the product creates its empty library before first import');

  const result = await installTextbookSnapshot({
    snapshotRoot: fixture.snapshot,
    manifestPath: fixture.manifestPath,
    targetHome: fixture.home,
    role: 'teacher',
  });
  assert.equal(result.replacedPristineEmptyLibrary, true);
  assert.equal(result.emptyLibraryBackupRetained, true);
  const backups = readdirSync(fixture.home).filter((name) => name.startsWith('knowledge-empty-before-import-'));
  assert.equal(backups.length, 1, 'the former empty index is retained for recovery rather than deleted');
  const backup = new DatabaseSync(join(fixture.home, backups[0], 'textbook.sqlite'), { readOnly: true });
  assert.equal(Number(backup.prepare('SELECT COUNT(*) AS count FROM textbook_books').get().count), 0);
  backup.close();
  assert.equal(readdirSync(join(pristinePath, 'library')).length, EXPECTED_BOOK_COUNT);
});

test('refuses to replace a pristine library while its SQLite database has an active exclusive transaction', async () => {
  const fixture = buildFixture('busy-library');
  await writeManifest(fixture);
  const pristine = openKnowledgeStore({ dataRoot: join(fixture.home, 'knowledge') });
  pristine.close();
  const locked = new DatabaseSync(join(fixture.home, 'knowledge', 'textbook.sqlite'));
  locked.exec('BEGIN EXCLUSIVE;');
  try {
    await expectCode(installTextbookSnapshot({
      snapshotRoot: fixture.snapshot,
      manifestPath: fixture.manifestPath,
      targetHome: fixture.home,
      role: 'teacher',
    }), 'TARGET_BUSY');
  } finally {
    locked.exec('ROLLBACK;');
    locked.close();
  }
  assert.equal(existsSync(join(fixture.home, 'knowledge', 'textbook.sqlite')), true);
  assert.equal(existsSync(join(fixture.home, 'knowledge', 'library')), true);
});

test('cancels before commit and removes only its private staging directory', async () => {
  const fixture = buildFixture('cancel');
  await writeManifest(fixture);
  const controller = new AbortController();
  await expectCode(installTextbookSnapshot({
    snapshotRoot: fixture.snapshot,
    manifestPath: fixture.manifestPath,
    targetHome: fixture.home,
    role: 'teacher',
    signal: controller.signal,
    onFileCopied() { controller.abort(); },
  }), 'IMPORT_CANCELLED');
  assert.equal(existsSync(join(fixture.home, 'knowledge')), false);
  assert.equal(readdirSync(fixture.home).some((name) => name.startsWith('.mochi-knowledge-import-')), false);
});

test('rejects a symbolic-link snapshot file before it can enter a user home', async () => {
  const fixture = buildFixture('symlink');
  await writeManifest(fixture);
  const source = join(fixture.snapshot, 'library', `tb-${bookHash(0)}.pdf`);
  const target = join(fixture.root, 'outside.pdf');
  writeFileSync(target, 'outside\n');
  rmSync(source);
  symlinkSync(target, source);
  await expectCode(installTextbookSnapshot({
    snapshotRoot: fixture.snapshot,
    manifestPath: fixture.manifestPath,
    targetHome: fixture.home,
    role: 'teacher',
  }), 'SYMLINK_REJECTED');
  assert.equal(lstatSync(source).isSymbolicLink(), true);
  assert.equal(existsSync(join(fixture.home, 'knowledge')), false);
});
