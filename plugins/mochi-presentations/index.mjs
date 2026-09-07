import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import pptxgen from 'pptxgenjs';
import {
  color as pdfColor,
  createPdfLayoutDocument,
  drawTable,
  drawTextBlock,
  inspectPdfArtifact,
  layoutTable,
  savePdfLayoutDocument,
  wrapText,
} from '@mochi/pdf-layout';

// Retained for callers that imported the prior host setting. Ordinary PDF generation no longer reads it.
export const DEFAULT_SOFFICE_PATH = '/opt/homebrew/bin/soffice';
const PPTX_NAME = 'presentation.pptx';
const PDF_NAME = 'presentation.pdf';
const MAX_SLIDES = 40;
const PROJECTION_FONT = 'Noto Sans SC';
const PDF_SLIDE_WIDTH = 960;
const PDF_SLIDE_HEIGHT = 540;

export class MochiPresentationsError extends Error {
  constructor(code, message) { super(message); this.name = 'MochiPresentationsError'; this.code = code; }
}
const failure = (code, message) => new MochiPresentationsError(code, message);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw failure('INVALID_INPUT', `${label} must contain 1-${max} characters`);
  return value.trim();
};

function validateSource(source) {
  if (!object(source)) throw failure('INVALID_INPUT', 'every slide requires an explicit source');
  return { label: text(source.label, 160, 'source label'), reference: text(source.reference, 500, 'source reference') };
}

function validateTable(table) {
  if (!object(table) || !Array.isArray(table.headers) || table.headers.length < 2 || table.headers.length > 5) throw failure('INVALID_INPUT', 'table requires 2-5 headers');
  const headers = table.headers.map((value) => text(value, 60, 'table header'));
  if (!Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 8) throw failure('INVALID_INPUT', 'table requires 1-8 rows');
  const rows = table.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== headers.length) throw failure('INVALID_INPUT', 'table rows must match header count');
    return row.map((value) => {
      if (typeof value !== 'string' || value.length > 80) throw failure('INVALID_INPUT', 'table cells must contain at most 80 characters');
      return value;
    });
  });
  return { headers, rows };
}

export function validatePresentation(input) {
  if (!object(input) || input.schema !== 'mochi-lesson-presentation-v1') throw failure('INVALID_INPUT', 'structured presentation schema is required');
  if (!['upstream-authorized-structured-content', 'demonstration'].includes(input.sourceKind)) throw failure('INVALID_INPUT', 'sourceKind is invalid');
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw failure('INVALID_INPUT', 'deck version must be a positive integer');
  if (!Array.isArray(input.slides) || input.slides.length < 1 || input.slides.length > MAX_SLIDES) throw failure('INVALID_INPUT', `presentation requires 1-${MAX_SLIDES} slides`);
  const ids = new Set();
  const slides = input.slides.map((slide, index) => {
    if (!object(slide)) throw failure('INVALID_INPUT', `slide ${index + 1} must be an object`);
    const id = text(slide.id, 80, 'slide id');
    if (ids.has(id)) throw failure('INVALID_INPUT', 'slide ids must be unique');
    ids.add(id);
    if (!Number.isSafeInteger(slide.version) || slide.version < 1) throw failure('INVALID_INPUT', 'slide version must be a positive integer');
    if (!['title-body', 'title-table'].includes(slide.layout)) throw failure('INVALID_INPUT', 'slide layout is unsupported');
    if (!Array.isArray(slide.body)) throw failure('INVALID_INPUT', 'slide body must be an array');
    const body = slide.body.map((value) => text(value, 140, 'body paragraph'));
    if (body.length > 6 || body.reduce((sum, value) => sum + value.length, 0) > 520) throw failure('INVALID_INPUT', 'slide body exceeds the supported projection layout');
    const table = slide.layout === 'title-table' ? validateTable(slide.table) : undefined;
    if (slide.layout === 'title-body' && body.length < 1) throw failure('INVALID_INPUT', 'title-body slides require body content');
    return { id, version: slide.version, layout: slide.layout, title: text(slide.title, 100, 'slide title'), body, ...(table ? { table } : {}), source: validateSource(slide.source) };
  });
  return { schema: input.schema, sourceKind: input.sourceKind, deckId: text(input.deckId, 100, 'deck id'), version: input.version, title: text(input.title, 160, 'deck title'), slides };
}

