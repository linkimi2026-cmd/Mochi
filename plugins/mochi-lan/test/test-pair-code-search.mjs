import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { MochiLanService } from '../lan-service.mjs';

async function withServices(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'mochi-lan-pair-code-search-'));
  const services = [];
  const create = async (name, role, classId) => {
    const service = new MochiLanService({
      dataRoot: join(temporary, name),
      bindHost: '127.0.0.1',
      port: 0,
      discoveryEnabled: false,
      identity: {
        role,
        endpointId: name,
        schoolId: 'search-school',
        ...(classId ? { classId } : {}),
        displayName: name,
      },
    });
    services.push(service);
    await service.start();
    return service;
  };

  try {
    await run({ create });
  } finally {
    await Promise.allSettled(services.map((service) => service.stop()));
    await rm(temporary, { recursive: true, force: true });
  }
}

function enableTestDiscovery(service) {
  service.discoveryEnabled = true;
  service._discovery = { enabled: true, status: 'ACTIVE', errorCode: null };
}

function announce(teacher, classroom) {
  const state = classroom.snapshot();
  const peer = state.identity;
  teacher._discovered.set(peer.endpointId, {
    ...peer,
    address: { host: '127.0.0.1', port: state.http.port },
    seenAt: new Date().toISOString(),
    expiresAt: Date.now() + 60_000,
  });
  teacher.emit('event', { type: 'discovery' });
}

function setCode(classroom, code) {
  classroom._pairingCode = code;
  classroom._pairingCodeExpiresAt = Date.now() + 60_000;
}

