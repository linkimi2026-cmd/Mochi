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
  createInspectPathGuard,
  generatePresentationBundle,
  inspectPresentationFile,
  resolveInspectAllowedRoots,
  revisePresentationBundle,
} from './index.mjs';
import { registerPresentationRenderTool } from './render.mjs';

export const name = 'mochi-presentations';
export const inject = ['tools'];
// ⚠️ render 签名是 (args, value)（2026-09-05 大坑 17）：单参写法会把调用参数当结果给模型。
export const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

const PPTX_NAME = 'presentation.pptx';
const MAX_SLIDE_TITLE = 100;
const MAX_BULLET = 140;
const MAX_BULLETS = 6;
const MAX_BODY_SUM = 520;

// 把库内的结构化错误翻译成模型可执行的中文指引，其余错误原样上抛。
function rethrow(error) {
  if (!(error instanceof MochiPresentationsError)) throw error;
  const hints = {
    OUTPUT_EXISTS: '输出目录已存在——已确认的旧版本不会被覆盖，请换一个全新的输出目录。',
    INVALID_OUTPUT_DIRECTORY: 'outputDirectory 必须是宿主指定的绝对路径。',
    INVALID_INPUT: '课件结构不合法：请按每页 ≤6 条要点、每条 ≤140 字精简后重试。',
    INVALID_REVISION: '上次课件的生成源路径不可用或修订目标不存在：请原样使用上次 create/revise 返回的 sourcePath。',
    PPTX_NOT_FOUND: '要检查的 .pptx 不存在：请先用 file_search 找到真实路径再传入，不要凭记忆拼路径。',
    PPTX_NOT_ZIP: '这个文件不是 ZIP 容器，只是扩展名叫 .pptx：它根本不是 PowerPoint 文件。请如实告诉老师，不要描述其中的“幻灯片”。',
    PPTX_NOT_PRESENTATION: '这不是 PowerPoint 演示文稿（可能是改了扩展名的 Word/Excel 文件）。请如实告诉老师文件类型不符，不要把它当作课件来读或改。',
    PPTX_DAMAGED: '这个 .pptx 的 OOXML 部件损坏或缺失，读不出完整结构。请如实告知老师文件可能已损坏，建议在 PowerPoint 中重新另存一份。',
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

function normalizeBullets(raw, pageLabel) {
  if (!Array.isArray(raw) || raw.filter((line) => String(line ?? '').trim()).length < 1) {
    throw new Error(`${pageLabel}缺少 bullets：请给出至少 1 条要点。`);
  }
  const bullets = raw.map((line) => String(line ?? '').trim()).filter(Boolean);
  if (bullets.length > MAX_BULLETS) throw new Error(`${pageLabel}的 bullets 超过 ${MAX_BULLETS} 条，请精简。`);
  if (bullets.some((line) => line.length > MAX_BULLET)) throw new Error(`${pageLabel}的某条要点超过 ${MAX_BULLET} 字，请精简。`);
  if (bullets.reduce((sum, line) => sum + line.length, 0) > MAX_BODY_SUM) throw new Error(`${pageLabel}的文字总量超出投影排版上限，请精简。`);
  return bullets;
}

function visualSpec(raw, pageLabel, { tableKey = 'table', chartKey = 'chart' } = {}) {
  const table = raw?.[tableKey];
  const chart = raw?.[chartKey];
  if (table !== undefined && chart !== undefined) throw new Error(`${pageLabel}不能同时放 table 和 chart：一页只保留一种主视觉，避免投影区域拥挤。`);
  if (table !== undefined && (!table || typeof table !== 'object' || Array.isArray(table))) throw new Error(`${pageLabel}的 table 必须是 {headers, rows} 对象。`);
  if (chart !== undefined && (!chart || typeof chart !== 'object' || Array.isArray(chart))) throw new Error(`${pageLabel}的 chart 必须是 {type, labels, series} 对象。`);
  return {
    ...(table === undefined ? {} : { table }),
    ...(chart === undefined ? {} : { chart }),
  };
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

  register('mochi_ppt_create', '根据老师给的大纲生成上课用真 .pptx 课件（pptxgenjs 本地生成，文本、原生表格和原生图表都可在 PowerPoint 中编辑，绝不用 HTML/网页充数）。每页可选一份 table 或 chart 主视觉；工具在生成前按固定投影版式预算拒绝文字或轴标签超量。老师要“新做一份课件”时用本工具。返回产物绝对路径与 sourcePath；之后老师要改第 X 页时，必须用 mochi_ppt_revise 携带该 sourcePath 做定页修改，不要重新生成整套课件（重生成会丢老师已确认的内容）。【排版要求】生成前先读设计规范：skills/classroom-deck/SKILL.md 会给出规范文件族的绝对路径（通用审美法则 / 版式库 / pptxgenjs 硬规则 / 场景分支）。必须按「先定调性 → 选版式合约 → 再动手」的顺序做，并逐条走完绘制前清单；课件每页要有视觉锚点、标题写观点而非分类名、关键数据必须给判断、禁止出现 AI 味破绽（标题下划线加横线、装饰色条、页页同一版式）。生成后必须调用 mochi_ppt_render 渲染回看，确认没有文字裁切、元素重叠、页面偏空，发现问题用 mochi_ppt_revise 修改后再次渲染复验——这是交付前的强制步骤，不能只靠读 OOXML 判断排版；结构完全正确而画面已经坏掉，是最常见的隐性缺陷。', {
    title: { type: 'string', required: true, description: '课件标题（≤100 字）。' },
    slides: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string', required: true, description: '页标题（≤100 字；超过两行投影预算会被拒绝）。' },
          bullets: { type: 'array', required: true, items: { type: 'string' }, description: '本页要点（1-6 条，每条 ≤140 字；表格/图表页最多约 3 行）。' },
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
      description: '每页一项：{heading, bullets, table? | chart?}。表格与图表均写入真 PPTX 的原生 Office 对象。',
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
      sourceKind: 'demonstration',
      deckId,
      version: 1,
      title,
      slides: args.slides.map((slide, index) => {
        const pageLabel = `第 ${index + 1} 页`;
        const heading = String(slide?.heading || '').trim();
        if (!heading) throw new Error(`${pageLabel}缺少 heading（页标题）。`);
        if (heading.length > MAX_SLIDE_TITLE) throw new Error(`${pageLabel}的 heading 超过 ${MAX_SLIDE_TITLE} 字，请精简。`);
        const bullets = normalizeBullets(slide?.bullets, pageLabel);
        const visual = visualSpec(slide, pageLabel);
        return {
          id: `slide-${index + 1}`,
          version: 1,
          layout: visual.chart ? 'title-chart' : visual.table ? 'title-table' : 'title-body',
          title: heading,
          body: bullets,
          ...visual,
          source: {
            label: `${title} ${pageLabel}`.slice(0, 160),
            reference: `chat:mochi_ppt_create:${deckId}:slide-${index + 1}`.slice(0, 500),
          },
        };
      }),
    };
    let bundle;
    try { bundle = await generatePresentationBundle({ presentation, outputDirectory }); } catch (error) { rethrow(error); }
    return {
      tool: 'mochi_ppt_create',
      完成: true,
      页数: presentation.slides.length,
      产物: { pptx: bundle.pptxPath, pdf: bundle.pdfPath, manifest: bundle.manifestPath },
      sourcePath: bundle.sourcePath,
      提示: `已生成可编辑 .pptx（真 PowerPoint 文件）。老师之后要改第 X 页时，用 mochi_ppt_revise 并带上本次返回的 sourcePath，不要从头重新生成。旧版本保留在 ${bundle.outputDirectory}。`,
    };
  });

  register('mochi_ppt_revise', '老师要改已生成课件的某一页（说“第 X 页改成…”）时用本工具：只重写指定页，其余页的 slide XML 与旧版逐字节一致（生成后用 jszip 重开核验），并写入全新目录——永不覆盖老师已确认的旧版本。previousSourcePath 用上次 create/revise 返回的 sourcePath；instruction 填老师的修改说明；newTitle/newBody/newTable/newChart 填改后的本页内容（至少给一个）。绝不要用 ppt_create 从头重做整套课件。', {
    previousSourcePath: { type: 'string', required: true, description: '上次课件生成的 sourcePath（绝对路径，原样传入，不得猜测）。' },
    page: { type: 'integer', required: true, description: '要修改的页码（正整数，第 1 页 = 1）。' },
    instruction: { type: 'string', required: true, description: '本页修改说明（老师的原话或归纳）。' },
    outputDirectory: { type: 'string', required: true, description: '全新的输出目录（绝对路径，必须不存在；旧版本原样保留）。' },
    newTitle: { type: 'string', description: '改后的本页标题；不改标题则省略。' },
    newBody: { type: 'array', items: { type: 'string' }, description: '改后的本页要点（1-6 条，每条 ≤140 字）；不改要点则省略。' },
    newTable: {
      type: 'object',
      description: '改后的原生表格 {headers, rows}；填入后本页切换为表格版式，不能与 newChart 同时填写。',
      properties: {
        headers: { type: 'array', required: true, items: { type: 'string' } },
        rows: { type: 'array', required: true, items: { type: 'array', items: { type: 'string' } } },
      },
      additionalProperties: false,
    },
    newChart: {
      type: 'object',
      description: '改后的原生图表 {type, title?, labels, series}；填入后本页切换为图表版式，不能与 newTable 同时填写。',
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
    const hasBody = Array.isArray(args.newBody) && args.newBody.some((line) => String(line ?? '').trim());
    const newBody = hasBody ? normalizeBullets(args.newBody, `第 ${page} 页`) : undefined;
    const visual = visualSpec(args, `第 ${page} 页`, { tableKey: 'newTable', chartKey: 'newChart' });
    if (!newTitle && !newBody && visual.table === undefined && visual.chart === undefined) {
      throw new Error('请把老师要改成的结果写进 newTitle / newBody / newTable / newChart（至少给一个）；instruction 只是修改说明，工具不会替你改写内容。');
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
      ...(newTitle ? { title: newTitle } : {}),
      ...(newBody ? { body: newBody } : {}),
      ...(visual.table ? { layout: 'title-table', table: visual.table } : {}),
      ...(visual.chart ? { layout: 'title-chart', chart: visual.chart } : {}),
    };
    let bundle;
    try { bundle = await revisePresentationBundle({ previousSourcePath, revision, outputDirectory }); } catch (error) { rethrow(error); }
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
    const slideMarker = newTitle ?? newBody?.[0] ?? visual.table?.headers[0];
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
      未改动页: untouched,
      核验结论: `第 ${untouched.join('、')} 页的 slide XML 与旧版逐字节一致；${changedEvidence}`,
      产物: { pptx: bundle.pptxPath, pdf: bundle.pdfPath, manifest: bundle.manifestPath },
      sourcePath: bundle.sourcePath,
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