function semanticHash(slide) { return createHash('sha256').update(JSON.stringify(slide)).digest('hex'); }
function addSlide(pptx, item, index) {
  const slide = pptx.addSlide();
  slide.background = { color: 'F7F3E8' };
  slide.addText(item.title, { x: 0.75, y: 0.55, w: 11.8, h: 0.65, fontFace: PROJECTION_FONT, fontSize: 30, bold: true, color: '244D3D', margin: 0, breakLine: false, fit: 'shrink', lang: 'zh-CN' });
  slide.addText(item.body.map((line) => ({ text: line, options: { bullet: { indent: 18 }, breakLine: true, lang: 'zh-CN' } })), { x: 0.9, y: 1.55, w: 11.4, h: item.table ? 1.15 : 4.7, fontFace: PROJECTION_FONT, fontSize: 19, color: '26352E', breakLine: true, valign: 'top', margin: 0.08, fit: 'shrink', lang: 'zh-CN' });
  if (item.table) {
    slide.addTable([item.table.headers, ...item.table.rows], { x: 0.9, y: 2.75, w: 11.4, h: 3.4, border: { type: 'solid', color: '9BAF9F', pt: 1 }, fill: 'FFFDF7', color: '26352E', fontFace: PROJECTION_FONT, fontSize: 15, margin: 0.06, bold: false, rowH: 0.38, autoFit: false, lang: 'zh-CN' });
  }
  slide.addText(`${index + 1}  ${item.source.label}`, { x: 0.75, y: 7.08, w: 11.8, h: 0.2, fontFace: PROJECTION_FONT, fontSize: 9, color: '69786F', margin: 0, fit: 'shrink', lang: 'zh-CN' });
  slide.addNotes(`Source: ${item.source.label}\nReference: ${item.source.reference}\nSlide ID: ${item.id}\nSlide version: ${item.version}`);
}

async function createPptx(input, path) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'Mochi Presentations'; pptx.subject = input.sourceKind; pptx.title = input.title; pptx.lang = 'zh-CN';
  pptx.theme = { headFontFace: PROJECTION_FONT, bodyFontFace: PROJECTION_FONT, lang: 'zh-CN' };
  input.slides.forEach((slide, index) => addSlide(pptx, slide, index));
  await pptx.writeFile({ fileName: path, compression: true });
}

function aborted(signal) { if (signal?.aborted) throw failure('ABORTED', 'presentation generation was cancelled'); }

function slidePdfText(input) {
  const fragments = [];
  for (const slide of input.slides) {
    fragments.push(slide.title, ...slide.body, slide.source.label);
    if (slide.table) fragments.push(...slide.table.headers, ...slide.table.rows.flat());
  }
  return fragments.filter(Boolean);
}

function fittedText(lines, font, { width, maximumHeight, preferredSize, minimumSize, lineHeightFactor }) {
  for (let size = preferredSize; size >= minimumSize; size -= 1) {
    const lineHeight = size * lineHeightFactor;
    const wrapped = lines.flatMap((line) => wrapText({ text: line, font, size, maxWidth: width }));
    if (wrapped.length * lineHeight <= maximumHeight) return { size, lineHeight, wrapped };
  }
  throw failure('PDF_LAYOUT_OVERFLOW', 'structured slide text cannot fit its bounded PDF layout');
}

async function renderPresentationPdf(input, signal) {
  aborted(signal);
  const { pdfDocument, font } = await createPdfLayoutDocument({
    title: input.title,
    subject: 'Mochi structured lesson presentation',
    creator: 'Mochi Presentations',
  });
  for (const [index, item] of input.slides.entries()) {
    aborted(signal);
    const page = pdfDocument.addPage([PDF_SLIDE_WIDTH, PDF_SLIDE_HEIGHT]);
    page.drawRectangle({ x: 0, y: 0, width: PDF_SLIDE_WIDTH, height: PDF_SLIDE_HEIGHT, color: pdfColor('F7F3E8') });
    const title = fittedText([item.title], font, {
      width: 840,
      maximumHeight: 82,
      preferredSize: 27,
      minimumSize: 16,
      lineHeightFactor: 1.18,
    });
    drawTextBlock({
      page,
      text: title.wrapped.join('\n'),
      x: 54,
      top: 500,
      width: 840,
      font,
      size: title.size,
      lineHeight: title.lineHeight,
      fill: pdfColor('244D3D'),
    });
    const body = fittedText(item.body.map((line) => '• ' + line), font, {
      width: 820,
      maximumHeight: item.table ? 72 : 300,
      preferredSize: 17,
      minimumSize: 10,
      lineHeightFactor: 1.35,
    });
    drawTextBlock({
      page,
      text: body.wrapped.join('\n'),
      x: 66,
      top: 401,
      width: 820,
      font,
      size: body.size,
      lineHeight: body.lineHeight,
      fill: pdfColor('26352E'),
    });
    if (item.table) {
      let table;
      for (let size = 13; size >= 6; size -= 1) {
        const candidate = layoutTable({
          table: item.table,
          width: 820,
          font,
          size,
          lineHeight: size * 1.25,
          padding: 4,
        });
        if (candidate.header.height + candidate.rows.reduce((total, row) => total + row.height, 0) <= 242) {
          table = candidate;
          break;
        }
      }
      if (!table) throw failure('PDF_LAYOUT_OVERFLOW', 'structured slide table cannot fit its bounded PDF layout');
      drawTable({
        page,
        table,
        x: 66,
        top: 320,
        font,
        headerFill: pdfColor('E1EDE3'),
        bodyFill: pdfColor('FFFDF7'),
        headerText: pdfColor('244D3D'),
        bodyText: pdfColor('26352E'),
        border: pdfColor('9BAF9F'),
      });
    }
    drawTextBlock({
      page,
      text: String(index + 1) + '  ' + item.source.label,
      x: 54,
      top: 28,
      width: 840,
      font,
      size: 9,
      lineHeight: 11,
      fill: pdfColor('69786F'),
    });
  }
  aborted(signal);
  const bytes = await savePdfLayoutDocument(pdfDocument);
  aborted(signal);
  const inspection = await inspectPdfArtifact(bytes, {
    expectedPageCount: input.slides.length,
    requiredText: slidePdfText(input),
  });
  if (inspection.imageCount !== 0) throw failure('PDF_LAYOUT_IMAGE', 'lesson PDF must not contain page-image substitutes');
  return { bytes, inspection };
}

