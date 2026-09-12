// mochi-documents · 教师侧受控结构化文档工具入口。
//
// The renderer in index.mjs owns document validation, atomic publication, and
// cancellation cleanup. This adapter owns only the Alpha tool contract and a
// session-bound output location; a model never chooses a host filesystem path
// for *new* output. Reading, editing and exporting existing files accept a path
// but only inside the current session workspace.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  DocumentIoError,
  editDocxDocument,
  probePdfExportEngine,
  readDocxStructure,
  readPdfStructure,
  sha256Hex,
} from './document-io.mjs';
import {
  exportDocxToPdfFile,
  generateDocumentBundle,
  MochiDocumentsError,
  validateStructuredDocument,
} from './index.mjs';

export const name = 'mochi-documents';
export const inject = ['tools', 'sandboxPolicy'];

// dsh-tools invokes render(args, value). Keeping both arguments prevents a
// replay/render call from serialising its input in place of the real result.
export const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

const OUTPUT_PARENT_NAME = 'Mochi Documents';
const GENERIC_TEMPLATE = 'generic';
const SICHUAN_2026_EXAM_TEMPLATE = 'sichuan-2026-high-school-exam-base';
const DOCX_EXTENSIONS = ['.docx'];
const PDF_EXTENSIONS = ['.pdf'];

export class MochiDocumentsToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MochiDocumentsToolError';
    this.code = code;
  }
}

function toolFailure(code, message) {
  return new MochiDocumentsToolError(code, message);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw toolFailure('ABORTED', '文档操作已取消；未发布任何完成文档。');
}

function isDescendant(parent, candidate) {
  const difference = relative(parent, candidate);
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference));
}

async function ordinaryDirectory(path, label) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') throw toolFailure('WORKSPACE_UNAVAILABLE', `${label}不存在，无法安全生成文档。`);
    throw toolFailure('WORKSPACE_UNAVAILABLE', `${label}不可访问，无法安全生成文档。`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw toolFailure('WORKSPACE_UNSAFE', `${label}必须是普通目录，不能使用符号链接。`);
  }
}

async function resolveWorkspace(ctx, exec) {
  throwIfAborted(exec?.signal);
  const session = exec?.agent?.session;
  const sessionWorkspace = session?.header?.cwd;
  if (!session || typeof sessionWorkspace !== 'string' || !isAbsolute(sessionWorkspace)) {
    throw toolFailure('SESSION_WORKSPACE_REQUIRED', '只能在具有受管工作区的当前会话中操作文档。');
  }
  if (!ctx?.sandboxPolicy || typeof ctx.sandboxPolicy.resolve !== 'function') {
    throw toolFailure('SANDBOX_POLICY_UNAVAILABLE', '当前宿主未提供文档操作所需的工作区权限策略。');
  }

  const policy = ctx.sandboxPolicy.resolve({ session });
  if (typeof policy?.workspaceRoot !== 'string' || !isAbsolute(policy.workspaceRoot)) {
    throw toolFailure('WORKSPACE_UNAVAILABLE', '宿主没有提供有效的受管工作区。');
  }

  // Resolve the session-specific policy for every call. We deliberately keep
  // all generated output within this root even in danger-full-access mode.
  const requestedWorkspace = resolve(policy.workspaceRoot);
  await ordinaryDirectory(requestedWorkspace, '会话工作区');
  const workspaceRoot = await realpath(requestedWorkspace);
  await ordinaryDirectory(workspaceRoot, '会话工作区');
  return { policy, workspaceRoot };
}

function assertWritable(policy) {
  if (policy?.mode === 'read-only') {
    throw toolFailure('SANDBOX_READ_ONLY', '当前会话是只读模式；请按宿主审批流程切换到可写工作区后再生成或导出文档。');
  }
}

async function createOutputDirectory(exec, workspace) {
  throwIfAborted(exec?.signal);
  const outputParent = join(workspace.workspaceRoot, OUTPUT_PARENT_NAME);
  try {
    await mkdir(outputParent, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw toolFailure('WORKSPACE_UNAVAILABLE', '无法在受管工作区创建文档输出目录。');
    }
  }
  await ordinaryDirectory(outputParent, '文档输出目录');
  const canonicalOutputParent = await realpath(outputParent);
  if (!isDescendant(workspace.workspaceRoot, canonicalOutputParent)) {
    throw toolFailure('WORKSPACE_UNSAFE', '文档输出目录不在当前会话工作区内。');
  }
  throwIfAborted(exec?.signal);

  // This name is host-generated. Reading/editing tools have no filesystem field
  // for the output location; the renderer reserves it atomically a second time.
  return join(canonicalOutputParent, `document-${randomUUID()}`);
}

