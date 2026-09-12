// 路径安全边界单测：允许根解析、`..` 穿越、绝对路径越界、符号链接穿越。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { createPathGuard, parseRootList, readAllowedRoots, resolveAllowedRoots, writeAllowedRoots } from '../paths.mjs';

function withTempDir(t, prefix = 'mochi-files-paths-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('resolveAllowedRoots：显式 allowedRoots 优先，并返回真实路径', async (t) => {
  const root = withTempDir(t);
  const resolved = await resolveAllowedRoots({ options: { allowedRoots: [root] }, env: { HOME: '/nonexistent-home' } });
  assert.equal(resolved.source, 'configured');
  assert.equal(resolved.entries.length, 1);
  assert.equal(resolved.entries[0].real, realpathSync(root));
});

test('resolveAllowedRoots：拒绝把文件系统根当允许根', async () => {
  await assert.rejects(
    () => resolveAllowedRoots({ options: { allowedRoots: ['/'] }, env: { HOME: '/nonexistent-home' } }),
    (error) => error.code === 'ROOT_UNAVAILABLE' && /文件系统根/.test(error.message),
  );
});

test('resolveAllowedRoots：没有配置也没有会话工作区时拒绝运行', async () => {
  await assert.rejects(
    () => resolveAllowedRoots({ options: {}, exec: {}, env: { HOME: '/nonexistent-home' } }),
    (error) => error.code === 'WORKSPACE_UNAVAILABLE',
  );
});

test('resolveAllowedRoots：会话工作区作为默认允许根（来自 sandboxPolicy）', async (t) => {
  const root = withTempDir(t);
  const ctx = { sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) } };
  const resolved = await resolveAllowedRoots({ ctx, exec: {}, options: {}, env: { HOME: '/nonexistent-home' } });
  assert.equal(resolved.source, 'session-workspace');
  assert.equal(resolved.entries[0].real, realpathSync(root));
});

test('resolveAllowedRoots：只读会话标记 readOnly，但根仍可解析（读取靠 handler 放行）', async (t) => {
  const root = withTempDir(t);
  const ctx = { sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: root }) } };
  const resolved = await resolveAllowedRoots({ ctx, exec: {}, options: {}, env: { HOME: '/nonexistent-home' } });
  assert.equal(resolved.readOnly, true);
  assert.equal(resolved.entries[0].real, realpathSync(root));
});

test('parseRootList：数组与 path.delimiter 分隔字符串', () => {
  assert.deepEqual(parseRootList(['/a', '', '/b']), ['/a', '/b']);
  assert.deepEqual(parseRootList(`/a${delimiter}/b`), ['/a', '/b']);
  assert.deepEqual(parseRootList('  '), []);
});

test('持久化允许根：writeAllowedRoots 后可被 readAllowedRoots 读回', async (t) => {
  const dir = withTempDir(t);
  const file = join(dir, 'files', 'allowed-roots.json');
  await writeAllowedRoots(file, ['/tmp/a', 'relative-ignored']);
  assert.deepEqual(await readAllowedRoots(file), ['/tmp/a']);
  // 损坏文件返回空数组，绝不猜测
  writeFileSync(file, '{ not json');
  assert.deepEqual(await readAllowedRoots(file), []);
});

test('guard：`..` 穿越被拒绝', async (t) => {
  const root = withTempDir(t);
  mkdirSync(join(root, 'sub'), { recursive: true });
  const guard = createPathGuard([{ logical: root, real: realpathSync(root) }]);
  await assert.rejects(() => guard.resolve('../../etc/passwd', { field: '文件路径' }), (error) => error.code === 'PATH_ESCAPE');
  await assert.rejects(() => guard.resolve('../outside.txt'), (error) => error.code === 'PATH_ESCAPE');
});

test('guard：绝对路径越界被拒绝', async (t) => {
  const root = withTempDir(t);
  const guard = createPathGuard([{ logical: root, real: realpathSync(root) }]);
  await assert.rejects(() => guard.resolve('/etc/passwd'), (error) => error.code === 'PATH_ESCAPE');
});

test('guard：符号链接穿越被拒绝（目录与文件两种）', async (t) => {
  const root = withTempDir(t);
  const outside = withTempDir(t, 'mochi-files-outside-');
  writeFileSync(join(outside, 'secret.txt'), 'SECRET');
  symlinkSync(outside, join(root, 'linkdir'));
  symlinkSync(join(outside, 'secret.txt'), join(root, 'linkfile.txt'));
  const guard = createPathGuard([{ logical: root, real: realpathSync(root) }]);
  await assert.rejects(() => guard.resolve('linkdir/secret.txt'), (error) => error.code === 'PATH_ESCAPE');
  await assert.rejects(() => guard.resolve('linkfile.txt'), (error) => error.code === 'PATH_ESCAPE');
});

test('guard：允许根内的正常路径与尚不存在的目标都能解析', async (t) => {
  const root = withTempDir(t);
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'sub', 'a.txt'), 'a');
  const guard = createPathGuard([{ logical: root, real: realpathSync(root) }]);
  const existing = await guard.resolve('sub/a.txt');
  assert.equal(existing.path, join(root, 'sub', 'a.txt'));
  const future = await guard.resolve('sub/new-folder/new.txt');
  assert.equal(future.path, join(root, 'sub', 'new-folder', 'new.txt'));
  await assert.rejects(() => guard.resolve('', { field: '文件路径' }), (error) => error.code === 'BAD_PATH');
  await assert.rejects(() => guard.resolve('bad\u0000name'), (error) => error.code === 'BAD_PATH');
});
