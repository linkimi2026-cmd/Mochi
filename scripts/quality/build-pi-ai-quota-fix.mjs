import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tar = createRequire(join(root, 'apps/desktop/package.json'))('tar');
const source = join(root, 'vendor/alpha-family/deepseek-ai-dsh-llm-pi-ai-0.1.3-alpha.1.tgz');
const output = join(root, 'vendor/local-plugins/deepseek-ai-dsh-llm-pi-ai-0.1.3-alpha.1-mochi-quota-fix.tgz');
const temp = await mkdtemp(join(tmpdir(), 'mochi-pi-ai-fix-'));
try {
  await tar.x({ file: source, cwd: temp, strict: true });
  const entry = join(temp, 'package/lib/index.js');
  const original = await readFile(entry, 'utf8');
  const before =
    'function classifyPiAiError(message) {\n\tif (/\\b(?:401|403)\\b/.test(message)) return "AUTH";\n\tif (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE;';
  const after =
    'function classifyPiAiError(message) {\n\tif (/\\b403\\b/.test(message) && isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE;\n\tif (/\\b(?:401|403)\\b/.test(message)) return "AUTH";\n\tif (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE;';
  if (original.split(before).length !== 2) throw new Error('Expected exactly one upstream classifier block');
  await writeFile(entry, original.replace(before, after));
  await tar.c(
    {
      file: output,
      cwd: temp,
      gzip: { portable: true },
      portable: true,
      mtime: new Date('2020-01-01T00:00:00Z'),
      prefix: '',
    },
    [
      'package/LICENSE',
      'package/README.md',
      'package/README.i18n.yaml',
      'package/README.zh.md',
      'package/lib',
      'package/package.json',
    ],
  );
  const bytes = await readFile(output);
  process.stdout.write(`Created ${output}\nsha512-${createHash('sha512').update(bytes).digest('base64')}\n`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
