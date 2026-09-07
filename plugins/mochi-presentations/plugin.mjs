// mochi-presentations · 聊天接线（MOCHI-P2-TS-02）
//
// 插件入口模式照抄 plugins/mochi-dispatch/index.mjs：name / inject:['tools'] /
// output 双参 render（大坑 17）/ apply(ctx)。
// @deepseek-ai/dsh-tools 不在本插件的 node_modules 且本票禁止 npm install，
// 因此按物理路径复用 mochi-dispatch 已安装的同一份包（导出 API 完全一致）。
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineTool } from '../mochi-dispatch/node_modules/@deepseek-ai/dsh-tools/lib/index.js';
import JSZip from 'jszip';
import { MochiPresentationsError, generatePresentationBundle, revisePresentationBundle } from './index.mjs';

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

export function apply(ctx) {
  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }));

  register('mochi.ppt_create', '根据老师给的大纲生成上课用真 .pptx 课件（pptxgenjs 本地生成，绝不用 HTML/网页充数）。老师要"新做一份课件"时用本工具。返回产物绝对路径与 sourcePath；之后老师要改第 X 页时，必须用 mochi.ppt_revise 携带该 sourcePath 做增量修改，不要重新生成整套课件（重生成会丢老师已确认的内容）。', {
    title: { type: 'string', required: true, description: '课件标题（≤100 字）。' },
    slides: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string', required: true, description: '页标题（≤100 字）。' },
          bullets: { type: 'array', required: true, items: { type: 'string' }, description: '本页要点（1-6 条，每条 ≤140 字）。' },
        },
        additionalProperties: false,
      },
      description: '每页一项：{heading: 页标题, bullets: 要点数组}。',
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
        return {
          id: `slide-${index + 1}`,
          version: 1,
          layout: 'title-body',
          title: heading,
          body: bullets,
          source: {
            label: `${title} ${pageLabel}`.slice(0, 160),
            reference: `chat:mochi.ppt_create:${deckId}:slide-${index + 1}`.slice(0, 500),
          },
        };
      }),
    };
    let bundle;
    try { bundle = await generatePresentationBundle({ presentation, outputDirectory }); } catch (error) { rethrow(error); }
    return {
      tool: 'mochi.ppt_create',
      完成: true,
      页数: presentation.slides.length,
      产物: { pptx: bundle.pptxPath, pdf: bundle.pdfPath, manifest: bundle.manifestPath },
      sourcePath: bundle.sourcePath,
      提示: `已生成可编辑 .pptx（真 PowerPoint 文件）。老师之后要改第 X 页时，用 mochi.ppt_revise 并带上本次返回的 sourcePath，不要从头重新生成。旧版本保留在 ${bundle.outputDirectory}。`,
    };
  });

  register('mochi.ppt_revise', '老师要改已生成课件的某一页（说"第 X 页改成…"）时用本工具：只重写指定页，其余页的 slide XML 与旧版逐字节一致（生成后用 jszip 重开核验），并写入全新目录——永不覆盖老师已确认的旧版本。previousSourcePath 用上次 create/revise 返回的 sourcePath；instruction 填老师的修改说明；newTitle/newBody 填改后的新内容（至少给一个）。绝不要用 ppt_create 从头重做整套课件。', {
    previousSourcePath: { type: 'string', required: true, description: '上次课件生成的 sourcePath（绝对路径，原样传入，不得猜测）。' },
    page: { type: 'integer', required: true, description: '要修改的页码（正整数，第 1 页 = 1）。' },
    instruction: { type: 'string', required: true, description: '本页修改说明（老师的原话或归纳）。' },
    outputDirectory: { type: 'string', required: true, description: '全新的输出目录（绝对路径，必须不存在；旧版本原样保留）。' },
    newTitle: { type: 'string', description: '改后的本页标题；不改标题则省略。' },
    newBody: { type: 'array', items: { type: 'string' }, description: '改后的本页要点（1-6 条，每条 ≤140 字）；不改要点则省略。' },
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
    if (!newTitle && !newBody) {
      throw new Error('请把老师要改成的结果写进 newTitle / newBody（至少给一个）；instruction 只是修改说明，工具不会替你改写内容。');
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
    const marker = newTitle ?? newBody[0];
    if (!changedXml.includes(marker)) {
      throw new Error(`【mochi-presentations】核验失败：第 ${page} 页 slide XML 中找不到新内容（${marker.slice(0, 40)}…）。请检查产物。`);
    }
    return {
      tool: 'mochi.ppt_revise',
      完成: true,
      修改页: page,
      slideId: target.id,
      修改说明: instruction,
      ...(newTitle ? { 新标题: newTitle } : {}),
      ...(newBody ? { 新要点: newBody } : {}),
      未改动页: untouched,
      核验结论: `第 ${untouched.join('、')} 页的 slide XML 与旧版逐字节一致；仅第 ${page} 页被重写并包含新内容。`,
      产物: { pptx: bundle.pptxPath, pdf: bundle.pdfPath, manifest: bundle.manifestPath },
      sourcePath: bundle.sourcePath,
      旧版仍在: dirname(previousSourcePath),
    };
  });

  console.log(`[mochi-presentations] 课件域就绪：mochi.ppt_create / mochi.ppt_revise（真 .pptx，禁止 HTML 充数）`);
}
