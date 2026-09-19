import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { reviewEvidence } from './review-evidence.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'mochi-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = join(root, 'review.json');
  const review = {
    schema: 'mochi-quality-review-v1',
    caseId: 'fixture',
    executed: true,
    runId: 'test-run',
    domain: 'research',
    role: 'teacher',
    model: 'fixture',
    provider: 'offline',
    reasoningEffort: 'none',
    variant: 'candidate',
    reviewer: { id: 'test-fixture', kind: 'human', notes: 'Synthetic contract test; not a real human assessment.' },
    hardFailures: [],
    scores: { correctness: 3, completeness: 3, evidence: 3, usability: 3 },
    artifacts: [],
    checks: [
      {
        artifactId: 'output',
        location: 'answer',
        observation: 'Synthetic record for contract validation.',
        status: 'pass',
      },
    ],
    visual: null,
    visualNotApplicableReason: 'Text-only fixture',
  };
  async function add(id, kind, path = `${id}.txt`) {
    const data = Buffer.from(`Synthetic ${id}`);
    await writeFile(join(root, path), data);
    const item = { id, kind, path, sha256: createHash('sha256').update(data).digest('hex') };
    review.artifacts.push(item);
    return item;
  }
  for (const kind of ['prompt', 'input', 'tool-catalog', 'trace', 'output']) await add(kind, kind);
  async function run() {
    await writeFile(manifest, JSON.stringify(review));
    return reviewEvidence(manifest, new Set(['fixture']));
  }
  return { root, review, add, run };
}

test('valid evidence is reviewable, never automatically passed or promoted', async (t) => {
  const item = await fixture(t);
  assert.equal((await item.run()).status, 'reviewable');
});

test('done, missing scores, or an AI self-review cannot substitute for verification', async (t) => {
  const item = await fixture(t);
  item.review.executed = false;
  item.review.scores.correctness = null;
  item.review.reviewer.kind = 'model';
  const result = await item.run();
  assert.equal(result.status, 'incomplete');
  assert.ok(result.issues.some((issue) => issue.includes('human')));
  assert.ok(result.issues.some((issue) => issue.includes('correctness')));
  assert.ok(result.issues.some((issue) => issue.includes('executed')));
});

test('stale artifacts and hard failures cannot be hidden by high scores', async (t) => {
  const item = await fixture(t);
  await writeFile(join(item.root, 'output.txt'), 'changed');
  item.review.hardFailures = ['fabricated source'];
  const result = await item.run();
  assert.equal(result.status, 'incomplete');
  assert.ok(result.issues.some((issue) => issue.includes('stale')));
  assert.ok(result.issues.some((issue) => issue.includes('Hard failures')));
});

test('evidence symlinks cannot escape the review folder', async (t) => {
  const item = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'mochi-evidence-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'not for evidence');
  await symlink(join(outside, 'secret.txt'), join(item.root, 'escape.txt'));
  item.review.artifacts[0].path = 'escape.txt';
  assert.ok((await item.run()).issues.some((issue) => issue.includes('escapes')));
});

test('visual evidence requires every page and matching output version', async (t) => {
  const item = await fixture(t);
  item.review.domain = 'visual';
  assert.equal((await item.run()).status, 'incomplete');
  const image = await item.add('page-image', 'image');
  const output = item.review.artifacts.find((artifact) => artifact.id === 'output');
  image.sourceSha256 = output.sha256;
  item.review.visual = {
    required: true,
    reviewed: true,
    artifactId: 'output',
    totalPages: 2,
    pages: [{ page: 1, imageId: image.id, observation: 'Synthetic coverage fixture.' }],
  };
  assert.equal((await item.run()).status, 'incomplete');
  item.review.visual.pages.push({ page: 2, imageId: image.id, observation: 'Second page in contact sheet fixture.' });
  assert.equal((await item.run()).status, 'reviewable');
  image.sourceSha256 = '0'.repeat(64);
  assert.ok((await item.run()).issues.some((issue) => issue.includes('another output')));
});
