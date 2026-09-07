#!/usr/bin/env node
/**
 * Verify the two bounded Phase 0 session-recovery candidates without touching
 * the original DSH home or either source candidate.  The only writable area is
 * artifacts/migration-audit/session-recovery/runs/<new-run-id>/.
 *
 * This deliberately uses the installed Harness persistence service rather than
 * decoding, re-sequencing, or rewriting JSONL/Zstandard frames itself.
 */
import { constants as fsConstants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKSPACE_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const ARTIFACTS_ROOT = resolve(WORKSPACE_ROOT, 'artifacts/migration-audit/session-recovery');
const RUNS_ROOT = join(ARTIFACTS_ROOT, 'runs');
const DESKTOP_NODE_MODULES = join(WORKSPACE_ROOT, 'apps/desktop/node_modules');
const DEFAULT_FORENSICS_ROOT = '/Users/a1379/.mochi-runtime-config-backups/20260905102550-session-forensics';
const TARGET_SESSION_ID = 'session-dee14347-cf33-487b-8e2e-7b90963f639e';
const CANDIDATES = [
  { key: 'A', directory: 'recovery-dsh-home-a' },
  { key: 'B', directory: 'recovery-dsh-home-b' },
];

function usage() {
  return [
    'Usage: node tools/verify-session-recovery-candidates.mjs [--forensics-root <path>] [--run-id <safe-id>]',
    '',
    'Reads only the two named recovery candidates under the forensic backup.',
    'Creates a fresh, non-overwriting isolated Harness home beneath artifacts/.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { forensicsRoot: DEFAULT_FORENSICS_ROOT, runId: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === '--forensics-root' || arg === '--run-id') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
      options[arg === '--forensics-root' ? 'forensicsRoot' : 'runId'] = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${arg}`);
  }
  return options;
}

function generatedRunId() {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  return `${timestamp}-${process.pid}-${randomBytes(5).toString('hex')}`;
}

function assertSafeRunId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value)) {
    throw new Error('run id must use only letters, digits, dot, underscore, or hyphen');
  }
  return value;
}

function assertContained(base, target) {
  const pathFromBase = relative(base, target);
  if (!pathFromBase || pathFromBase.startsWith('..') || isAbsolute(pathFromBase)) {
    throw new Error('resolved path escapes the session-recovery artifact root');
  }
}

async function sha256(path) {
  const digest = createHash('sha256');
  await new Promise((resolveStream, rejectStream) => {
    const input = createReadStream(path);
    input.on('data', (chunk) => digest.update(chunk));
    input.once('error', rejectStream);
    input.once('end', resolveStream);
  });
  return digest.digest('hex');
}

async function regularFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('expected a regular, non-symlink artifact file');
  return info;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertManifest(manifest, key) {
  if (manifest?.schema !== 'mochi-session-recovery-v1') throw new Error(`candidate ${key} has an unexpected manifest schema`);
  if (typeof manifest.label !== 'string' || manifest.label.length === 0) throw new Error(`candidate ${key} lacks a label`);
  if (manifest?.source?.sessionId !== TARGET_SESSION_ID) throw new Error(`candidate ${key} has an unexpected session id`);
  if (typeof manifest?.source?.backupJournalSha256 !== 'string') throw new Error(`candidate ${key} lacks the original-journal hash`);
  if (typeof manifest?.candidateArtifactSha256 !== 'string') throw new Error(`candidate ${key} lacks the candidate hash`);
  if (!Number.isSafeInteger(manifest?.candidateArtifactBytes) || manifest.candidateArtifactBytes < 1) {
    throw new Error(`candidate ${key} lacks a valid candidate byte count`);
  }
}

function safeSelection(selection) {
  const out = {};
  if (typeof selection?.artifact === 'string') out.artifact = selection.artifact;
  for (const name of ['compressedByteRange', 'completeFrameIndexes', 'sourceEventRows', 'resultingSeqRange']) {
    if (Array.isArray(selection?.[name])) out[name] = structuredClone(selection[name]);
  }
  return out;
}

async function locateSingleCandidateArtifact(sourceHome) {
  const sessionsRoot = join(sourceHome, 'sessions');
  const projectEntries = await readdir(sessionsRoot, { withFileTypes: true });
  const matches = [];
  for (const entry of projectEntries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidatePath = join(sessionsRoot, entry.name, TARGET_SESSION_ID, 'session.jsonl.zstd');
    try {
      await regularFile(candidatePath);
      matches.push(candidatePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  if (matches.length !== 1) throw new Error('expected exactly one named candidate artifact in its isolated source home');
  return matches[0];
}

function classifyError(error) {
  const text = String(error instanceof Error ? error.message : error).toLowerCase();
  if (/(seq gap|seq mismatch|sequence)/.test(text)) return 'sequence-mismatch';
  if (/(corrupt|validation|unsupported|format)/.test(text)) return 'session-format';
  if (/(not found|enoent)/.test(text)) return 'not-found';
  if (/(permission|eacces|eperm)/.test(text)) return 'permission';
  return 'unexpected';
}

async function loadOfficialRuntime() {
  const [cordis, session, persistence] = await Promise.all([
    import(pathToFileURL(join(DESKTOP_NODE_MODULES, '@deepseek-ai/cordis/lib/index.js')).href),
    import(pathToFileURL(join(DESKTOP_NODE_MODULES, '@deepseek-ai/dsh-session/lib/index.js')).href),
    import(pathToFileURL(join(DESKTOP_NODE_MODULES, '@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js')).href),
  ]);
  return {
    Context: cordis.Context,
    SessionStore: session.SessionStore,
    JsonlSessionPersistence: persistence.JsonlSessionPersistence,
  };
}

async function makeOfficialContext(runtime, sessionsRoot) {
  const ctx = new runtime.Context();
  const sessionFiber = ctx.plugin(runtime.SessionStore);
  await sessionFiber;
  const persistenceFiber = ctx.plugin(runtime.JsonlSessionPersistence, {
    root: sessionsRoot,
    compression: 'zstd',
  });
  await persistenceFiber;
  return { ctx, sessionFiber, persistenceFiber };
}

async function disposeOfficialContext(context) {
  await context.persistenceFiber.dispose();
  await context.sessionFiber.dispose();
}

function onlyTargetId(headers) {
  const ids = headers.map((header) => header.id).sort();
  if (ids.length !== 1 || ids[0] !== TARGET_SESSION_ID) throw new Error('persistence list did not expose exactly the expected candidate session');
  return ids;
}

async function verifyCandidate({ runtime, sourceHome, runDir, candidate, originalBackupHash }) {
  const manifestPath = join(sourceHome, 'RECOVERY_MANIFEST.json');
  const manifest = await readJson(manifestPath);
  assertManifest(manifest, candidate.key);
  if (manifest.source.backupJournalSha256 !== originalBackupHash) {
    throw new Error(`candidate ${candidate.key} does not bind to the expected original journal`);
  }

  const sourceArtifact = await locateSingleCandidateArtifact(sourceHome);
  const sourceStats = await regularFile(sourceArtifact);
  const sourceArtifactHashBefore = await sha256(sourceArtifact);
  if (sourceArtifactHashBefore !== manifest.candidateArtifactSha256 || sourceStats.size !== manifest.candidateArtifactBytes) {
    throw new Error(`candidate ${candidate.key} does not match its preserved artifact hash or byte count`);
  }

  const targetHome = resolve(runDir, `isolated-harness-home-${candidate.key.toLowerCase()}`);
  assertContained(runDir, targetHome);
  const relativeArtifact = relative(sourceHome, sourceArtifact);
  if (relativeArtifact.split(/[\\/]/)[0] !== 'sessions') {
    throw new Error(`candidate ${candidate.key} artifact is outside its source sessions directory`);
  }
  const targetArtifact = resolve(targetHome, relativeArtifact);
  assertContained(targetHome, targetArtifact);
  await mkdir(dirname(targetArtifact), { recursive: true });
  await copyFile(sourceArtifact, targetArtifact, fsConstants.COPYFILE_EXCL);

  const targetArtifactHashBeforeOpen = await sha256(targetArtifact);
  if (targetArtifactHashBeforeOpen !== sourceArtifactHashBefore) throw new Error(`candidate ${candidate.key} copy hash mismatch`);

  const context = await makeOfficialContext(runtime, join(targetHome, 'sessions'));
  let verification;
  try {
    const listedBeforeOpen = onlyTargetId(await context.ctx.sessionPersistence.list());
    const inspectedBeforeOpen = await context.ctx.sessionPersistence.inspect(TARGET_SESSION_ID);
    const preparation = await context.ctx.sessionPersistence.prepare(TARGET_SESSION_ID);
    let liveStoreIds = [];
    let preparedSessionSeq;
    try {
      if (preparation.session.id !== TARGET_SESSION_ID) throw new Error('prepared Session id differs from stored candidate id');
      preparedSessionSeq = Number(preparation.session.seq);
      const detach = context.ctx.sessions.enter(preparation.session);
      try {
        context.ctx.sessions.announce(preparation.session);
        const live = context.ctx.sessions.get(TARGET_SESSION_ID);
        if (live !== preparation.session) throw new Error('prepared Session was not discoverable through the official live SessionStore');
        liveStoreIds = context.ctx.sessions.list().map((session) => session.id).sort();
        if (liveStoreIds.length !== 1 || liveStoreIds[0] !== TARGET_SESSION_ID) {
          throw new Error('official live SessionStore did not list exactly the candidate session');
        }
      } finally {
        detach();
      }
    } finally {
      preparation[Symbol.dispose]();
    }

    // inspect() waits for retirement and does not commit recovery itself.  This
    // makes the post-open hash a stable view after the temporary live session
    // has been detached.
    const inspectedAfterOpen = await context.ctx.sessionPersistence.inspect(TARGET_SESSION_ID);
    const listedAfterOpen = onlyTargetId(await context.ctx.sessionPersistence.list());
    const reopenedPreparation = await context.ctx.sessionPersistence.prepare(TARGET_SESSION_ID);
    let reopenedSessionSeq;
    try {
      if (reopenedPreparation.session.id !== TARGET_SESSION_ID) throw new Error('reopened Session id differs from stored candidate id');
      reopenedSessionSeq = Number(reopenedPreparation.session.seq);
    } finally {
      reopenedPreparation[Symbol.dispose]();
    }
    verification = {
      listedBeforeOpen,
      listedAfterOpen,
      initialEventCount: inspectedBeforeOpen.events.length,
      postOpenEventCount: inspectedAfterOpen.events.length,
      preparedSessionSeq,
      reopenedSessionSeq,
      liveStoreIds,
      noSequenceMismatch: true,
      openedThroughOfficialSessionStore: true,
      reopenedThroughOfficialPersistence: true,
    };
  } finally {
    await disposeOfficialContext(context);
  }

  const targetArtifactHashAfterOpen = await sha256(targetArtifact);
  const sourceArtifactHashAfter = await sha256(sourceArtifact);
  if (sourceArtifactHashAfter !== sourceArtifactHashBefore) throw new Error(`candidate ${candidate.key} source artifact changed during verification`);

  return {
    key: candidate.key,
    label: manifest.label,
    source: {
      kind: manifest.source.kind,
      sessionId: manifest.source.sessionId,
      formatVersion: manifest.source.formatVersion,
      backupJournalSha256: manifest.source.backupJournalSha256,
      selection: safeSelection(manifest.selection),
    },
    declaredCandidateArtifact: {
      bytes: manifest.candidateArtifactBytes,
      sha256: manifest.candidateArtifactSha256,
    },
    sourceArtifactSha256Before: sourceArtifactHashBefore,
    sourceArtifactSha256After: sourceArtifactHashAfter,
    sourceArtifactUnchanged: true,
    targetArtifactSha256BeforeOfficialOpen: targetArtifactHashBeforeOpen,
    targetArtifactSha256AfterOfficialOpen: targetArtifactHashAfterOpen,
    targetArtifactChangedByOfficialOpen: targetArtifactHashBeforeOpen !== targetArtifactHashAfterOpen,
    targetHome: relative(WORKSPACE_ROOT, targetHome),
    status: 'passed',
    ...verification,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const forensicsRoot = await realpath(resolve(options.forensicsRoot));
  const runId = assertSafeRunId(options.runId ?? generatedRunId());
  await mkdir(RUNS_ROOT, { recursive: true });
  const runDir = resolve(RUNS_ROOT, runId);
  assertContained(RUNS_ROOT, runDir);
  await mkdir(runDir, { recursive: false });

  const originalArtifact = join(forensicsRoot, 'session.jsonl.zstd');
  await regularFile(originalArtifact);
  const originalBackupHashBefore = await sha256(originalArtifact);
  const report = {
    schema: 'mochi-session-recovery-verification-v1',
    generatedAt: new Date().toISOString(),
    runId,
    node: process.version,
    method: {
      persistence: '@deepseek-ai/dsh-session-persistence-jsonl',
      operations: ['list', 'inspect', 'prepare', 'SessionStore.enter', 'SessionStore.announce'],
      sourceReadScope: 'only the named forensic journal and two named isolated candidate homes',
      targetWriteScope: 'only this new artifacts/migration-audit/session-recovery run directory',
      originalHomeWritten: false,
      modelOrNetworkCalled: false,
    },
    originalBackupJournalSha256Before: originalBackupHashBefore,
    candidates: [],
  };

  let exitFailure = false;
  try {
    const runtime = await loadOfficialRuntime();
    for (const candidate of CANDIDATES) {
      try {
        const sourceHome = join(forensicsRoot, candidate.directory);
        report.candidates.push(await verifyCandidate({ runtime, sourceHome, runDir, candidate, originalBackupHash: originalBackupHashBefore }));
      } catch (error) {
        exitFailure = true;
        report.candidates.push({ key: candidate.key, status: 'failed', errorCategory: classifyError(error) });
      }
    }
  } catch (error) {
    exitFailure = true;
    report.setupErrorCategory = classifyError(error);
  }

  const originalBackupHashAfter = await sha256(originalArtifact);
  report.originalBackupJournalSha256After = originalBackupHashAfter;
  report.originalBackupJournalUnchanged = originalBackupHashBefore === originalBackupHashAfter;
  if (!report.originalBackupJournalUnchanged) exitFailure = true;
  report.status = !exitFailure && report.candidates.length === CANDIDATES.length && report.candidates.every((candidate) => candidate.status === 'passed')
    ? 'passed'
    : 'failed';

  const reportPath = join(runDir, 'verification.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  process.stdout.write(`session-recovery verification ${report.status}; metadata: ${relative(WORKSPACE_ROOT, reportPath)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  // Do not print exception details: a malformed event payload could carry user
  // conversation data.  The exit status is sufficient for caller diagnostics.
  process.stderr.write(`session-recovery verification failed (${classifyError(error)})\n`);
  process.exitCode = 1;
});
