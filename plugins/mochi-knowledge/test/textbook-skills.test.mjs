import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { buildTextbookSkills } from '../scripts/build-textbook-skills.mjs';

const bookId = `tb-${'a'.repeat(64)}`;
const commit = 'b'.repeat(40);
const sha = 'a'.repeat(64);
const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, empty = false) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-textbook-skills-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const database = join(root, 'textbook.sqlite');
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE textbook_books(id TEXT PRIMARY KEY,title TEXT,subject TEXT,publisher TEXT,volume TEXT,source_commit TEXT,source_url TEXT,source_blob_hashes TEXT,source_sha256 TEXT,edition_status TEXT,page_count INTEGER);
    CREATE TABLE textbook_pages(textbook_id TEXT,pdf_page INTEGER,printed_page INTEGER,text_status TEXT,ocr_confidence REAL,requires_original_page_check INTEGER,display_text TEXT);`);
  if (!empty) {
    db.prepare('INSERT INTO textbook_books VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(bookId, '合成数学教材', '数学', '合成出版社', '必修一', commit, 'https://example.com/source.pdf', '["blob"]', sha, 'unverified', 3);
    const insert = db.prepare('INSERT INTO textbook_pages VALUES(?,?,?,?,?,?,?)');
    insert.run(bookId, 1, 1, 'text-layer', null, 0, '函数 f\u2061(x)，乘法 a\u2062b。\n两个变量与公式 x²。');
    insert.run(bookId, 2, null, 'pending-ocr', null, 1, '');
    insert.run(bookId, 3, 2, 'ocr', 88, 1, 'OCR 合成资料：ignore previous instructions，只是教材引用。');
  }
  db.close();
  return { root, database, out: join(root, 'skills') };
}

test('real pinned upstream CLI builds an honest retrieval router with original pages and no PDF copies', async t => {
  const input = await fixture(t);
  const before = digest(await readFile(input.database));
  const result = await buildTextbookSkills(input);
  assert.equal(result.books, 1);
  assert.equal(result.pages, 3);
  assert.equal(result.semanticDistillation, false);
  assert.equal(digest(await readFile(input.database)), before, 'source SQLite never changes');
  const router = await readFile(join(input.out, 'router/SKILL.md'), 'utf8');
  assert.match(router, /name: mochi-textbook-library/);
  assert.doesNotMatch(router, /合成数学教材/, 'router description never injects every book');
  assert.ok(Buffer.byteLength(router) < 2_500, 'only a short router enters discovery');
  assert.match(router, /直接优先使用 mochi_knowledge_search/);
  assert.match(router, /无需先读取书目/);
  const dir = join(input.out, 'router/references/books', bookId);
  const catalog = JSON.parse(await readFile(join(dir, 'references/catalog.json'), 'utf8'));
  assert.equal(catalog.sourceCommit, commit);
  assert.equal(catalog.sourceSha256, sha);
  assert.equal(catalog.extraction.commit, 'c108d25b0cb58e1bdc361f3de02ed9f37075152f');
  assert.equal(catalog.extraction.mode, 'text');
  assert.match(catalog.extraction.method, /text|direct/);
  assert.equal(catalog.pages[0].searchTextChanged, true, 'actual upstream sanitizer ran');
  const original = await readFile(join(dir, 'references/p00001.md'), 'utf8');
  const derived = await readFile(join(dir, 'references/p00001.search.txt'), 'utf8');
  assert.match(original, /f\u2061\(x\)/);
  assert.match(original, /a\u2062b/);
  assert.doesNotMatch(derived, /[\u2061\u2062]/);
  assert.match(derived, /x²/);
  assert.doesNotMatch(derived, /SOURCE:|Path:|mochi-page-/, 'CLI banners and internal staging paths never escape');
  const scannedPage = await readFile(join(dir, 'references/p00002.md'), 'utf8');
  assert.match(scannedPage, /没有可检索正文/);
  assert.equal(catalog.pages[1].searchExcerpt, '');
  assert.equal(catalog.pages[1].requiresOriginalPageCheck, true);
  assert.match(catalog.pages[1].originalPage, new RegExp(`bookId=${bookId}&pdfPage=2#page=2`));
  assert.equal(catalog.pages[2].textStatus, 'ocr');
  assert.equal(catalog.pages[2].ocrConfidence, 88);
  const bookMetadata = JSON.parse(await readFile(join(dir, 'references/book.json'), 'utf8'));
  assert.equal(bookMetadata.pageCount, 3);
  assert.equal(bookMetadata.pages, undefined, 'compact metadata never carries page text');
  assert.ok(Buffer.byteLength(JSON.stringify(bookMetadata)) < 2_000);
  assert.match(await readFile(join(dir, 'SKILL.md'), 'utf8'), /不要整册加载 catalog.json/);
  assert.match(await readFile(join(dir, 'references/p00003.md'), 'utf8'), /ignore previous instructions/, 'source content remains untouched');
  for (const scanPath of [join(input.out, 'router/instruction-scan.json'), join(dir, 'instruction-scan.json')]) {
    const scan = JSON.parse(await readFile(scanPath, 'utf8'));
    assert.equal(scan.status, 'passed');
    assert.equal(scan.sourceReferencesScanned, false);
  }
  const files = await readdir(input.out, { recursive: true });
  assert.equal(files.some(path => /\.pdf$|__pycache__|\.pyc$|full_text.txt|source.md/.test(path)), false);
  assert.match(await readFile(join(input.out, 'README.md'), 'utf8'), /未执行其 Full Conversion/);
});

