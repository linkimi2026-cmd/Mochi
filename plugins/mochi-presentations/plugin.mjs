// mochi-presentations · 聊天接线（MOCHI-P2-TS-02）
//
// 插件入口模式照抄 plugins/mochi-dispatch/index.mjs：name / inject:['tools'] /
// output 双参 render（大坑 17）/ apply(ctx)。
// dsh-tools 由 desktop alpha runtime 根 node_modules 提供；不得跨插件物理路径导入。
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import JSZip from 'jszip';
import {
  MochiPresentationsError,
  SUPPORTED_LAYOUTS,
  THEME_NAMES,
  createInspectPathGuard,
  generatePresentationBundle,
  inspectPresentationFile,
  resolveInspectAllowedRoots,
  revisePresentationBundle,
} from './index.mjs';
import { registerPresentationRenderTool } from './render.mjs';
import { PROCESS_SCHEMA } from './process-layout.mjs';

export const name = 'mochi-presentations';
export const inject = ['tools'];
// ⚠️ render 签名是 (args, value)（2026-09-05 大坑 17）：单参写法会把调用参数当结果给模型。
export const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

const PPTX_NAME = 'presentation.pptx';
const MAX_SLIDE_TITLE = 100;
const MAX_BULLET = 140;
const MAX_BULLETS = 6;
const MAX_BODY_SUM = 520;
const SOURCE_SCHEMA = {
  type: 'object',
  description: '本页实际资料的声明，尚未经工具独立核验。没有真实资料就省略，课件会标“未核验 · 未提供来源”；不得用课件标题、聊天 ID 或猜测页码充当来源。',
  properties: {
    label: { type: 'string', required: true, description: '真实教材、文章、资料或教师提供材料的名称（≤160字）。' },
    reference: { type: 'string', description: '可追溯定位，如教材版本与页码、文献编号或 URL（≤500字）；不确定时省略。' },
  },
  additionalProperties: false,
};
const TEACHING_PLAN_SCHEMA = {
  type: 'object',
  description: '课堂课件可选的声明性教学计划。objectives 提供简短学习目标；slideMappings 按 create 返回的稳定页号 slide-1、slide-2 等映射教学页。封面/章节页可不映射；每个目标需有关联页面和理解检查，计划至少声明一项学生行动，已映射页面需写角色。不要用于一般演示文稿。完整结构不代表教学设计或学科事实正确。',
  properties: {
    objectives: {
      type: 'array',
      description: '0-8 个简短学习目标；不确定时保持精简。每项 {id, statement}，id 在本计划内唯一。',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', required: true, description: '计划内唯一标识，最多40字。' },
          statement: { type: 'string', description: '简短、可观察的学习目标，最多180字。' },
        },
        additionalProperties: false,
      },
    },
    slideMappings: {
      type: 'array',
      description: '按 slideId 为需要覆盖的教学页面作声明；封面或章节页可不映射。角色只描述该页用途，不规定固定顺序。理解检查按目标在计划内汇总，学生行动至少声明一项即可；允许省略字段以生成明确的不完整提示。',
      items: {
        type: 'object',
        properties: {
          slideId: { type: 'string', required: true, description: '本工具生成页号，如 slide-1；须实际存在。' },
          objectiveIds: { type: 'array', items: { type: 'string' }, description: '引用 teachingPlan.objectives 中的 id。' },
          role: { type: 'string', description: '本页作用，如引入、解释、练习、检查或迁移，不要求特定顺序。' },
          studentAction: { type: 'string', description: '学生在本页要做什么。' },
          understandingCheck: { type: 'string', description: '用什么可见回答、操作或作品观察理解。' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

// 把库内的结构化错误翻译成模型可执行的中文指引，其余错误原样上抛。
function rethrow(error) {
  if (!(error instanceof MochiPresentationsError)) throw error;
  const hints = {
    OUTPUT_EXISTS: '输出目录已存在——已确认的旧版本不会被覆盖，请换一个全新的输出目录。',
    INVALID_OUTPUT_DIRECTORY: 'outputDirectory 必须是宿主指定的绝对路径。',
    INVALID_INPUT: '课件结构不合法：请按前面的具体原因修正。内容页最多6条且每条≤140字；节奏页受排版后总行数限制，长句换行也计入，可精简副题或换为title-body。',
    INVALID_REVISION: '上次课件的生成源路径不可用或修订目标不存在：请原样使用上次 create/revise 返回的 sourcePath。',
    PPTX_NOT_FOUND: '要检查的 .pptx 不存在：请先用 file_search 找到真实路径再传入，不要凭记忆拼路径。',
    PPTX_NOT_ZIP: '这个文件不是 ZIP 容器，只是扩展名叫 .pptx：它根本不是 PowerPoint 文件。请如实告诉老师，不要描述其中的“幻灯片”。',
    PPTX_NOT_PRESENTATION: '这不是 PowerPoint 演示文稿（可能是改了扩展名的 Word/Excel 文件）。请如实告诉老师文件类型不符，不要把它当作课件来读或改。',
    PPTX_DAMAGED: '这个 .pptx 的 OOXML 部件损坏或缺失，读不出完整结构。请如实告知老师文件可能已损坏，建议在 PowerPoint 中重新另存一份。',
    PRESENTATION_QUALITY_BLOCKED: '生成的 PPTX 未通过客观结构或字号底线检查，文件不会发布；请按错误细节修正后重新生成。',
    PPTX_TOO_LARGE: '文件或某个部件超过只读检查的大小上限：请如实告诉老师“文件超出检查上限、没有完整读取”，不要假装读完了。',
    PPTX_TOO_MANY_SLIDES: '页数超过只读检查上限：请如实告诉老师“只检查了上限内的页数/未逐页检查”，不要编造未读取的页面内容。',
    PPTX_UNREADABLE: '文件存在但读取失败（权限或磁盘错误）：请如实告知老师，并建议检查文件权限。',
    PATH_UNSAFE: '该路径是符号链接，只读检查拒绝跟随。',
    PATH_ESCAPE: '路径越出了当前允许的工作区目录：只能检查工作区（或老师显式授权的目录）内的文件，请换用工作区内的路径。',
    PATH_UNAVAILABLE: '路径所在目录不存在。',
    BAD_PATH: '路径参数不合法（为空或含非法字符）。',
    NO_ALLOWED_ROOT: '当前没有可用的允许根目录：为避免越权读取磁盘，ppt_inspect 拒绝运行。',
    ROOT_UNAVAILABLE: '允许根目录不可用：请确认会话工作区存在。',
    ROOT_UNSAFE: '允许根目录是符号链接或不是目录，已拒绝。',
    WORKSPACE_UNAVAILABLE: '当前会话没有受管工作区：为避免越权读取磁盘，ppt_inspect 拒绝运行。',
    ABORTED: '检查已被取消。',
    XML_INVALID: 'OOXML 部件不是合法 XML，结构无法读取。',
  };
  const hint = hints[error.code] ?? '请修正参数后重试。';
  throw new Error(`【mochi-presentations】${error.code}：${error.message}。${hint}`);
}

function previewNote(bundle) {
  return bundle.previewPdfPath
    ? 'presentation-preview.pdf 由最终 PPTX 经 LibreOffice 转换，可打开回看；presentation.pdf 是单独排版的讲义。目标机 PowerPoint/WPS 效果仍需实机确认。'
    : `PPTX 原样预览未生成（${bundle.manifest.preview.reason === 'SOFFICE_UNAVAILABLE' ? '本机未找到 LibreOffice' : 'LibreOffice 转换失败'}）；presentation.pdf 仅为单独排版的讲义，不能代替 PPTX 预览。`;
}

function absoluteOutput(args) {
  const outputDirectory = String(args.outputDirectory || '').trim();
  if (!outputDirectory) throw new Error('请给出全新的输出目录（outputDirectory，绝对路径）——旧版本永远不会被覆盖。');
  return outputDirectory;
}

// 版本纪律：revise/create 永远写全新目录。先做一次确定性存在性检查，
// 给出可直接执行的中文报错；库内 OUTPUT_EXISTS 守卫仍作为并发第二道防线。
async function assertFreshOutput(outputDirectory) {
  try {
    await stat(outputDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new Error(`【mochi-presentations】输出目录不可用（${error?.code ?? '未知错误'}）：请换一个绝对路径的全新目录。`);
  }
  throw new Error('【mochi-presentations】输出目录已存在：为不覆盖老师已确认的版本，请换一个全新的输出目录再试。');
}

function normalizeBullets(raw, pageLabel, allowEmpty = false) {
  if (!Array.isArray(raw) || (!allowEmpty && raw.filter((line) => String(line ?? '').trim()).length < 1)) {
    throw new Error(`${pageLabel}缺少 bullets：请给出至少 1 条要点。`);
  }
  const bullets = raw.map((line) => String(line ?? '').trim()).filter(Boolean);
  if (bullets.length > MAX_BULLETS) throw new Error(`${pageLabel}的 bullets 超过 ${MAX_BULLETS} 条，请精简。`);
  if (bullets.some((line) => line.length > MAX_BULLET)) throw new Error(`${pageLabel}的某条要点超过 ${MAX_BULLET} 字，请精简。`);
  if (bullets.reduce((sum, line) => sum + line.length, 0) > MAX_BODY_SUM) throw new Error(`${pageLabel}的文字总量超出投影排版上限，请精简。`);
  return bullets;
}

function visualSpec(raw, pageLabel, { tableKey = 'table', chartKey = 'chart', processKey = 'process', comparisonKey = 'comparison' } = {}) {
  const table = raw?.[tableKey];
  const chart = raw?.[chartKey];
  const process = raw?.[processKey];
  const comparison = raw?.[comparisonKey];
  const visuals = [table, chart, process, comparison].filter((value) => value !== undefined);
  if (visuals.length > 1) throw new Error(`${pageLabel}的table/chart/process/comparison只能选择一种主视觉。`);
  if (table !== undefined && (!table || typeof table !== 'object' || Array.isArray(table))) throw new Error(`${pageLabel}的 table 必须是 {headers, rows} 对象。`);
  if (chart !== undefined && (!chart || typeof chart !== 'object' || Array.isArray(chart))) throw new Error(`${pageLabel}的 chart 必须是 {type, labels, series} 对象。`);
  return {
    ...(table === undefined ? {} : { table }),
    ...(chart === undefined ? {} : { chart }),
    ...(process === undefined ? {} : { process }),
    ...(comparison === undefined ? {} : { comparison }),
  };
}

function selectLayout(requested, visual, fallback = 'title-body') {
  const layout = requested ?? (visual.process ? 'title-process' : visual.comparison ? 'title-compare' : visual.chart ? 'title-chart' : visual.table ? 'title-table' : fallback);
  if (!SUPPORTED_LAYOUTS.includes(layout)) throw new Error(`未知版式：${layout}`);
  if (visual.process !== undefined && layout !== 'title-process') throw new Error('process 必须使用 title-process 版式。');
  if (visual.table !== undefined && layout !== 'title-table') throw new Error('table 必须使用 title-table 版式。');
  if (visual.chart !== undefined && layout !== 'title-chart') throw new Error('chart 必须使用 title-chart 版式。');
  if (visual.comparison !== undefined && layout !== 'title-compare') throw new Error('comparison 必须使用 title-compare 版式。');
  return layout;
}

// 用 jszip 重开新旧两份 pptx，逐字节核验未改动页的 slide XML。
async function slideXmlBuffers(pptxPath, pageCount) {
  const archive = await JSZip.loadAsync(await readFile(pptxPath));
  const buffers = [];
  for (let number = 1; number <= pageCount; number += 1) {
    const entry = archive.file(`ppt/slides/slide${number}.xml`);
    if (!entry) throw new Error(`【mochi-presentations】产物缺页：${pptxPath} 中没有 ppt/slides/slide${number}.xml。`);
    buffers.push(await entry.async('nodebuffer'));
  }
  return buffers;
}

async function chartXmlForSlide(pptxPath, page) {
  const archive = await JSZip.loadAsync(await readFile(pptxPath));
  const relationships = archive.file(`ppt/slides/_rels/slide${page}.xml.rels`);
  if (!relationships) return undefined;
  const match = (await relationships.async('text')).match(/Target="([^"]*charts\/[^"]+\.xml)"/u);
  if (!match) return undefined;
  // PptxGenJS emits both relative (../charts/...) and package-root
  // (/ppt/charts/...) targets depending on whether a chart is newly revised.
  // Normalize only the expected OOXML chart subtree; never follow arbitrary
  // archive-relative paths.
  const archiveName = match[1].startsWith('/') ? match[1].slice(1) : join('ppt/slides', match[1]);
  if (!archiveName.startsWith('ppt/charts/')) return undefined;
  const chart = archive.file(archiveName);
  return chart ? chart.async('nodebuffer') : undefined;
}

export function apply(ctx, options = {}) {
  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }));

  // ppt_inspect 的允许根：宿主/测试的 options.allowedRoots → MOCHI_PRESENTATIONS_ROOTS
  // → 当前会话工作区。默认只有工作区，绝不放开主目录；每次调用重新解析（会话可能变）。
  async function inspectGuard(exec) {
    const { entries, source, rejected } = await resolveInspectAllowedRoots({ ctx, exec, options });
    return { guard: createInspectPathGuard(entries), source, rejected };
  }

  register('mochi_ppt_create', '生成真实可编辑 .pptx，返回产物路径、sourcePath、客观结构质量状态及可选的教学覆盖声明报告；客观页数/字号硬错误会阻止发布。结构检查通过不代表已验收；视觉复核仍须实际查看图像附件，预览可用也不证明美学或学科正确。若本机有 LibreOffice，同时返回由最终 PPTX 转换的 previewPdf 路径，教师可打开回看。pdf 字段是独立排版的讲义，绝不充当原样预览。先通过 skill 加载 classroom-deck，按目标准备简短逐页大纲。课堂教学可附 teachingPlan，列目标、逐页作用、学生行动和理解检查；一般演示可省略。该报告只核字段完整及目标/页号引用，不判断教学法或学科正确性。映射页的目标、页面作用、学生行动和理解检查会写入 PPTX 演讲者备注；备注中仍标明教学声明未经核验。逐页 source 只填真实可追溯资料；省略则明确标“未核验 · 未提供来源”，填写后也标“来源声明，未核验”。支持主题、封面/章节/重点/数字/结束页、文字/表格/图表、title-process流程图和title-compare两栏逐项对照；对照内容使用comparison左右标题与2-4组配对短句。所有文字/表格/图形均为可编辑对象；不支持图片、自由坐标、字体或动画参数。输入超量先精简或拆页，不凑最低字数。生成后主动用 ppt_inspect 核对内容，再调用 mochi_ppt_render：overview 看全册、page 看密集页/图表页/疑似缺陷页。首次通过不必修改；有证据的问题用 mochi_ppt_revise 定页修改，使用最新 sourcePath 和最新 PPTX 复验，每个问题最多两轮，剩余硬缺陷标为待修稿。不要重做老师已确认的其他页。', {
    title: { type: 'string', required: true, description: '课件标题（≤100 字）。' },
    theme: { type: 'string', enum: THEME_NAMES, description: '全册配色预设。文史 ink/archive，自然 field，理科 lab，信息 swiss，深色 midnight，艺术 stage，活动 festive，默认 neutral；按内容选，不必每次更换。' },
    teachingPlan: TEACHING_PLAN_SCHEMA,
    slides: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        properties: {
          layout: { type: 'string', enum: SUPPORTED_LAYOUTS, description: '可选：cover封面、section章节、statement重点陈述、kpi已核实数字、closing总结；内容页title-body/title-table/title-chart；流程图title-process；左右逐项对照title-compare（必须填comparison，可省略要点）。省略则按process/comparison/table/chart推断。节奏页只写短副题，允许bullets=[]，不凑要点。' },
          process: PROCESS_SCHEMA,
          comparison: {
            type: 'object',
            description: '可选的两栏对照数据：{leftTitle, rightTitle, rows:[{left,right}, ...]}；2-4组短句按行一一对应，每格投影最多2行。仅在内容确实成对时使用，如两个概念/方案或活动线索与记录方式、行动设计与完成标准；普通任务步骤或独立要点保留title-body。与table/chart/process互斥，使用title-compare；所有文字都是可编辑对象。',
            properties: {
              leftTitle: { type: 'string', required: true, description: '左栏标题，≤40字且投影宽度受限。' },
              rightTitle: { type: 'string', required: true, description: '右栏标题，≤40字且投影宽度受限。' },
              rows: { type: 'array', required: true, description: '2-4组对应短句，每格≤100字且最多2行。', items: { type: 'object', properties: { left: { type: 'string', required: true, description: '左侧配对短句；投影最多2行。' }, right: { type: 'string', required: true, description: '右侧配对短句；投影最多2行。' } }, additionalProperties: false } },
            },
            additionalProperties: false,
          },
          heading: { type: 'string', required: true, description: '页标题（≤100 字；超过两行投影预算会被拒绝）。' },
          bullets: { type: 'array', required: true, items: { type: 'string' }, description: '字段名是bullets。本页要点：内容页1-6条，每条≤140字；节奏页可为空，排版后正文总行数cover/statement/closing≤3、section≤2、kpi≤4，长句换行也计入。' },
          source: SOURCE_SCHEMA,
          table: {
            type: 'object',
            description: '可选。PowerPoint 原生可编辑表格：{headers: [2-5 个短列名], rows: [[...], ...]}；与 chart 二选一。',
            properties: {
              headers: { type: 'array', required: true, items: { type: 'string' } },
              rows: { type: 'array', required: true, items: { type: 'array', items: { type: 'string' } } },
            },
            additionalProperties: false,
          },
          chart: {
            type: 'object',
            description: '可选。PowerPoint 原生可编辑图表：{type:"bar"|"line"|"pie", title?, labels:[2-8项], series:[{name, values}]}；与 table 二选一。课堂示例数据必须在要点中标明来源或“示例”。',
            properties: {
              type: { type: 'string', required: true },
              title: { type: 'string' },
              labels: { type: 'array', required: true, items: { type: 'string' } },
              series: { type: 'array', required: true, items: { type: 'object', properties: { name: { type: 'string', required: true }, values: { type: 'array', required: true, items: { type: 'number' } } }, additionalProperties: false } },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      description: '每页一项：{heading, bullets, source?, layout?, table? | chart? | process? | comparison?}。source 仅填真实资料声明，省略则明确标未核验。表格、图表和两栏对照均为真 PPTX 可编辑对象。',
    },
    outputDirectory: { type: 'string', required: true, description: '全新的输出目录（绝对路径，必须不存在）。' },
  }, async (args) => {
    const title = String(args.title || '').trim();
    if (!title) throw new Error('请给出课件标题（title）。');
    if (title.length > MAX_SLIDE_TITLE) throw new Error(`课件标题超过 ${MAX_SLIDE_TITLE} 字，请精简。`);
    if (!Array.isArray(args.slides) || args.slides.length < 1) throw new Error('请给出至少一页内容（slides 数组：{heading, bullets[]}）。');
    const outputDirectory = absoluteOutput(args);
    await assertFreshOutput(outputDirectory);
    const deckId = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const presentation = {
      schema: 'mochi-lesson-presentation-v1',
      // sourceKind describes how the deck was authored, not whether cited facts were checked.
      sourceKind: 'model-authored-classroom-draft',
      deckId,
      version: 1,
      title,
      ...(args.theme === undefined ? {} : { theme: args.theme }),
      ...(args.teachingPlan === undefined ? {} : { teachingPlan: args.teachingPlan }),
      slides: args.slides.map((slide, index) => {
        const pageLabel = `第 ${index + 1} 页`;
        const heading = String(slide?.heading || '').trim();
        if (!heading) throw new Error(`${pageLabel}缺少 heading（页标题）。`);
        if (heading.length > MAX_SLIDE_TITLE) throw new Error(`${pageLabel}的 heading 超过 ${MAX_SLIDE_TITLE} 字，请精简。`);
        const visual = visualSpec(slide, pageLabel);
        const layout = selectLayout(slide?.layout, visual);
        const bullets = normalizeBullets(slide?.bullets, pageLabel, layout === 'title-process' || layout === 'title-compare' || !layout.startsWith('title-'));
        return {
          id: `slide-${index + 1}`,
          version: 1,
          layout,
          title: heading,
          body: bullets,
          ...visual,
          source: slide?.source ?? null,
        };
      }),
    };
    let bundle;
    try { bundle = await generatePresentationBundle({ presentation, outputDirectory, converter: options.converter }); } catch (error) { rethrow(error); }
    return {
      tool: 'mochi_ppt_create',
      完成: true,
      页数: presentation.slides.length,
      产物: { pptx: bundle.pptxPath, previewPdf: bundle.previewPdfPath, pdf: bundle.pdfPath, manifest: bundle.manifestPath },
      sourcePath: bundle.sourcePath,
      预览状态: bundle.manifest.preview.status,
      预览说明: previewNote(bundle),
      质量状态: bundle.manifest.quality.status,
      结构检查: bundle.manifest.quality.structuralStatus,
      字号检查口径: bundle.manifest.quality.fontCheckBasis,
      质量提示: bundle.manifest.quality.hints,
      教学覆盖: bundle.manifest.quality.teachingCoverage,
      视觉复核: bundle.manifest.quality.visualReview.note,
      来源说明: '逐页资料只记录声明，未经独立核验；未提供的页面已明确标注“未核验 · 未提供来源”。',
      提示: `已生成可编辑 .pptx（真 PowerPoint 文件）。老师之后要改第 X 页时，用 mochi_ppt_revise 并带上本次返回的 sourcePath，不要从头重新生成。旧版本保留在 ${bundle.outputDirectory}。`,
    };
  });

  register('mochi_ppt_revise', '老师要改已生成课件的某一页（说“第 X 页改成…”）时用本工具：只重写指定页，其余页的 slide XML 与旧版逐字节一致（生成后用 jszip 重开核验），并写入全新目录——永不覆盖老师已确认的旧版本。返回基于修订后最终 PPTX 字节重算的结构质量状态与教学覆盖声明报告；结构检查通过不代表已验收，视觉复核仍须实际查看图像附件。previousSourcePath 用上次 create/revise 返回的 sourcePath；instruction 填老师的修改说明；newTitle/newBody/newLayout/newTable/newChart/newProcess/newComparison/newSource/clearSource 填改后的本页内容、版式或来源（至少给一个）。若改了可见内容且不更新 newTeachingPlan，受影响页的旧映射会在报告和 PPTX 演讲者备注中标记为待复核；需要时用 newTeachingPlan 替换整份声明计划。资料声明始终未核验。绝不要用 ppt_create 从头重做整套课件。', {
    previousSourcePath: { type: 'string', required: true, description: '上次课件生成的 sourcePath（绝对路径，原样传入，不得猜测）。' },
    page: { type: 'integer', required: true, description: '要修改的页码（正整数，第 1 页 = 1）。' },
    instruction: { type: 'string', required: true, description: '本页修改说明（老师的原话或归纳）。' },
    outputDirectory: { type: 'string', required: true, description: '全新的输出目录（绝对路径，必须不存在；旧版本原样保留）。' },
    newLayout: { type: 'string', enum: SUPPORTED_LAYOUTS, description: '可选：只修改本页版式；切换至table/chart/process/compare时需提供对应数据。其余页保持不变。' },
    newTitle: { type: 'string', description: '改后的本页标题；不改标题则省略。' },
    newBody: { type: 'array', items: { type: 'string' }, description: '改后的本页要点（1-6 条，每条 ≤140 字）；不改要点则省略。' },
    newTeachingPlan: { ...TEACHING_PLAN_SCHEMA, description: '可选：替换整份教学目标与逐页映射；省略时保留旧声明。若已修订可见内容，可在新计划中重核目标、角色、学生行动和理解检查以清除旧页的待复核标记。' },
    newSource: SOURCE_SCHEMA,
    clearSource: { type: 'boolean', description: '设 true 删除本页原来源声明，并标“未核验 · 未提供来源”；不能和 newSource 同时使用。' },
    newProcess: PROCESS_SCHEMA,
    newComparison: {
      type: 'object',
      description: '改为两栏逐项对照 {leftTitle,rightTitle,rows:[{left,right},...]}；2-4组短句，每格投影最多2行，填入后切换为 title-compare。',
      properties: {
        leftTitle: { type: 'string', required: true, description: '≤40字。' },
        rightTitle: { type: 'string', required: true, description: '≤40字。' },
        rows: { type: 'array', required: true, description: '2-4组对应短句，每格≤100字且最多2行。', items: { type: 'object', properties: { left: { type: 'string', required: true }, right: { type: 'string', required: true } }, additionalProperties: false } },
      },
      additionalProperties: false,
    },
    newTable: {
      type: 'object',
      description: '改后的原生表格 {headers, rows}；填入后本页切换为表格版式，不能与 newChart/newProcess/newComparison 同时填写。',
      properties: {
        headers: { type: 'array', required: true, items: { type: 'string' } },
        rows: { type: 'array', required: true, items: { type: 'array', items: { type: 'string' } } },
      },
      additionalProperties: false,
    },
    newChart: {
      type: 'object',
      description: '改后的原生图表 {type, title?, labels, series}；填入后本页切换为图表版式，不能与 newTable/newProcess/newComparison 同时填写。',
      properties: {
        type: { type: 'string', required: true },
        title: { type: 'string' },
        labels: { type: 'array', required: true, items: { type: 'string' } },
        series: { type: 'array', required: true, items: { type: 'object', properties: { name: { type: 'string', required: true }, values: { type: 'array', required: true, items: { type: 'number' } } }, additionalProperties: false } },
      },
      additionalProperties: false,
    },
  }, async (args) => {
    const previousSourcePath = String(args.previousSourcePath || '').trim();
    if (!previousSourcePath) throw new Error('请给出上次课件的生成源路径（previousSourcePath，即上次返回的 sourcePath）。');
    const page = Number(args.page);
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('page 必须是正整数页码（第 1 页 = 1）。');
    const instruction = String(args.instruction || '').trim();
    if (!instruction) throw new Error('请给出本页修改说明（instruction）。');
    const outputDirectory = absoluteOutput(args);
    await assertFreshOutput(outputDirectory);
    const newTitle = args.newTitle === undefined ? undefined : String(args.newTitle || '').trim();
    if (newTitle !== undefined && newTitle.length > MAX_SLIDE_TITLE) throw new Error(`newTitle 超过 ${MAX_SLIDE_TITLE} 字，请精简。`);
    const newBody = args.newBody === undefined ? undefined : normalizeBullets(args.newBody, `第 ${page} 页`, true);
    const visual = visualSpec(args, `第 ${page} 页`, { tableKey: 'newTable', chartKey: 'newChart', processKey: 'newProcess', comparisonKey: 'newComparison' });
    if (args.newSource !== undefined && (!args.newSource || typeof args.newSource !== 'object' || Array.isArray(args.newSource))) throw new Error('newSource 必须是 {label, reference?} 资料声明；删除来源请用 clearSource: true。');
    if (args.newSource !== undefined && args.clearSource === true) throw new Error('newSource 和 clearSource 不能同时使用。');
    if (!newTitle && !newBody && args.newLayout === undefined && visual.table === undefined && visual.chart === undefined && visual.process === undefined && visual.comparison === undefined && args.newSource === undefined && args.clearSource !== true && args.newTeachingPlan === undefined) {
      throw new Error('请把老师要改成的结果写进 newTitle / newBody / newLayout / newTable / newChart / newProcess / newComparison / newSource / clearSource / newTeachingPlan（至少给一个）；instruction 只是修改说明，工具不会替你改写内容。');
    }
    let prior;
    try { prior = JSON.parse(await readFile(previousSourcePath, 'utf8')); } catch {
      throw new Error('previousSourcePath 不可读或不是课件生成的 source.json：请原样使用上次 create/revise 返回的 sourcePath。');
    }
    const priorSlides = Array.isArray(prior?.slides) ? prior.slides : [];
    if (page > priorSlides.length) {
      throw new Error(`第 ${page} 页不存在：这份课件共 ${priorSlides.length} 页，page 必须在 1-${priorSlides.length} 之间。`);
    }
    const target = priorSlides[page - 1];
    const revision = {
      slideId: target.id,
      layout: selectLayout(args.newLayout, visual, target.layout),
      ...(newTitle ? { title: newTitle } : {}),
      ...(newBody ? { body: newBody } : {}),
      ...(visual.table ? { table: visual.table } : {}),
      ...(visual.chart ? { chart: visual.chart } : {}),
      ...(visual.process ? { process: visual.process } : {}),
      ...(visual.comparison ? { comparison: visual.comparison } : {}),
      ...(args.newTeachingPlan === undefined ? {} : { teachingPlan: args.newTeachingPlan }),
      ...(args.newSource !== undefined ? { source: args.newSource } : args.clearSource === true ? { source: null } : {}),
    };
    let bundle;
    try { bundle = await revisePresentationBundle({ previousSourcePath, revision, outputDirectory, converter: options.converter }); } catch (error) { rethrow(error); }
    // Golden Demo 核验：未改页 slide XML 与旧版逐字节一致，改动页确实包含新内容。
    const previousPptxPath = join(dirname(previousSourcePath), PPTX_NAME);
    const [oldXml, newXml] = [await slideXmlBuffers(previousPptxPath, priorSlides.length), await slideXmlBuffers(bundle.pptxPath, priorSlides.length)];
    const untouched = [];
    for (let number = 1; number <= priorSlides.length; number += 1) {
      if (number === page) continue;
      if (!newXml[number - 1].equals(oldXml[number - 1])) {
        throw new Error(`【mochi-presentations】核验失败：第 ${number} 页未被要求修改，但 slide XML 与旧版不一致。请检查产物。`);
      }
      untouched.push(number);
    }
    const changedXml = newXml[page - 1].toString('utf8');
    const slideMarker = newTitle ?? newBody?.[0] ?? visual.table?.headers[0] ?? visual.comparison?.leftTitle ?? (args.newSource ? `来源声明：${args.newSource.label}` : args.clearSource === true ? '未核验 · 未提供来源' : undefined);
    let changedEvidence = `第 ${page} 页被重写并包含新内容。`;
    if (slideMarker && !changedXml.includes(slideMarker)) {
      throw new Error(`【mochi-presentations】核验失败：第 ${page} 页 slide XML 中找不到新内容（${slideMarker.slice(0, 40)}…）。请检查产物。`);
    }
    if (visual.chart) {
      const chartXml = await chartXmlForSlide(bundle.pptxPath, page);
      const marker = visual.chart.title ?? visual.chart.series?.[0]?.name ?? visual.chart.labels?.[0];
      if (!chartXml || !marker || !chartXml.toString('utf8').includes(marker)) {
        throw new Error(`【mochi-presentations】核验失败：第 ${page} 页原生图表 OOXML 中找不到新内容。请检查产物。`);
      }
      changedEvidence = `第 ${page} 页的原生图表 OOXML 已核验，未改页的 slide XML 与旧版逐字节一致。`;
    }
    return {
      tool: 'mochi_ppt_revise',
      完成: true,
      修改页: page,
      slideId: target.id,
      修改说明: instruction,
      ...(newTitle ? { 新标题: newTitle } : {}),
      ...(newBody ? { 新要点: newBody } : {}),
      ...(visual.table ? { 新表格: visual.table } : {}),
      ...(visual.chart ? { 新图表: visual.chart } : {}),
      ...(visual.comparison ? { 新对照: visual.comparison } : {}),
      ...(args.newSource !== undefined ? { 新来源声明: args.newSource } : {}),
      ...(args.clearSource === true ? { 已清除来源: true } : {}),
      来源状态: bundle.manifest.slides[page - 1].sourceStatus,
      未改动页: untouched,
      核验结论: `第 ${untouched.join('、')} 页的 slide XML 与旧版逐字节一致；${changedEvidence}`,
      产物: { pptx: bundle.pptxPath, previewPdf: bundle.previewPdfPath, pdf: bundle.pdfPath, manifest: bundle.manifestPath },
      sourcePath: bundle.sourcePath,
      预览状态: bundle.manifest.preview.status,
      预览说明: previewNote(bundle),
      质量状态: bundle.manifest.quality.status,
      结构检查: bundle.manifest.quality.structuralStatus,
      字号检查口径: bundle.manifest.quality.fontCheckBasis,
      质量提示: bundle.manifest.quality.hints,
      教学覆盖: bundle.manifest.quality.teachingCoverage,
      视觉复核: bundle.manifest.quality.visualReview.note,
      旧版仍在: dirname(previousSourcePath),
    };
  });

  register('ppt_inspect', '只读检查一个已有的 .pptx，让模型“看见”课件结构：总页数、幻灯片尺寸、每页的文字（标明标题/正文/页脚及判定依据）、图片/图表/表格的存在与数量、每页版式名、演讲者备注、文件大小与创建/修改时间等元数据。全部来自真实 OOXML 部件解析（ppt/presentation.xml、ppt/slides/*.xml、ppt/slideLayouts/**、ppt/notesSlides/**、docProps/**），不改动文件、不提取图像二进制。要改课件某页请改用 mochi_ppt_revise。如果传入的不是真 .pptx（ZIP 打不开、缺 ppt/presentation.xml、其实是改名的 Word/Excel 文件）会明确报错，不会返回“0 张幻灯片”。', {
    path: { type: 'string', required: true, description: '要检查的 .pptx 路径（绝对路径或工作区内的相对路径）。只能是允许根目录（默认当前工作区）内的文件。' },
    slide: { type: 'integer', description: '可选：只返回第 N 页（1 起）的详细结构；省略则返回全部页。' },
  }, async (args, exec) => {
    const target = String(args?.path || '').trim();
    if (!target) throw new Error('请给出要检查的 .pptx 路径（path）。');
    const rawSlide = args?.slide;
    let slide;
    if (rawSlide !== undefined && rawSlide !== null && rawSlide !== '') {
      slide = Number(rawSlide);
      if (!Number.isSafeInteger(slide) || slide < 1) throw new Error('slide 必须是正整数页码（第 1 页 = 1）；省略则返回全部页。');
    }
    let report;
    try {
      const { guard, rejected } = await inspectGuard(exec);
      const resolved = await guard.resolve(target, { field: '要检查的 .pptx 路径' });
      report = await inspectPresentationFile({ path: resolved.path, slide, signal: exec?.signal });
      if (rejected.length > 0) {
        report.被忽略的候选根 = rejected.map((item) => `${item.path}（${item.reason}）`);
      }
    } catch (error) { rethrow(error); }
    return {
      ...report,
      tool: 'ppt_inspect',
      提示: '以上为只读结构检查结果，没有修改文件。要改某一页请用 mochi_ppt_revise（带上上次返回的 sourcePath）；用本工具检查后如发现某页文字过多，请按「页数/文字」摘要精简后再修订。',
    };
  });

  // 视觉回看：把 .pptx 渲染成图交给声明了图像输入的模型自查（2026-09-12）。
  // 路径校验复用 ppt_inspect 的允许根，绝不因为「要渲染」就放开磁盘。
  registerPresentationRenderTool(ctx, {
    resolvePath: async (target, exec) => {
      const { guard } = await inspectGuard(exec);
      const resolved = await guard.resolve(target, { field: '要渲染的 .pptx 路径' });
      return resolved.path;
    },
  });

  console.log(`[mochi-presentations] 课件域就绪：mochi_ppt_create / mochi_ppt_revise / ppt_inspect / mochi_ppt_render（真 .pptx，渲染回看自查）`);
}
