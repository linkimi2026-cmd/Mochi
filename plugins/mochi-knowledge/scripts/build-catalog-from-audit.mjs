#!/usr/bin/env node
// 从一次性本地审计清单生成可导入目录。目录可含本机源路径，但不应提交到公共仓库。
import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const DEFAULT_SOURCE_COMMIT = '5a80345f2043ba6f8db8d7be9cf3db82725ff1f7';
const SOURCE_REPOSITORY = 'TapXWorld/ChinaTextbook';
const SHA1 = /^[a-f0-9]{40}$/iu;
const SCANNED_BOOK_BLOBS = new Set([
  '1056658c7e00ca65d45e72e523ba86da18eb93ec',
  'a490fc9635c32a54ee0d33a174566d439b801b22',
  'e424c1fea515659554974dc9e702afbbd9765490',
  '25c7094a9086374c36bb6c95466b7241df83d15f',
  'cf98770c0f7c7a3b01b827d236b3a280fa023065',
]);
const SPLIT_PARTS = new Map([
  ['1056658c7e00ca65d45e72e523ba86da18eb93ec', {
    sourceBlobSha: '4eb0af4fe90137c7c129ca0917ee99db88685330',
    fileName: '4eb0af4fe90137c7c129ca0917ee99db88685330.part',
  }],
]);

function usage(message = '') {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write('用法: node build-catalog-from-audit.mjs --audit <read-audit.json> --out <catalog.json> [--source-commit <40位SHA>]\n');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || !['--audit', '--out', '--source-commit'].includes(key)) throw new Error(`不支持的参数：${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${key} 缺少值。`);
    values[key.slice(2)] = value;
    index += 1;
  }
  if (!values.audit || !values.out) throw new Error('必须指定 --audit 和 --out。');
  return values;
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 缺失。`);
  return value.trim();
}

function fileTitle(source) {
  const name = source.split('/').at(-1) || '';
  return name.replace(/\.pdf(?:\.\d+)?$/iu, '').trim();
}

function githubBlobUrl(source, commit) {
  const encoded = source.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `https://github.com/${SOURCE_REPOSITORY}/blob/${commit}/${encoded}`;
}

async function ensureFile(path, label) {
  if (!isAbsolute(path)) throw new Error(`${label} 必须是绝对路径。`);
  await access(path);
  return path;
}

async function buildCatalog(auditPath, sourceCommit) {
  const raw = JSON.parse(await readFile(auditPath, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('审计清单必须是非空数组。');
  const seen = new Set();
  const books = [];
  for (const record of raw) {
    const subject = requiredText(record?.subject, '学科');
    const source = requiredText(record?.source, '来源路径');
    const sourceBlobSha = requiredText(record?.sourceBlob, '源 blob SHA').toLowerCase();
    if (!SHA1.test(sourceBlobSha)) throw new Error(`源 blob SHA 无效：${source}`);
    if (seen.has(sourceBlobSha)) throw new Error(`审计清单重复的源 blob SHA：${sourceBlobSha}`);
    seen.add(sourceBlobSha);
    const local = await ensureFile(requiredText(record?.local, '本机源文件'), '本机源文件');
    const sourceParts = [{ path: local, sourceBlobSha }];
    if (record?.split === true) {
      const second = SPLIT_PARTS.get(sourceBlobSha);
      if (!second) throw new Error(`未登记的教材分片：${sourceBlobSha}`);
      const secondPath = await ensureFile(resolve(dirname(local), second.fileName), '数学分片二');
      sourceParts.push({ path: secondPath, sourceBlobSha: second.sourceBlobSha });
    }
    const segments = source.split('/');
    if (segments.length < 4) throw new Error(`来源路径层级不足：${source}`);
    const title = fileTitle(source);
    books.push({
      title,
      subject,
      publisher: segments[2],
      volume: title,
      sourceCommit,
      sourceUrl: githubBlobUrl(source, sourceCommit),
      sourceParts,
      expectedPageCount: Number(record.pages),
      editionStatus: 'source-metadata-unverified',
      ocrExpected: SCANNED_BOOK_BLOBS.has(sourceBlobSha),
    });
  }
  return {
    schemaVersion: 1,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit,
    generatedAt: new Date().toISOString(),
    books,
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const auditPath = resolve(args.audit);
  const outputPath = resolve(args.out);
  const sourceCommit = (args['source-commit'] || DEFAULT_SOURCE_COMMIT).toLowerCase();
  if (!SHA1.test(sourceCommit)) throw new Error('source commit 必须是 40 位十六进制 SHA。');
  const catalog = await buildCatalog(auditPath, sourceCommit);
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  process.stdout.write(`${JSON.stringify({ status: 'catalog-built', books: catalog.books.length, scannedBooks: catalog.books.filter((book) => book.ocrExpected).length, sourceCommit })}\n`);
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}
