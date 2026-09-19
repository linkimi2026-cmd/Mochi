import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIMENSIONS = ['correctness', 'completeness', 'evidence', 'usability'];
const HASH = /^[a-f0-9]{64}$/u;
const MAX_BYTES = 256 * 1024 * 1024;

// Checks evidence integrity, not whether a human's judgment is true.
export async function reviewEvidence(manifestPath, knownCaseIds) {
  const file = await realpath(manifestPath);
  const root = dirname(file);
  const manifestInfo = await stat(file);
  if (!manifestInfo.isFile() || manifestInfo.size > 1024 * 1024)
    throw new Error('Review manifest must be a file of at most 1 MB');
  const raw = await readFile(file, 'utf8');
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Review manifest exceeds 1 MB');
  const review = JSON.parse(raw);
  const issues = [];
  const require = (condition, message) => {
    if (!condition) issues.push(message);
  };
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  require(review.schema === 'mochi-quality-review-v1', 'Unsupported review schema');
  require(knownCaseIds.has(review.caseId), 'Unknown caseId');
  require(review.executed === true, 'Task has not been executed');
  for (const name of ['runId', 'domain', 'role', 'model', 'provider', 'reasoningEffort']) {
    require(nonempty(review[name]), `Missing ${name}`);
  }
  require(['baseline', 'candidate'].includes(review.variant), 'Missing baseline/candidate variant');
  require(nonempty(review.reviewer?.id) && review.reviewer?.kind === 'human', 'Independent human review is missing');
  require(nonempty(review.reviewer?.notes), 'Reviewer must explain the evidence and limitations');
  require(Array.isArray(review.hardFailures), 'hardFailures must be explicitly recorded');
  require(review.hardFailures?.length === 0, 'Hard failures block acceptance');
  for (const dimension of DIMENSIONS) {
    const score = review.scores?.[dimension];
    require(Number.isInteger(score) && score >= 0 && score <= 4, `Missing or invalid score: ${dimension}`);
    if (Number.isInteger(score)) require(score >= 3, `Below acceptance threshold: ${dimension}`);
  }
  const artifacts = new Map();
  for (const artifact of Array.isArray(review.artifacts) ? review.artifacts : []) {
    if (!nonempty(artifact.id) || artifacts.has(artifact.id)) {
      issues.push('Artifact IDs must be nonempty and unique');
      continue;
    }
    artifacts.set(artifact.id, { ...artifact, valid: false });
    if (!nonempty(artifact.path) || isAbsolute(artifact.path) || !HASH.test(artifact.sha256 ?? '')) {
      issues.push(`Invalid path/hash for artifact ${artifact.id}`);
      continue;
    }
    try {
      const target = await realpath(resolve(root, artifact.path));
      const local = relative(root, target);
      if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
        throw new Error('path escapes review directory');
      const info = await stat(target);
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('not a bounded file');
      const bytes = await readFile(target);
      if (bytes.length > MAX_BYTES) throw new Error('file exceeds size limit');
      if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256)
        throw new Error('hash mismatch: evidence is stale');
      artifacts.get(artifact.id).valid = true;
    } catch (error) {
      issues.push(`Artifact ${artifact.id}: ${error.code ?? error.message}`);
    }
  }
  for (const kind of ['prompt', 'input', 'tool-catalog', 'trace', 'output']) {
    require([...artifacts.values()].some(
      (artifact) => artifact.kind === kind && artifact.valid,
    ), `Missing verified ${kind} artifact`);
  }
  const checks = Array.isArray(review.checks) ? review.checks : [];
  require(checks.length > 0, 'No concrete checks recorded');
  for (const check of checks) {
    require(nonempty(check.observation) && nonempty(check.location), 'Each check needs an observation and location');
    require(check.status === 'pass', 'Unverified or failed check');
    require(artifacts.get(check.artifactId)?.valid === true, 'Check refers to missing/stale artifact');
  }
  const visualOutput = [...artifacts.values()].some(
    (artifact) => artifact.kind === 'output' && /\.(pptx|png|jpe?g|webp)$/iu.test(artifact.path ?? ''),
  );
  require(!(visualOutput || review.domain === 'visual') ||
    review.visual !== null, 'Visual outputs cannot skip visual review');
  if (review.visual !== null) {
    const visual = review.visual;
    require(visual?.required === true && visual?.reviewed === true, 'Visual review is missing');
    const output = artifacts.get(visual?.artifactId);
    require(output?.kind === 'output' && output?.valid, 'Visual review must bind to a verified output');
    const pages = visual?.pages;
    const total = visual?.totalPages;
    require(Number.isSafeInteger(total) && total > 0 && total <= 1000, 'Invalid visual page count');
    require(Array.isArray(pages) &&
      pages.length === total &&
      new Set(pages.map((page) => page.page)).size === total, 'Visual coverage is incomplete or duplicated');
    for (const page of Array.isArray(pages) ? pages : []) {
      require(Number.isInteger(page.page) && page.page >= 1 && page.page <= total, 'Invalid visual page number');
      require(nonempty(page.observation), 'Visual page observation is missing');
      require(artifacts.get(page.imageId)?.sourceSha256 === output?.sha256 &&
        HASH.test(output?.sha256 ?? ''), 'Page image belongs to another output version');
      require(artifacts.get(page.imageId)?.kind === 'image' &&
        artifacts.get(page.imageId)?.valid, 'Missing verified page image');
    }
  } else {
    require(nonempty(
      review.visualNotApplicableReason,
    ), 'Nonvisual tasks must explain why visual review is not applicable');
  }
  return {
    caseId: review.caseId ?? null,
    runId: review.runId ?? null,
    status: issues.length ? 'incomplete' : 'reviewable',
    issues,
    notice:
      'Checks integrity and recorded coverage only; does not independently prove content accuracy, visual quality, reviewer identity, or improvement. Never auto-promotes production rules.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node evals/work-quality/review-evidence.mjs /absolute/path/review.json');
    const cases = await Promise.all(
      ['./cases.json', '../ppt-quality/cases.json'].map(async (path) =>
        JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8')),
      ),
    );
    const result = await reviewEvidence(process.argv[2], new Set(cases.flat().map((item) => item.description)));
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'reviewable') process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
