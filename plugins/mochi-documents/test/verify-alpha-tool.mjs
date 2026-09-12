// Fixed-alpha registration and call verifier for mochi_document_create.
// Usage (macOS packaged Alpha runner):
// ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/Mochi" \
//   test/verify-alpha-tool.mjs --app "$APP"
//
// The fixture copies only this plugin's entry/engine. It links dsh-tools from
// the supplied fixed Alpha app and links the already verified local renderer
// dependencies only because this verifier runs before the new package is
// staged into that app.
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing ${name}`);
  return value;
}

const app = argument('--app');
const runtimeNodeModules = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');
const documentsRoot = new URL('../', import.meta.url);
const repositoryRoot = new URL('../../../', import.meta.url).pathname;
const fixture = await mkdtemp(join(tmpdir(), 'mochi-documents-alpha-tool-'));

function documentInput() {
  return {
    sourceKind: 'demonstration',
    title: '固定 Alpha 工具验收',
    pages: [{
      blocks: [
        { kind: 'heading', level: 1, text: '课堂说明' },
        { kind: 'paragraph', text: '这是固定 Alpha defineTool 的真实调用验证。' },
        { kind: 'table', columns: ['项目', '状态'], rows: [['DOCX', '可编辑'], ['PDF', '已生成']] },
      ],
    }],
    doubts: [{ question: '请核对课前材料。', source: { kind: 'unknown' } }],
  };
}

try {
  const moduleRoot = join(fixture, 'module');
  const nodeModules = join(moduleRoot, 'node_modules');
  await mkdir(join(nodeModules, '@mochi'), { recursive: true });
  await Promise.all([
    copyFile(new URL('index.mjs', documentsRoot), join(moduleRoot, 'index.mjs')),
    copyFile(new URL('plugin.mjs', documentsRoot), join(moduleRoot, 'plugin.mjs')),
    symlink(join(runtimeNodeModules, '@deepseek-ai'), join(nodeModules, '@deepseek-ai'), 'dir'),
    symlink(join(repositoryRoot, 'plugins', 'mochi-documents', 'node_modules.nosync', 'docx'), join(nodeModules, 'docx'), 'dir'),
    symlink(join(repositoryRoot, 'plugins', 'mochi-documents', 'node_modules.nosync', 'pdf-lib'), join(nodeModules, 'pdf-lib'), 'dir'),
    symlink(join(repositoryRoot, 'packages', 'mochi-pdf-layout'), join(nodeModules, '@mochi', 'pdf-layout'), 'dir'),
  ]);

  const [{ validateJsonSchemaValue }, plugin] = await Promise.all([
    import(pathToFileURL(join(runtimeNodeModules, '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')).href),
    import(`${pathToFileURL(join(moduleRoot, 'plugin.mjs')).href}?verify=${Date.now()}`),
  ]);
  const workspace = join(fixture, 'workspace');
  await mkdir(workspace);
  const registered = new Map();
  const ctx = {
    tools: { register: (tool) => registered.set(tool.name, tool) },
    sandboxPolicy: {
      resolve: ({ session }) => ({ mode: 'workspace-write', workspaceRoot: session.header.cwd, sessionId: session.id }),
    },
  };
  plugin.apply(ctx);
  const tool = registered.get('mochi_document_create');
  assert.ok(tool, 'fixed Alpha must register mochi_document_create');
  assert.equal(tool.parameters.type, 'object');
  assert.equal(Object.hasOwn(tool.parameters.properties, 'outputDirectory'), false);

  const exec = {
    signal: new AbortController().signal,
    agent: { session: { id: 'fixed-alpha-fixture', header: { cwd: workspace } } },
  };
  const result = await tool.execute(documentInput(), exec);
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, result, 'value'), []);
  const [docx, pdf, manifest] = await Promise.all([
    readFile(result.产物.可编辑DOCX),
    readFile(result.产物.嵌字PDF),
    readFile(result.产物.完成标志, 'utf8').then(JSON.parse),
  ]);
  assert.deepEqual(docx.subarray(0, 2), Buffer.from('PK'));
  assert.deepEqual(pdf.subarray(0, 5), Buffer.from('%PDF-'));
  assert.equal(manifest.status, 'completed');
  assert.deepEqual(tool.output.render(documentInput(), result), [{ type: 'text', text: JSON.stringify(result) }]);

  await assert.rejects(
    () => tool.execute({ sourceKind: 'demonstration', title: '类型错误', pages: 'not-an-array' }, exec),
    (error) => error?.code === 'INVALID_ARGS',
  );
  console.log(JSON.stringify({
    status: 'PASS',
    alphaToolsVersion: '0.1.3-alpha.1',
    tool: tool.name,
    completed: manifest.status,
    docxHeader: docx.subarray(0, 2).toString('utf8'),
    pdfHeader: pdf.subarray(0, 5).toString('utf8'),
  }));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