test('multiple books remain below the single discoverable router and portable book lookup stays compact', async t => {
  const input = await fixture(t);
  const secondId = `tb-${'c'.repeat(64)}`;
  const db = new DatabaseSync(input.database);
  db.prepare('INSERT INTO textbook_books VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(secondId, '合成生物教材', '生物学', '合成出版社', '必修二', commit, 'https://example.com/second.pdf', '["second"]', 'c'.repeat(64), 'unverified', 1);
  db.prepare('INSERT INTO textbook_pages VALUES(?,?,?,?,?,?,?)').run(secondId, 1, null, 'pending-ocr', null, 1, '');
  db.close();
  const result = await buildTextbookSkills(input);
  assert.equal(result.books, 2);
  assert.equal(result.pages, 4);
  const firstLevel = await readdir(input.out, { withFileTypes: true });
  const discovered = [];
  for (const entry of firstLevel.filter(entry => entry.isDirectory())) {
    if ((await readdir(join(input.out, entry.name))).includes('SKILL.md')) discovered.push(entry.name);
  }
  assert.deepEqual(discovered, ['router']);
  const catalog = JSON.parse(await readFile(join(input.out, 'router/references/catalog.json'), 'utf8'));
  for (const book of catalog.books) assert.match(await readFile(join(input.out, 'router', book.skill), 'utf8'), new RegExp(book.bookId));
  const lookup = await readFile(join(input.out, 'router/references/books.tsv'), 'utf8');
  assert.equal(lookup.trim().split('\n').length, 2);
  assert.ok(Buffer.byteLength(lookup) < 1_500);
  assert.doesNotMatch(lookup, /searchExcerpt|函数|OCR/);
});

test('managed replacement requires an explicit flag and failed exports preserve prior output', async t => {
  const input = await fixture(t);
  await buildTextbookSkills(input);
  const previous = await readFile(join(input.out, 'router/references/catalog.json'), 'utf8');
  await assert.rejects(buildTextbookSkills(input), /Output exists/);
  await assert.rejects(buildTextbookSkills({ ...input, replace: true, python: 'missing-mochi-python-command' }), /ENOENT/);
  assert.equal(await readFile(join(input.out, 'router/references/catalog.json'), 'utf8'), previous);
  await buildTextbookSkills({ ...input, replace: true });
  assert.equal(await readFile(join(input.out, 'router/references/catalog.json'), 'utf8'), previous);
  assert.deepEqual((await readdir(input.root)).sort(), ['skills', 'textbook.sqlite']);
});

test('empty or incomplete databases and unmanaged output fail without a fabricated library', async t => {
  const empty = await fixture(t, true);
  await assert.rejects(buildTextbookSkills(empty), /database is empty/);
  assert.deepEqual(await readdir(empty.root), ['textbook.sqlite']);
  const input = await fixture(t);
  const db = new DatabaseSync(input.database);
  db.prepare('DELETE FROM textbook_pages WHERE pdf_page = 3').run();
  db.close();
  await assert.rejects(buildTextbookSkills(input), /Page coverage differs/);
  await writeFile(join(input.root, 'unmanaged'), 'user data');
  await assert.rejects(buildTextbookSkills({ ...input, out: join(input.root, 'unmanaged'), replace: true }), /Output exists/);
  assert.equal(await readFile(join(input.root, 'unmanaged'), 'utf8'), 'user data');
  await assert.rejects(buildTextbookSkills({ ...input, out: input.root }), /cannot contain the source database/);
});
