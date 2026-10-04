import z from '@deepseek-ai/schemastery';
import { STEP_IDS } from './steps.mjs';
const editable = schema => typeof schema.volatile === 'function' ? schema.volatile() : schema.extra('volatile', true);
export const name = 'mochi-onboarding';
export const Config = z.object({
  version: editable(z.number().default(0)),
  status: editable(z.union(['new', 'skipped', 'complete']).default('new')),
  step: editable(z.union(STEP_IDS).default('identity')),
});
// The official configuration forms own persistence, validation and write ordering.
export function apply() {}