async function assertNewDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw failure('INVALID_OUTPUT_DIRECTORY', 'outputDirectory must be an absolute host-assigned path');
  const target = resolve(path);
  try { await mkdir(dirname(target), { recursive: true }); } catch (error) { throw failure('OUTPUT_UNAVAILABLE', `outputDirectory parent is unavailable: ${error?.code ?? 'filesystem error'}`); }
  try { await mkdir(target); } catch (error) { if (error?.code === 'EEXIST') throw failure('OUTPUT_EXISTS', 'outputDirectory already exists'); throw failure('OUTPUT_UNAVAILABLE', `outputDirectory cannot be reserved: ${error?.code ?? 'filesystem error'}`); }
  return target;
}
async function metadata(path, editable = false) { const bytes = await readFile(path); return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...(editable ? { editable: true } : {}) }; }
async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }

export async function generatePresentationBundle({ presentation, outputDirectory, signal } = {}) {
  const input = validatePresentation(presentation); aborted(signal); const target = await assertNewDirectory(outputDirectory);
  const stage = await mkdtemp(join(target, '.staging-')); let published = false;
  try {
    const pptxPath = join(stage, PPTX_NAME); await createPptx(input, pptxPath); aborted(signal);
    const generatedPdf = await renderPresentationPdf(input, signal);
    const pdfPath = join(stage, PDF_NAME); await writeFile(pdfPath, generatedPdf.bytes, { flag: 'wx', mode: 0o600 });
    const renderedPageCount = generatedPdf.inspection.pageCount;
    const slideLedger = input.slides.map((slide) => ({ id: slide.id, version: slide.version, source: slide.source, semanticHash: semanticHash(slide) }));
    await writeJson(join(stage, 'source.json'), input);
    const manifest = { schema: 'mochi-presentation-manifest-v1', status: 'completed', deckId: input.deckId, version: input.version, sourceKind: input.sourceKind, sourceSlideCount: input.slides.length, renderedPageCount, slides: slideLedger, files: { pptx: await metadata(pptxPath, true), pdf: await metadata(pdfPath) } };
    for (const filename of [PPTX_NAME, PDF_NAME, 'source.json']) await rename(join(stage, filename), join(target, filename));
    await writeJson(join(target, 'manifest.json'), manifest); await rm(stage, { recursive: true, force: true }); published = true;
    return { outputDirectory: target, pptxPath: join(target, PPTX_NAME), pdfPath: join(target, PDF_NAME), sourcePath: join(target, 'source.json'), manifestPath: join(target, 'manifest.json'), manifest };
  } catch (error) { if (error instanceof MochiPresentationsError) throw error; throw failure('GENERATION_FAILED', 'presentation bundle failed before publication'); }
  finally { if (!published) await rm(target, { recursive: true, force: true }); }
}

export async function revisePresentationBundle({ previousSourcePath, revision, outputDirectory, signal } = {}) {
  if (typeof previousSourcePath !== 'string' || !isAbsolute(previousSourcePath) || !object(revision)) throw failure('INVALID_REVISION', 'revision requires an absolute source path and structured patch');
  let prior; try { prior = validatePresentation(JSON.parse(await readFile(previousSourcePath, 'utf8'))); } catch (error) { if (error instanceof MochiPresentationsError) throw error; throw failure('INVALID_REVISION', 'previous source is unavailable or invalid'); }
  const slideIndex = prior.slides.findIndex((slide) => slide.id === revision.slideId); if (slideIndex < 0) throw failure('INVALID_REVISION', 'target slide does not exist');
  const current = prior.slides[slideIndex];
  const updated = { ...current, ...(revision.title !== undefined ? { title: revision.title } : {}), ...(revision.body !== undefined ? { body: revision.body } : {}), ...(revision.layout !== undefined ? { layout: revision.layout } : {}), ...(revision.table !== undefined ? { table: revision.table } : {}), ...(revision.source !== undefined ? { source: revision.source } : {}), version: current.version + 1 };
  const next = validatePresentation({ ...prior, version: prior.version + 1, slides: prior.slides.map((slide, index) => index === slideIndex ? updated : slide) });
  return generatePresentationBundle({ presentation: next, outputDirectory, signal });
}