/**
 * `createOutputDirectory` only *reserves a name*; the DOCX renderer creates that
 * directory itself. Edit/export write their own artifacts, so they create the
 * reserved version directory here first.
 */
async function reserveVersionDirectory(exec, workspace) {
  const directory = await createOutputDirectory(exec, workspace);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw toolFailure('WORKSPACE_UNAVAILABLE', '无法在受管工作区创建文档版本目录。');
  }
  return directory;
}

/**
 * 老师**上传**的文件落在哪里？（2026-09-12 修「上传的 Word 打不开」）
 *
 * 宿主把上传的原件按 verbatim 原样存到 `<DSH_HOME>/attachments/v1/...`，然后只给模型一句
 * 句柄文本：「File "xx.docx" … verbatim read-only copy saved at <路径>。Read that path
 * with your file tools…」。这个位置**不在会话工作区里**，而本插件的路径闸原先只认工作区：
 *
 *   - `doc_read`  → INPUT_OUTSIDE_WORKSPACE「不在当前会话工作区内，已拒绝读取」
 *   - `file_read` → 「二进制文件会被拒绝，Word/Excel/PPT/PDF 请用对应的文档工具」
 *
 * 两条路都堵死，模型只能回一句"读不到这个 Word"——这就是老师看到的现象。
 *
 * 判定：附件盘是宿主自己写下的**只读原件副本**，读它不构成越权；而且句柄文本本身就
 * 要求"要改就先复制到可写位置"。所以这里把附件盘加进**只读**输入根，写入依旧只允许工作区。
 *
 * 根目录解析顺序与宿主一致：显式配置 → `MOCHI_HOME` → `DSH_HOME` → `~/.mochi-home` / `~/.dsh`。
 */
