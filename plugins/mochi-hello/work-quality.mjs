import { readFileSync } from 'node:fs';

export const WORK_QUALITY_SECTION = 'mochi:work-quality';
export const WORK_QUALITY_POLICY = readFileSync(new URL('./work-quality.md', import.meta.url), 'utf8').trim();

export function installWorkQuality(ctx) {
  return ctx.systemPrompt.section({
    name: WORK_QUALITY_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA') + 1,
    text: WORK_QUALITY_POLICY,
  });
}
