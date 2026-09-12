import { isAbsolute, resolve } from 'node:path';

import { generatePresentationBundle } from '../index.mjs';
import { teacherLessonSample } from './teacher-lesson.mjs';

const outputDirectory = String(process.argv[2] || '').trim();
if (!outputDirectory || !isAbsolute(outputDirectory)) {
  throw new Error('usage: node fixtures/generate-teacher-sample.mjs /absolute/new-output-directory');
}

const bundle = await generatePresentationBundle({
  presentation: teacherLessonSample(),
  outputDirectory: resolve(outputDirectory),
});
process.stdout.write(`${JSON.stringify({ pptx: bundle.pptxPath, pdf: bundle.pdfPath, sourcePath: bundle.sourcePath, manifest: bundle.manifestPath }, null, 2)}\n`);