export function resolveAttachmentReadRoots({ configured = [], env = process.env, home = homedir() } = {}) {
  const candidates = [];
  for (const value of configured) candidates.push(value);
  for (const key of ['MOCHI_HOME', 'DSH_HOME']) {
    const value = env?.[key];
    if (typeof value === 'string' && value.trim().length > 0) candidates.push(value.trim());
  }
  candidates.push(join(home, '.mochi-home'), join(home, '.dsh'));
  const roots = [];
  for (const candidate of candidates) {
    const root = resolve(candidate, 'attachments', 'v1');
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}

/** 附件盘可能尚未创建（本次会话还没有上传）；解析不到就跳过，不做任何猜测。 */
async function existingAttachmentRoots() {
  const usable = [];
  for (const root of resolveAttachmentReadRoots()) {
    try {
      const info = await lstat(root);
      if (info.isDirectory()) usable.push(await realpath(root));
    } catch { /* 该候选不存在：忽略 */ }
  }
  return usable;
}

/**
 * Resolves an existing input file inside the current session workspace, or inside
 * the host's read-only attachment store for files the teacher uploaded. Unlike
 * generated output, reading/editing/exporting must name a real file, so the
 * path is accepted but constrained: absolute (or workspace-relative), an
 * ordinary non-symlink file, and inside one of those roots.
 */
async function resolveInputFile(workspace, inputPath, { label, extensions }) {
  if (typeof inputPath !== 'string' || inputPath.trim().length === 0) {
    throw toolFailure('INPUT_PATH_REQUIRED', `${label}必须是文件路径字符串（绝对路径，或相对当前会话工作区）。`);
  }
  const requested = isAbsolute(inputPath.trim()) ? inputPath.trim() : join(workspace.workspaceRoot, inputPath.trim());
  let info;
  try {
    info = await lstat(requested);
  } catch (error) {
    if (error?.code === 'ENOENT') throw toolFailure('INPUT_NOT_FOUND', `${label}不存在：${requested}`);
    throw toolFailure('INPUT_UNAVAILABLE', `${label}不可访问：${requested}`);
  }
  if (info.isSymbolicLink()) throw toolFailure('INPUT_UNSAFE', `${label}是符号链接；为安全起见不接受符号链接。`);
  if (!info.isFile()) throw toolFailure('INPUT_UNSAFE', `${label}必须是普通文件。`);
  const canonical = await realpath(requested);
  const inWorkspace = isDescendant(workspace.workspaceRoot, canonical);
  if (!inWorkspace) {
    const attachments = await existingAttachmentRoots();
    const inAttachmentStore = attachments.some((root) => isDescendant(root, canonical));
    if (!inAttachmentStore) {
      throw toolFailure(
        'INPUT_OUTSIDE_WORKSPACE',
        `${label}不在当前会话工作区内，也不在宿主附件盘内，已拒绝读取：${canonical}`,
      );
    }
  }
  const extension = extensions.find((candidate) => canonical.toLowerCase().endsWith(candidate));
  if (!extension) throw toolFailure('INPUT_TYPE_UNSUPPORTED', `${label}必须是 ${extensions.join(' / ')} 文件。`);
  return { path: canonical, byteLength: info.size, fromAttachmentStore: !inWorkspace };
}

const DOCUMENT_IO_MESSAGES = {
  ARCHIVE_UNREADABLE: '文件不是有效的 ZIP/OOXML 归档，或归档已损坏。',
  ARCHIVE_ENCRYPTED: '该归档已加密，本机无法读取。',
  ARCHIVE_ZIP64_UNSUPPORTED: '该归档使用 ZIP64 扩展，超出本机读取范围。',
  ARCHIVE_UNSUPPORTED_COMPRESSION: '该归档使用了不支持的压缩方法，本机无法解压。',
  DOCX_INVALID: 'DOCX 缺少必需的 OOXML 部件（如 word/document.xml）。',
  DOCX_TOO_LARGE: 'DOCX 超过本机读取上限。',
  EDIT_OP_INVALID: '编辑操作不合法：请检查 ops 中的 op 名称与字段。',
  EDIT_BLOCK_NOT_FOUND: '编辑操作指向的块序号不存在；未生成任何新版本。',
  EDIT_TABLE_UNSUPPORTED: '当前 doc_edit 只改写段落文本，不支持重排表格；未生成任何新版本。',
  EDIT_TEXT_NOT_FOUND: '在目标段落中找不到要替换的文本；未生成任何新版本。',
  PDF_UNREADABLE: 'PDF 无法解析（可能已加密或使用不支持的交叉引用结构）。',
  PDF_TOO_LARGE: 'PDF 超过本机读取上限。',
  PDF_PAGE_RANGE_INVALID: '页范围参数无效，请使用 "1-3,5" 形式且不超出实际页数。',
};

const RENDERER_MESSAGES = {
  ABORTED: '文档生成已取消；未发布任何完成文档。',
  INVALID_INPUT: '文档结构不合法：请按结构化页面、段落、表格和疑点格式补全后重试。',
  OUTPUT_EXISTS: '宿主生成的输出目录已被占用；请重新发起生成，旧文件不会被覆盖。',
  INVALID_OUTPUT_DIRECTORY: '宿主未提供有效的受管输出目录。',
  INVALID_EXPORT_SOURCE: '导出源必须是已存在的绝对 DOCX 路径。',
  GENERATION_FAILED: '文档在完成发布前生成失败；没有可用的完成文档。',
  CONVERTER_MISSING: '本机没有可用的 PDF 导出引擎（LibreOffice/soffice）。',
  CONVERTER_TIMEOUT: 'PDF 导出超时；未发布导出文件。',
  CONVERTER_FAILED: 'PDF 导出失败；未发布导出文件。',
  EXAM_FONT_UNAVAILABLE: '特殊考试模板所需的本机字体不可用；不做静默替换。',
  SPECIAL_TEMPLATE_UNAVAILABLE: '特殊考试模板当前不在教师工具中开放。',
};

function throwAsToolError(error) {
  if (error instanceof MochiDocumentsToolError) throw error;
  if (error instanceof DocumentIoError) {
    throw toolFailure(error.code, DOCUMENT_IO_MESSAGES[error.code] ?? `文档读取或编辑失败（${error.code}）。`);
  }
  if (error instanceof MochiDocumentsError) {
    throw toolFailure(error.code, RENDERER_MESSAGES[error.code] ?? `文档处理失败（${error.code}）。`);
  }
  throw error;
}

function genericOnly(document) {
  if (document.template.kind === GENERIC_TEMPLATE) return;
  if (document.template.kind === SICHUAN_2026_EXAM_TEMPLATE) {
    throw toolFailure(
      'SPECIAL_TEMPLATE_UNAVAILABLE',
      '四川 2026 考试模板当前不在教师工具中开放：它需要受管本机 LibreOffice、macOS 宋体/Times 字体与单独印刷核验；本次没有调用任何 Office 转换程序。请改用普通结构化文档模板。',
    );
  }
  throw toolFailure('SPECIAL_TEMPLATE_UNAVAILABLE', '当前教师工具只开放普通结构化文档模板。');
}

function bundleResult(document, bundle, toolName) {
  return {
    状态: '已完成',
    工具: toolName,
    标题: document.title,
    模板: '普通结构化文档',
    输出目录: bundle.outputDirectory,
    产物: {
      可编辑DOCX: bundle.docxPath,
      嵌字PDF: bundle.pdfPath,
      疑点清单: bundle.questionsPath,
      检查清单: bundle.checklistPath,
      完成标志: bundle.manifestPath,
    },
    检查: bundle.manifest.files,
    完成标志状态: bundle.manifest.status,
    说明: '已在当前会话的受管工作区新建目录中生成可编辑 DOCX、同源结构化 PDF、疑点与检查清单；不会覆盖旧版本。',
  };
}

function parameterSchema() {
  // validateStructuredDocument is the authoritative deep validator. The tool
  // schema only provides the fixed-alpha type boundary and has no output path.
  return {
    sourceKind: {
      type: 'string',
      required: true,
      enum: ['upstream-authorized-structured-content', 'demonstration'],
      description: '已获授权的结构化来源类型。',
    },
    title: { type: 'string', required: true, description: '文档标题。' },
    sourceLabel: { type: 'string', description: '可选来源标签。' },
    template: {
      type: 'string',
      enum: [GENERIC_TEMPLATE, SICHUAN_2026_EXAM_TEMPLATE],
      description: '默认 generic。当前教师工具仅执行 generic；特殊考试模板会如实说明其本机依赖限制。',
    },
    pages: {
      type: 'array',
      items: { type: 'json' },
      description: '普通模板页面，例如 [{blocks:[{kind:"heading",level:1,text:"标题"},{kind:"paragraph",text:"正文"},{kind:"table",columns:["项目","安排"],rows:[["讨论","观察现象"]]}]}]。heading 的 level 是 1 或 2；paragraph 有 text；table 必须有 columns 和每行列数相同的 rows。',
    },
    doubts: {
      type: 'array',
      items: { type: 'json' },
      description: '可选待核对事项：{question, source:{kind:"unknown"}} 或归一化页区。',
    },
    exam: {
      type: 'json',
      description: '仅四川考试模板的现有结构；当前工具不会运行该特殊模板。',
    },
  };
}

/**
 * Single implementation behind both `mochi_document_create` (existing alpha
 * contract) and `doc_create` (the name the teacher skills reference). There is
 * deliberately no second DOCX generator.
 */
function createDocumentCreateTool(ctx, toolName) {
  return defineTool({
    name: toolName,
    description: '把已获授权的结构化教学内容生成到当前会话工作区中的全新受管目录：返回可编辑 DOCX、同源结构化 PDF、疑点清单和检查清单。只接受标题、页面块、真实表格与疑点结构；不接受图片替代、任意本机路径、URL、OCR 或任意 Office 转换请求。普通模板不启动外部程序。需要读取已有文档请用 doc_read，需要改已有 DOCX 请用 doc_edit，需要导出 PDF 请用 doc_export。',
    parameters: parameterSchema(),
    output,
    execute: async (args, exec) => {
      try {
        throwIfAborted(exec?.signal);
        const document = validateStructuredDocument(args);
        genericOnly(document);
        const workspace = await resolveWorkspace(ctx, exec);
        assertWritable(workspace.policy);
        const outputDirectory = await createOutputDirectory(exec, workspace);
        const bundle = await generateDocumentBundle({
          // The renderer deliberately validates the original wire shape. The
          // prevalidated value has template:{kind:"generic"}, which is an
          // internal normalized form and must not be fed into that validator.
          document: args,
          outputDirectory,
          signal: exec?.signal,
        });
        return bundleResult(document, bundle, toolName);
      } catch (error) {
        throwAsToolError(error);
      }
    },
  });
}

function blockResult(block) {
  if (block.kind === 'table') {
    return {
      序号: block.index,
      类型: '表格',
      行数: block.rowCount,
      列数: block.columnCount,
      表头: block.header,
      表格: block.rows,
      合并单元格数: block.mergedCellCount,
    };
  }
  return {
    序号: block.index,
    类型: block.kind === 'heading' ? '标题' : block.kind === 'list' ? '列表段落' : '段落',
    文本: block.text,
    样式: block.styleName,
    样式ID: block.styleId,
    标题级别: block.headingLevel ?? null,
    含软换行: block.hasLineBreak,
  };
}

function docReadTool(ctx) {
  return defineTool({
    name: 'doc_read',
    description: '读取已存在的 .docx 的真实文本结构：按顺序返回段落/标题/表格块，段落带样式名、样式 ID 与标题级别，表格返回真实表头与单元格文本；同时返回内嵌图片、媒体文件与节数统计。用于核对和定位块序号，以便配合 doc_edit 修改。只读，不修改文件。路径可以是当前会话工作区内的文件，也可以是老师上传附件时宿主给出的只读副本路径（附件句柄文本里的那个路径）——上传的 Word 就用它来读，不要用 file_read（二进制会被拒）。',
    parameters: {
      path: { type: 'string', required: true, description: '要读取的 .docx 路径（绝对路径，或相对当前会话工作区）。' },
    },
    output,
    execute: async (args, exec) => {
      try {
        const workspace = await resolveWorkspace(ctx, exec);
        const target = await resolveInputFile(workspace, args?.path, { label: '要读取的文档', extensions: DOCX_EXTENSIONS });
        const bytes = await readFile(target.path);
        const structure = readDocxStructure(bytes);
        const titleBlock = structure.blocks.find((block) => block.headingLevel === 'title' && block.text);
        return {
          工具: 'doc_read',
          路径: target.path,
          来源: target.fromAttachmentStore ? '老师上传的附件（宿主只读副本）' : '会话工作区',
          字节数: bytes.length,
          文档标题: structure.title ?? titleBlock?.text,
          块数: structure.blocks.length,
          段落数: structure.paragraphs,
          列表段落数: structure.lists,
          标题数: structure.headings,
          表格数: structure.tables,
          内嵌图片数: structure.imageCount,
          媒体文件: structure.mediaFiles,
          节数: structure.sectionCount,
          样式数: structure.styleNameCount,
          块: structure.blocks.map(blockResult),
          说明: '以上结果直接解析 word/document.xml 与 word/styles.xml；不经过 HTML 或图片替代，也不改写原文件。',
        };
      } catch (error) {
        throwAsToolError(error);
      }
    },
  });
}

function docEditTool(ctx) {
  return defineTool({
    name: 'doc_edit',
    description: '在已有 .docx 上执行一组明确的段落级修改，并另存为一个全新版本（绝不覆盖源文件）。支持 set_block_text、replace_text、insert_paragraph、delete_block 四种操作，块序号取自 doc_read 的“序号”。只重写 word/document.xml 中受影响的文本节点，其余 OOXML 部件（styles.xml、docProps、媒体文件等）按原始压缩字节原样保留；不静默重排整篇文档，不支持表格重排。返回真实绝对路径、字节数、逐条改动说明与回读校验结果。',
    parameters: {
      path: { type: 'string', required: true, description: '要修改的 .docx 路径（绝对路径，或相对当前会话工作区）。' },
      ops: {
        type: 'array',
        required: true,
        items: { type: 'json' },
        description: '1-50 个操作。示例：[{op:"set_block_text",blockIndex:2,text:"新的段落文本"},{op:"replace_text",blockIndex:3,oldText:"旧",newText:"新",occurrence:"first"|"all"},{op:"insert_paragraph",afterBlockIndex:2,text:"新增段落",headingLevel:1|2 可省略},{op:"delete_block",blockIndex:4}]。',
      },
      changeNote: { type: 'string', description: '可选改动说明，会写入版本目录的 changes.json。' },
    },
    output,
    execute: async (args, exec) => {
      let outputDirectory;
      try {
        throwIfAborted(exec?.signal);
        const workspace = await resolveWorkspace(ctx, exec);
        assertWritable(workspace.policy);
        const target = await resolveInputFile(workspace, args?.path, { label: '要修改的文档', extensions: DOCX_EXTENSIONS });
        const bytes = await readFile(target.path);
        const edited = editDocxDocument(bytes, { ops: args?.ops });
        throwIfAborted(exec?.signal);

        const versionName = `${basename(target.path).replace(/\.docx$/i, '')}-edited-${randomUUID().slice(0, 8)}.docx`;
        outputDirectory = await reserveVersionDirectory(exec, workspace);
        const outputPath = join(outputDirectory, versionName);
        await writeFile(outputPath, edited.buffer, { flag: 'wx', mode: 0o600 });
        const readBack = readFile(outputPath);
        const published = await readBack;
        const reread = readDocxStructure(published);
        const changesPath = join(outputDirectory, 'changes.json');
        await writeFile(changesPath, `${JSON.stringify({
          schema: 'mochi-document-edit-changes-v1',
          source: target.path,
          output: outputPath,
          changeNote: args?.changeNote,
          changes: edited.changes,
          verification: edited.verification,
        }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });

        return {
          工具: 'doc_edit',
          状态: edited.verification.passed ? '已完成并校验通过' : '已写出但校验未通过',
          源文件: target.path,
          源文件字节数: bytes.length,
          输出文件: outputPath,
          输出目录: outputDirectory,
          字节数: published.length,
          校验和: sha256Hex(published),
          改动: edited.changes.map((change) => ({
            操作: change.op,
            块序号: change.blockIndex,
            改动前: change.before,
            改动后: change.after,
            说明: change.detail,
            涉及文本节点数: change.replacedTextNodes,
          })),
          保留: {
            未改动部件: edited.preserved.verbatimParts,
            部件总数: edited.preserved.partCount,
            说明: '仅 word/document.xml 被重新序列化；其余部件按原始压缩字节原样复制，未重排文档。',
          },
          回读校验: {
            重新解包成功: edited.verification.rereadOk,
            段落文本与预期一致: edited.verification.paragraphTextsMatch,
            块类型序列一致: edited.verification.paragraphKindsMatch,
            表格内容未变: edited.verification.tablesUnchanged,
            其他部件逐字节保留: edited.verification.partsPreservedByteForByte,
            样式数未变: edited.verification.styleNameCountUnchanged,
            媒体文件数未变: edited.verification.mediaFileCountUnchanged,
            回读块数: reread.blocks.length,
          },
          改动清单: changesPath,
          说明: '这是新版本文件，源文件未被改写。表格与未涉及的段落保持原样；被匹配到的段落中，匹配范围外的 run 格式保留。',
        };
      } catch (error) {
        if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }).catch(() => {});
        throwAsToolError(error);
      }
    },
  });
}

function docExportTool(ctx) {
  return defineTool({
    name: 'doc_export',
    description: '把已有 .docx 导出为真实 PDF：先探测本机是否有受管的 LibreOffice/soffice 导出引擎，有则调用本机转换并把 PDF 发布到当前会话工作区中的全新目录；没有则如实返回“本机没有导出引擎”，绝不伪造或生成伪装 PDF。不支持 HTML/图片冒充 PDF。',
    parameters: {
      path: { type: 'string', required: true, description: '要导出的 .docx 路径（绝对路径，或相对当前会话工作区）。' },
      format: { type: 'string', enum: ['pdf'], description: '当前仅支持 pdf。' },
    },
    output,
    execute: async (args, exec) => {
      let outputDirectory;
      try {
        throwIfAborted(exec?.signal);
        if (args?.format !== undefined && args.format !== 'pdf') {
          throw toolFailure('EXPORT_FORMAT_UNSUPPORTED', 'doc_export 当前只支持导出 pdf。');
        }
        const workspace = await resolveWorkspace(ctx, exec);
        assertWritable(workspace.policy);
        const target = await resolveInputFile(workspace, args?.path, { label: '要导出的文档', extensions: DOCX_EXTENSIONS });
        // A host may pin the export engine it manages; otherwise the fixed
        // platform locations plus PATH are probed.
        const pinned = ctx?.mochiDocuments?.pdfExportEngineCandidates;
        const engine = Array.isArray(pinned) && pinned.length > 0
          ? await probePdfExportEngine({ candidates: pinned, searchPath: false })
          : await probePdfExportEngine();
        if (!engine.available) {
          const probed = engine.probed.map((entry) => entry.path);
          throw toolFailure(
            'EXPORT_ENGINE_UNAVAILABLE',
            `本机没有可用的 PDF 导出引擎（LibreOffice/soffice）。已按固定顺序探测 ${probed.length} 个位置，例如：${probed.slice(0, 5).join('、')}。不会假装导出，也不会用 HTML/图片冒充 PDF。请先在本机安装 LibreOffice，或改用 doc_create 直接生成结构化 PDF。`,
          );
        }
        throwIfAborted(exec?.signal);
        outputDirectory = await reserveVersionDirectory(exec, workspace);
        const exported = await exportDocxToPdfFile({
          docxPath: target.path,
          outputDirectory,
          sofficePath: engine.engine,
          signal: exec?.signal,
        });
        return {
          工具: 'doc_export',
          状态: '已完成',
          源文件: target.path,
          导出格式: 'pdf',
          导出文件: exported.pdfPath,
          输出目录: outputDirectory,
          字节数: exported.bytes,
          页数: exported.pageCount,
          校验和: exported.sha256,
          导出引擎: exported.engine,
          引擎探测: engine.probed.map((entry) => ({ 路径: entry.path, 可用: entry.available })),
          说明: 'PDF 由本机 LibreOffice 从该 DOCX 真实转换而来，并已回读校验为有效 PDF（含 %PDF- 头与至少 1 页）。未使用 HTML/图片替代。',
        };
      } catch (error) {
        if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true }).catch(() => {});
        throwAsToolError(error);
      }
    },
  });
}

function pdfReadTool(ctx) {
  return defineTool({
    name: 'pdf_read',
    description: '读取已存在 PDF 的页结构与文本：返回页数、每页尺寸/旋转/字体数/文本，以及标题、作者等元数据；pages 可传 "1-3,5" 形式的页范围。文本抽取依赖字体自带的 ToUnicode 映射：若该 PDF 没有可用映射，会如实返回“本机没有可用的 PDF 文本抽取能力”及原因，不 OCR、不伪造。只读，不修改文件。路径可以是当前会话工作区内的文件，也可以是老师上传附件时宿主给出的只读副本路径。',
    parameters: {
      path: { type: 'string', required: true, description: '要读取的 PDF 路径（绝对路径，或相对当前会话工作区）。' },
      pages: { type: 'string', description: '可选页范围，例如 "1-3,5"；省略表示全部页。' },
    },
    output,
    execute: async (args, exec) => {
      try {
        const workspace = await resolveWorkspace(ctx, exec);
        const target = await resolveInputFile(workspace, args?.path, { label: '要读取的 PDF', extensions: PDF_EXTENSIONS });
        const bytes = await readFile(target.path);
        const structure = await readPdfStructure(bytes, { pageRange: args?.pages });
        return {
          工具: 'pdf_read',
          路径: target.path,
          字节数: bytes.length,
          页数: structure.pageCount,
          已读取页: structure.pageRange ?? '全部',
          元数据: structure.metadata,
          页: structure.pages.map((page) => ({
            页: page.page,
            宽: page.width,
            高: page.height,
            旋转: page.rotation,
            字体数: page.fontCount,
            文本: page.text,
            文本字符数: page.textCharCount,
            文本被截断: page.textTruncated,
            未解析编码数: page.unresolvedCodeCount,
            抽取方式: page.extraction,
          })),
          文本抽取可用: structure.textExtraction.available,
          文本抽取方式: structure.textExtraction.method,
          文本抽取不可用原因: structure.textExtraction.reason,
          文本抽取边界: structure.textExtraction.boundary,
          全文文本: structure.documentText,
        };
      } catch (error) {
        throwAsToolError(error);
      }
    },
  });
}

export function apply(ctx) {
  ctx.tools.register(createDocumentCreateTool(ctx, 'mochi_document_create'));
  ctx.tools.register(createDocumentCreateTool(ctx, 'doc_create'));
  ctx.tools.register(docReadTool(ctx));
  ctx.tools.register(docEditTool(ctx));
  ctx.tools.register(docExportTool(ctx));
  ctx.tools.register(pdfReadTool(ctx));
}