test('single search stays bounded, uses eight probes, and rotates candidates', async () => {
  await withServices(async ({ create }) => {
    const lan = await create('teacher', 'teacher');
    lan._pairingCodeSearchDeadlineMs = 45;
    const candidates = Array.from({ length: 16 }, (_, index) => ({
      endpointId: `class-${index}`,
      role: 'classroom',
      schoolId: 'search-school',
      classId: `grade-${index}`,
      displayName: `教室 ${index}`,
      fingerprint: `fingerprint-${index}`,
      address: { host: '127.0.0.1', port: 10_000 + index },
      seenAt: new Date(Date.UTC(2026, 0, 16 - index)).toISOString(),
      expiresAt: Date.now() + 60_000,
    }));
    lan._discovered = new Map(candidates.map((candidate) => [candidate.endpointId, candidate]));

    const attempted = [];
    lan.probeCandidate = ({ address, signal }) => {
      attempted.push(address.port - 10_000);
      return new Promise((resolveProbe, rejectProbe) => {
        const abort = () => rejectProbe(new Error('probe aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    };

    const startedAt = Date.now();
    assert.deepEqual(await lan.findByPairingCode('123456'), []);
    assert.ok(Date.now() - startedAt < 500, 'search should honor its 45ms deadline');
    assert.deepEqual(attempted, Array.from({ length: 8 }, (_, index) => index), 'first search should dispatch one bounded concurrency window');

    attempted.length = 0;
    assert.deepEqual(await lan.findByPairingCode('123456'), []);
    assert.ok(attempted.length > 0);
    assert.equal(attempted[0], 8, 'next one-shot search should rotate to candidates skipped by the first deadline');
  });
});

test('wait starts with no candidates and returns a matching classroom discovered later', async () => {
  await withServices(async ({ create }) => {
    const teacher = await create('teacher', 'teacher');
    const classroom = await create('classroom', 'classroom', 'grade-7');
    enableTestDiscovery(teacher);
    setCode(classroom, '123456');

    const waiting = teacher.waitForPairingCode('123456', { waitMs: 250 });
    setTimeout(() => announce(teacher, classroom), 15);
    const result = await waiting;

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].endpointId, 'classroom');
    assert.equal(result.matches[0].fingerprint, classroom.snapshot().identity.fingerprint);
    assert.equal(result.diagnostics.discoveredCount, 1);
  });
});

test('wrong code is remembered for its short lifetime while new candidate matching continues', async () => {
  await withServices(async ({ create }) => {
    const teacher = await create('teacher', 'teacher');
    const wrong = await create('wrong-code', 'classroom', 'grade-6');
    const match = await create('matching-code', 'classroom', 'grade-7');
    enableTestDiscovery(teacher);
    setCode(wrong, '654321');
    setCode(match, '123456');
    announce(teacher, wrong);

    const waiting = teacher.waitForPairingCode('123456', { waitMs: 250 });
    setTimeout(() => announce(teacher, match), 20);
    const result = await waiting;

    assert.deepEqual(result.matches.map((row) => row.endpointId), ['matching-code']);
    assert.equal(result.diagnostics.codeRejectedCount, 1);
    assert.equal(wrong._pairingCodeFailures.get('search:127.0.0.1')?.length, 1);
    assert.equal(teacher._pairingCodeSearchRejected.size, 1, 'only a verified explicit code rejection is cached');
    const expiresAt = [...teacher._pairingCodeSearchRejected.values()][0];
    assert.ok(expiresAt - Date.now() <= 120_000 && expiresAt - Date.now() > 100_000, 'negative cache must not outlive the two-minute pairing-code lifetime');

    const retry = await teacher.findByPairingCode('123456');
    assert.equal(retry.length, 1);
    assert.equal(wrong._pairingCodeFailures.get('search:127.0.0.1')?.length, 1, 'same wrong code should not consume another server failure');
  });
});

test('concurrent searches for one wrong code share a single probe and release the lock afterward', async () => {
  await withServices(async ({ create }) => {
    const teacher = await create('teacher', 'teacher');
    const classroom = await create('wrong-code', 'classroom', 'grade-7');
    enableTestDiscovery(teacher);
    setCode(classroom, '654321');
    announce(teacher, classroom);

    const originalFetch = globalThis.fetch;
    let resolveProbeStarted;
    let releaseProbe;
    let probeCount = 0;
    const probeStarted = new Promise((resolve) => { resolveProbeStarted = resolve; });
    const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/v1/pair/code/probe')) {
        probeCount += 1;
        resolveProbeStarted();
        await probeGate;
      }
      return originalFetch(input, init);
    };
    try {
      const first = teacher.waitForPairingCode('123456', { waitMs: 0 });
      await probeStarted;
      await assert.rejects(
        teacher.waitForPairingCode('123456', { waitMs: 0 }),
        (error) => error.code === 'PAIRING_CODE_SEARCH_IN_PROGRESS',
      );
      releaseProbe();
      const result = await first;
      assert.equal(result.matches.length, 0);
      assert.equal(probeCount, 1, 'duplicate search must not consume another server-side failure');
      assert.equal(classroom._pairingCodeFailures.get('search:127.0.0.1')?.length, 1);
      assert.equal(teacher._pairingCodeSearchInFlight.size, 0);
    } finally {
      releaseProbe();
      globalThis.fetch = originalFetch;
    }
  });
});

test('an unsigned HTTP wrong-code message cannot poison the negative cache', async () => {
  await withServices(async ({ create }) => {
    const teacher = await create('teacher', 'teacher');
    const classroom = await create('classroom', 'classroom', 'grade-7');
    enableTestDiscovery(teacher);
    setCode(classroom, '123456');
    announce(teacher, classroom);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/v1/pair/code/probe')) {
        return { ok: false, status: 403, json: async () => ({ code: 'PAIRING_CODE_INVALID' }) };
      }
      return originalFetch(input, init);
    };
    try {
      const result = await teacher.waitForPairingCode('123456', { waitMs: 0 });
      assert.equal(result.matches.length, 0);
      assert.equal(result.diagnostics.invalidCandidateCount, 1);
      assert.equal(result.diagnostics.codeRejectedCount, 0);
      assert.equal(teacher._pairingCodeSearchRejected.size, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('a slow second classroom with the same code remains unresolved after the first match', async () => {
  await withServices(async ({ create }) => {
    const teacher = await create('teacher', 'teacher');
    const fast = await create('fast-match', 'classroom', 'grade-7');
    const slow = await create('slow-match', 'classroom', 'grade-8');
    enableTestDiscovery(teacher);
    setCode(fast, '123456');
    setCode(slow, '123456');
    announce(teacher, fast);
    announce(teacher, slow);
    teacher._pairingCodeSearchDeadlineMs = 30;

    const slowAddress = slow.snapshot().http.port;
    const originalProbe = teacher.probeCandidate.bind(teacher);
    let slowProbeCount = 0;
    teacher.probeCandidate = (input) => {
      if (input.address.port !== slowAddress) return originalProbe(input);
      slowProbeCount += 1;
      return new Promise((resolveProbe, rejectProbe) => {
        const abort = () => rejectProbe(Object.assign(new Error('slow candidate probe timed out'), { code: 'PROBE_CANCELLED' }));
        if (input.signal.aborted) abort();
        else input.signal.addEventListener('abort', abort, { once: true });
      });
    };

    const startedAt = Date.now();
    const result = await teacher.waitForPairingCode('123456', { waitMs: 130 });
    assert.ok(Date.now() - startedAt >= 100, 'search must continue after its first quick match until the bounded total window ends');
    assert.deepEqual(result.matches.map((row) => row.endpointId), ['fast-match']);
    assert.equal(result.diagnostics.unverifiedCandidateCount, 1, 'the slow same-code classroom must keep the result non-unique');
    assert.equal(result.diagnostics.unreachableCount, 1);
    assert.equal(slowProbeCount, 1);
    assert.equal(slow._pairingCodeFailures.get('search:127.0.0.1')?.length ?? 0, 0, 'the slow candidate was never sent the code');
  });
});

test('an unreachable discovery candidate is diagnosed, then a later reachable candidate can match', async () => {
  await withServices(async ({ create }) => {
    const teacher = await create('teacher', 'teacher');
    const classroom = await create('classroom', 'classroom', 'grade-7');
    enableTestDiscovery(teacher);
    setCode(classroom, '123456');
    teacher._discovered.set('offline', {
      endpointId: 'offline', role: 'classroom', schoolId: 'search-school', classId: 'grade-6',
      displayName: '离线教室', fingerprint: 'sha256:offline',
      address: { host: '127.0.0.1', port: 1 }, seenAt: new Date().toISOString(), expiresAt: Date.now() + 60_000,
    });

    const waiting = teacher.waitForPairingCode('123456', { waitMs: 250 });
    setTimeout(() => announce(teacher, classroom), 20);
    const result = await waiting;

    assert.deepEqual(result.matches.map((row) => row.endpointId), ['classroom']);
    assert.equal(result.diagnostics.unreachableCount, 1);
    assert.equal(teacher._pairingCodeSearchRejected.size, 0, 'reachability failures must not enter wrong-code cache');
  });
});

test('waiting without candidates can be cancelled promptly and removes its event listener', async () => {
  await withServices(async ({ create }) => {
    const teacher = await create('teacher', 'teacher');
    enableTestDiscovery(teacher);
    const controller = new AbortController();
    const baselineListeners = teacher.listenerCount('event');
    const waiting = teacher.waitForPairingCode('123456', { signal: controller.signal, waitMs: 1_000 });
    setTimeout(() => controller.abort(), 10);

    await assert.rejects(waiting, (error) => error.code === 'PROBE_CANCELLED');
    assert.equal(teacher.listenerCount('event'), baselineListeners);
    assert.equal(teacher._pairingCodeSearchInFlight.size, 0);
    assert.deepEqual((await teacher.waitForPairingCode('123456', { waitMs: 0 })).matches, []);
  });
});

console.log('LAN pairing-code bounded search, candidate rotation, discovery wait, cancellation and diagnostics passed');
