// Mochi 文件工具族插件（cordis 风格 ESM）。
//
// 工具：file_search / file_read / file_copy / file_move / file_rename / file_create_folder
//   —— 工具名只允许 [a-zA-Z0-9_-]。带点的 `file.search` 会被模型网关 400
//      拒收整轮对话（2026-09-12 真实事故）。六个名字必须一字不差。
//
// 能力边界（不吹）：
//   * 真的用 node:fs/promises 读写老师本机磁盘，不返回“模拟成功”。
//   * 所有路径先过 paths.mjs 的安全边界：只允许在允许根目录之内，`..` 穿越、
//     绝对路径越界、符号链接穿越都被拒绝；默认只开放当前会话工作区，不开放
//     整个用户目录或磁盘根。
//   * 本插件不提供任何删除工具（没有 file_delete）。
//   * file_copy / file_move 覆盖已有文件默认拒绝，必须显式 overwrite: true，
//     并在返回里说明覆盖了什么。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createFileHandlers } from './handlers.mjs';

export const name = 'mochi-files';
export const inject = ['tools', 'sandboxPolicy'];

// ⚠️ render 签名是 (args, value)：第一个参数是调用参数，第二个才是工具返回值。
const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

export function apply(ctx, options = {}) {
  const handlers = createFileHandlers({ ctx, options });
  const register = (toolName, description, parameters, execute) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(toolName)) throw new Error(`工具名不合规（网关会拒收整轮对话）：${toolName}`);
    ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }));
  };

  register(
    'file_search',
    '在允许的根目录（默认当前会话工作区）下按文件名搜索文件或文件夹。query 可用 * 和 ? 通配符（如“期中*.docx”），'
    + '也可以只写一段名字（按包含、不区分大小写匹配）。结果有上限，被截断时会明确说明。返回的路径都是允许根之内的真实绝对路径。'
    + '搜索不跟随符号链接。',
    {
      query: { type: 'string', required: true, description: '文件名或通配符，例如“期中*.docx”“实验报告”。' },
      directory: { type: 'string', description: '可选：在哪个目录下搜索（默认允许根本身）。相对路径相对第一个允许根解析。' },
      recursive: { type: 'boolean', description: '是否递归子目录，默认 true。' },
      maxDepth: { type: 'integer', description: '递归最大深度，默认 6，范围 0–32。' },
      type: { type: 'string', enum: ['file', 'directory', 'any'], description: '只看文件 / 只看文件夹 / 都看，默认 any。' },
      limit: { type: 'integer', description: '最多返回条数，默认 50，范围 1–200。' },
    },
    (args, exec) => handlers.search(args, exec),
  );

  register(
    'file_read',
    '读取一个文本文件的内容，支持行范围和大小上限（默认 256KB，硬上限 4MB）。超限时只读一部分并明确说明截断。'
    + '**只能读纯文本**（.txt/.md/.json/.csv 源码/.yml/代码等）；二进制文件（含 NUL 字节）会被拒绝。'
    + '要读 Office 与 PDF 请直接调对应的专用工具，不要先试 file_read：'
    + '.docx → doc_read，.pdf → pdf_read，.xlsx/.csv 表格 → spreadsheet_read，'
    + '.pptx → ppt_inspect，图片 → read_image。老师上传的附件（宿主句柄文本里那个只读副本路径）同样按这个对应关系处理。'
    + '返回真实绝对路径与真实字节数。',
    {
      path: { type: 'string', required: true, description: '要读取的文件路径（允许根之内）。' },
      startLine: { type: 'integer', description: '可选：起始行（1 起，含）。默认从第 1 行开始。' },
      endLine: { type: 'integer', description: '可选：结束行（含）。默认到最后一行。' },
      maxBytes: { type: 'integer', description: '最多读取字节数，默认 262144（256KB），硬上限 4194304（4MB）。' },
    },
    (args, exec) => handlers.read(args, exec),
  );

  register(
    'file_copy',
    '把文件真实复制到目标路径（node:fs copyFile）。目标已存在时默认拒绝；只有显式 overwrite: true 才会覆盖，'
    + '并在返回里说明覆盖了什么。只复制文件，不复制整个目录。',
    {
      source: { type: 'string', required: true, description: '来源文件路径。' },
      destination: { type: 'string', required: true, description: '目标文件路径（含文件名）。' },
      overwrite: { type: 'boolean', description: '为 true 时才允许覆盖已存在的目标文件，默认 false。' },
    },
    (args, exec) => handlers.copy(args, exec),
  );

  register(
    'file_move',
    '把文件真实移动到目标路径。目标已存在时默认拒绝，需显式 overwrite: true（并会说明覆盖了什么）。'
    + '跨文件系统时会如实回退为「复制后删除来源」，并在返回中标注。只移动文件，不移动整个目录。',
    {
      source: { type: 'string', required: true, description: '来源文件路径。' },
      destination: { type: 'string', required: true, description: '目标文件路径（含文件名）。' },
      overwrite: { type: 'boolean', description: '为 true 时才允许覆盖已存在的目标文件，默认 false。' },
    },
    (args, exec) => handlers.move(args, exec),
  );

  register(
    'file_rename',
    '在同一目录内给文件改名。newName 只写新文件名本身，不能带路径分隔符。目标已存在时默认拒绝，需显式 overwrite: true。',
    {
      path: { type: 'string', required: true, description: '要改名的文件路径。' },
      newName: { type: 'string', required: true, description: '新文件名本身（不含目录，例如“第三章教案-定稿.docx”）。' },
      overwrite: { type: 'boolean', description: '为 true 时才允许覆盖同名的已存在文件，默认 false。' },
    },
    (args, exec) => handlers.renameFile(args, exec),
  );

  register(
    'file_create_folder',
    '真实新建文件夹（node:fs mkdir）。已存在同名文件夹时返回「已存在」而不算错误；同名位置是文件时明确报错。默认递归创建父目录。',
    {
      path: { type: 'string', required: true, description: '要创建的文件夹路径。' },
      recursive: { type: 'boolean', description: '是否递归创建父目录，默认 true。' },
    },
    (args, exec) => handlers.createFolder(args, exec),
  );

  ctx.logger?.info?.('[Mochi] 文件工具族已注册：file_search/file_read/file_copy/file_move/file_rename/file_create_folder（受允许根目录约束，无删除工具）。');
}

export { output };
