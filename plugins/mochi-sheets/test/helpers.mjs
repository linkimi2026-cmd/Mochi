// 测试用的公共夹子：临时工作区、插件挂载、工具调用。
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.mjs';

/**
 * 临时工作区。返回 realpath 后的路径：macOS 上 /var 是指向 /private/var 的软链，
 * 而插件返回的是 realpath，不先归一化就会在断言里对不上（这是测试自身的坑，不是插件的问题）。
 */
export function makeWorkspace(t, prefix = 'mochi-sheets-test-') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** 挂载插件并返回 { ctx, tools, call }。call 会解包 index.mjs 的错误包装，便于断言。 */
export function mount(t, { allowedRoots, mode = 'workspace-write' }) {
  const registered = [];
  const ctx = {
    tools: {
      register(tool) { registered.push(tool); return () => {}; },
      get(name) { return registered.find((tool) => tool.name === name); },
    },
    sandboxPolicy: {
      resolve: ({ session }) => ({ mode, workspaceRoot: session?.header?.cwd ?? allowedRoots[0] }),
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  apply(ctx, { allowedRoots });
  const exec = { agent: { session: { header: { cwd: allowedRoots[0] } } } };
  return {
    ctx,
    tools: registered,
    tool(name) {
      const found = registered.find((entry) => entry.name === name);
      if (!found) throw new Error(`没有注册工具 ${name}`);
      return found;
    },
    async call(name, args) {
      return registered.find((entry) => entry.name === name).execute(args, exec);
    },
  };
}

/** 断言异步调用失败，并返回错误消息。 */
export async function rejectMessage(promise) {
  try {
    await promise;
  } catch (error) {
    return error.message;
  }
  throw new Error('期望这次调用失败，但它成功了——这属于"假装成功"，测试不算通过。');
}

export const SAMPLE_ROWS = [
  ['张三', 88.5, 91],
  ['李四', 72, 85],
  ['王五', 95, 67],
];

export const SAMPLE_SHEET = {
  name: '成绩',
  columns: [
    { header: '姓名', width: 14 },
    { header: '语文', width: 10, numberFormat: '0.00', align: 'center' },
    { header: '数学', width: 10, numberFormat: '0.00', align: 'center' },
  ],
  rows: SAMPLE_ROWS,
  freezeHeaderRow: true,
};
