import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generatePresentationBundle } from '../mochi-presentations/index.mjs';
import { teacherLessonSample } from '../mochi-presentations/fixtures/teacher-lesson.mjs';
import { LAN_FILE_LIMITS, LAN_HTTP_PATHS, LAN_PROTOCOL_VERSION, LAN_STATE_FILENAME, MochiLanService } from './lan-service.mjs';

const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function identityProjection(identity) {
  return {
    endpointId: identity.endpointId,
    role: identity.role,
    schoolId: identity.schoolId,
    ...(identity.classId === undefined ? {} : { classId: identity.classId }),
    displayName: identity.displayName,
    fingerprint: identity.fingerprint,
  };
}

function signed(identity, payload) {
  return {
    payload,
    signature: sign(null, Buffer.from(canonical(payload)), createPrivateKey({ key: identity.privateKey, format: 'jwk' })).toString('base64url'),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function authorization(lan, action, source = 'connection-direct') {
  return lan.authorize(action, source);
}

async function persistedIdentity(root) {
  return JSON.parse(await readFile(join(root, LAN_STATE_FILENAME), 'utf8')).identity;
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function pair(teacher, classroom) {
  const candidate = classroom.pairingCandidate();
  const request = await teacher.requestPairing({
    candidate,
    address: { host: '127.0.0.1', port: classroom.snapshot().http.port },
    authorization: authorization(teacher, 'request-pairing'),
  });
  await classroom.acceptPairing({ requestId: request.requestId, authorization: authorization(classroom, 'accept-pairing') });
}

function offerPayload({ fileId, sender, classroomIdentity, metadata }) {
  return {
    v: LAN_PROTOCOL_VERSION,
    type: 'file-offer',
    fileId,
    createdAt: new Date().toISOString(),
    sender: identityProjection(sender),
    recipient: {
      endpointId: classroomIdentity.endpointId,
      schoolId: classroomIdentity.schoolId,
      classId: classroomIdentity.classId,
    },
    file: metadata,
  };
}

function chunkPayload({ fileId, sender, classroomIdentity, index, bytes }) {
  return {
    v: LAN_PROTOCOL_VERSION,
    type: 'file-chunk',
    fileId,
    index,
    sha256: sha256(bytes),
    data: bytes.toString('base64url'),
    sender: identityProjection(sender),
    recipient: {
      endpointId: classroomIdentity.endpointId,
      schoolId: classroomIdentity.schoolId,
      classId: classroomIdentity.classId,
    },
  };
}

function cancelPayload({ fileId, sender, classroomIdentity }) {
  return {
    v: LAN_PROTOCOL_VERSION,
    type: 'file-cancel',
    fileId,
    createdAt: new Date().toISOString(),
    sender: identityProjection(sender),
    recipient: {
      endpointId: classroomIdentity.endpointId,
      schoolId: classroomIdentity.schoolId,
      classId: classroomIdentity.classId,
    },
  };
}

async function postSigned(sender, address, pathname, payload) {
  const response = await fetch('http://' + address.host + ':' + address.port + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signed(sender, payload)),
  });
  return { status: response.status, body: await response.json() };
}

function metadataFor(filename, contentType, bytes) {
  return {
    filename,
    contentType,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    chunkBytes: LAN_FILE_LIMITS.chunkBytes,
    chunkCount: Math.ceil(bytes.length / LAN_FILE_LIMITS.chunkBytes),
  };
}

const temporary = await mkdtemp(join(tmpdir(), 'mochi-lan-files-'));
const teacherRoot = join(temporary, 'teacher');
const classroomRoot = join(temporary, 'classroom');
const teacher = new MochiLanService({
  dataRoot: teacherRoot,
  bindHost: '127.0.0.1',
  port: 0,
  discoveryEnabled: false,
  identity: { role: 'teacher', endpointId: 'teacher-files', schoolId: 'file-school', displayName: '王老师' },
});
const classroom = new MochiLanService({
  dataRoot: classroomRoot,
  bindHost: '127.0.0.1',
  port: 0,
  discoveryEnabled: false,
  testFileTransferTtlMs: 250,
  identity: { role: 'classroom', endpointId: 'classroom-files', schoolId: 'file-school', classId: 'g12-1', displayName: '高三一班教室' },
});

try {
  await teacher.start();
  await classroom.start();
  await pair(teacher, classroom);
  const classroomAddress = { host: '127.0.0.1', port: classroom.snapshot().http.port };
  const [teacherIdentity, classroomIdentity] = await Promise.all([persistedIdentity(teacherRoot), persistedIdentity(classroomRoot)]);

  console.log('① 真实 PptxGenJS 教学课件先落在教师受管目录，再以签名分块传输；收件端验证 SHA256 后才允许消息引用 fileId');
  const bundle = await generatePresentationBundle({
    presentation: teacherLessonSample(),
    outputDirectory: join(teacherRoot, 'teacher-export'),
  });
  const sourcePptx = await readFile(bundle.pptxPath);
  assert.equal(sourcePptx.subarray(0, 2).toString('utf8'), 'PK', 'fixture must be a real OOXML ZIP-based PPTX');
  const transferred = await teacher.sendFile({
    targetEndpointId: 'classroom-files',
    sourcePath: bundle.pptxPath,
    body: '请打开今天的教学课件。',
    fileId: 'teacher-lesson-pptx',
    messageId: 'teacher-lesson-notice',
    authorization: authorization(teacher, 'send-file', 'dispatch-approved'),
  });
  assert.equal(transferred.file.status, 'AVAILABLE');
  assert.equal(transferred.message.delivery, 'ACKNOWLEDGED');
  const receivedPptx = join(classroomRoot, 'mochi-lan', 'inbox', 'teacher-lesson-pptx.pptx');
  assert.equal(sha256(await readFile(receivedPptx)), sha256(sourcePptx), 'accepted PPTX must be byte-identical');
  const incomingMessage = classroom.snapshot().inbox.find((row) => row.messageId === 'teacher-lesson-notice');
  assert.equal(incomingMessage.attachment.fileId, 'teacher-lesson-pptx');
  assert.equal(classroom.snapshot().files.incoming.find((row) => row.fileId === 'teacher-lesson-pptx').status, 'COMPLETED');

  console.log('② 文件邀请断开后保留同一 fileId 的已落盘块；明确恢复时只续传缺块，不能伪造新文件');
  const partialBytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(LAN_FILE_LIMITS.chunkBytes + 137, 0x41)]);
  const partialPath = join(teacherRoot, 'teacher-export', 'partial.pdf');
  await writeFile(partialPath, partialBytes);
  const partialMetadata = metadataFor('partial.pdf', 'application/pdf', partialBytes);
  const partialOffer = await postSigned(teacherIdentity, classroomAddress, LAN_HTTP_PATHS.fileOffer, offerPayload({
    fileId: 'resume-file', sender: teacherIdentity, classroomIdentity, metadata: partialMetadata,
  }));
  assert.equal(partialOffer.status, 200);
  const firstChunk = partialBytes.subarray(0, LAN_FILE_LIMITS.chunkBytes);
  const partialChunk = await postSigned(teacherIdentity, classroomAddress, LAN_HTTP_PATHS.fileChunk, chunkPayload({
    fileId: 'resume-file', sender: teacherIdentity, classroomIdentity, index: 0, bytes: firstChunk,
  }));
  assert.equal(partialChunk.status, 200);
  assert.equal(classroom.snapshot().files.incoming.find((row) => row.fileId === 'resume-file').receivedBytes, firstChunk.length);
  const resumed = await teacher.sendFile({
    targetEndpointId: 'classroom-files',
    sourcePath: partialPath,
    body: '这是续传后的 PDF。',
    fileId: 'resume-file',
    messageId: 'resume-file-notice',
    // 这里走的是 sendFile（服务内部对已 offer 的 fileId 自动续传），所以令牌动作是 send-file。
    authorization: authorization(teacher, 'send-file', 'dispatch-approved'),
  });
  assert.equal(resumed.file.status, 'AVAILABLE');
  assert.equal(sha256(await readFile(join(classroomRoot, 'mochi-lan', 'inbox', 'resume-file.pdf'))), sha256(partialBytes));

  console.log('③ 取消和断连 TTL 都只清理受管 .incoming 临时块，已完成文件不被删除');
  const cancelledBytes = Buffer.from('%PDF-1.7\ncancel');
  const cancelledOffer = await postSigned(teacherIdentity, classroomAddress, LAN_HTTP_PATHS.fileOffer, offerPayload({
    fileId: 'cancel-file', sender: teacherIdentity, classroomIdentity, metadata: metadataFor('cancel.pdf', 'application/pdf', cancelledBytes),
  }));
  assert.equal(cancelledOffer.status, 200);
  const cancelledTemporary = join(classroomRoot, 'mochi-lan', 'inbox', '.incoming', 'cancel-file');
  assert.equal(await exists(cancelledTemporary), true);
  const cancelled = await postSigned(teacherIdentity, classroomAddress, LAN_HTTP_PATHS.fileCancel, cancelPayload({
    fileId: 'cancel-file', sender: teacherIdentity, classroomIdentity,
  }));
  assert.equal(cancelled.status, 200);
  assert.equal(await exists(cancelledTemporary), false);
  const disconnectedOffer = await postSigned(teacherIdentity, classroomAddress, LAN_HTTP_PATHS.fileOffer, offerPayload({
    fileId: 'disconnect-file', sender: teacherIdentity, classroomIdentity, metadata: metadataFor('disconnect.pdf', 'application/pdf', cancelledBytes),
  }));
  assert.equal(disconnectedOffer.status, 200);
  const disconnectedTemporary = join(classroomRoot, 'mochi-lan', 'inbox', '.incoming', 'disconnect-file');
  assert.equal(await exists(disconnectedTemporary), true);
  await pause(600);
  assert.equal(classroom.snapshot().files.incoming.some((row) => row.fileId === 'disconnect-file'), false);
  assert.equal(await exists(disconnectedTemporary), false);
  assert.equal(await exists(receivedPptx), true, 'TTL only removes incomplete chunks');

  console.log('④ 来源路径、类型和未验证的 fileId 都在传输服务层拒绝；不是靠 UI 隐藏');
  const outside = join(temporary, 'outside.pdf');
  await writeFile(outside, Buffer.from('%PDF-1.7\noutside'));
  await expectCode(
    () => teacher.sendFile({
      targetEndpointId: 'classroom-files', sourcePath: outside, body: '不应发送', fileId: 'outside-file',
      authorization: authorization(teacher, 'send-file', 'dispatch-approved'),
    }),
    'FILE_SOURCE_FORBIDDEN',
  );
  const forbidden = join(teacherRoot, 'teacher-export', 'not-allowed.txt');
  await writeFile(forbidden, 'not an allowed office file');
  await expectCode(
    () => teacher.sendFile({
      targetEndpointId: 'classroom-files', sourcePath: forbidden, body: '不应发送', fileId: 'forbidden-file',
      authorization: authorization(teacher, 'send-file', 'dispatch-approved'),
    }),
    'FILE_TYPE_FORBIDDEN',
  );
  await expectCode(
    () => teacher.sendMessage({
      targetEndpointId: 'classroom-files', body: '不能引用未知文件', messageId: 'unknown-reference',
      attachment: { fileId: 'unknown-file' }, authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
    }),
    'FILE_REFERENCE_UNVERIFIED',
  );

  console.log('⑤ 默认 100MiB 单文件和 300MiB 受管收件配额由接收端邀请阶段实际断言');
  const quotaTeacherRoot = join(temporary, 'quota-teacher');
  const quotaClassroomRoot = join(temporary, 'quota-classroom');
  const quotaTeacher = new MochiLanService({
    dataRoot: quotaTeacherRoot, bindHost: '127.0.0.1', port: 0, discoveryEnabled: false,
    identity: { role: 'teacher', endpointId: 'quota-teacher', schoolId: 'file-school', displayName: '配额教师' },
  });
  const quotaClassroom = new MochiLanService({
    dataRoot: quotaClassroomRoot, bindHost: '127.0.0.1', port: 0, discoveryEnabled: false,
    identity: { role: 'classroom', endpointId: 'quota-classroom', schoolId: 'file-school', classId: 'g12-2', displayName: '配额教室' },
  });
  try {
    await quotaTeacher.start();
    await quotaClassroom.start();
    await pair(quotaTeacher, quotaClassroom);
    const quotaTeacherIdentity = await persistedIdentity(quotaTeacherRoot);
    const quotaClassroomIdentity = await persistedIdentity(quotaClassroomRoot);
    const quotaAddress = { host: '127.0.0.1', port: quotaClassroom.snapshot().http.port };
    const maximum = LAN_FILE_LIMITS.maxFileBytes;
    for (let index = 0; index < 3; index += 1) {
      const response = await postSigned(quotaTeacherIdentity, quotaAddress, LAN_HTTP_PATHS.fileOffer, offerPayload({
        fileId: 'quota-' + index, sender: quotaTeacherIdentity, classroomIdentity: quotaClassroomIdentity,
        metadata: {
          filename: 'quota-' + index + '.pdf', contentType: 'application/pdf', byteLength: maximum,
          sha256: createHash('sha256').update('quota-' + index).digest('hex'),
          chunkBytes: LAN_FILE_LIMITS.chunkBytes, chunkCount: Math.ceil(maximum / LAN_FILE_LIMITS.chunkBytes),
        },
      }));
      assert.equal(response.status, 200);
    }
    const quotaExceeded = await postSigned(quotaTeacherIdentity, quotaAddress, LAN_HTTP_PATHS.fileOffer, offerPayload({
      fileId: 'quota-overflow', sender: quotaTeacherIdentity, classroomIdentity: quotaClassroomIdentity,
      metadata: {
        filename: 'quota-overflow.pdf', contentType: 'application/pdf', byteLength: 1,
        sha256: createHash('sha256').update('overflow').digest('hex'),
        chunkBytes: LAN_FILE_LIMITS.chunkBytes, chunkCount: 1,
      },
    }));
    assert.equal(quotaExceeded.status, 413);
    assert.equal(quotaExceeded.body.code, 'INBOX_QUOTA_EXCEEDED');
    const tooLarge = await postSigned(quotaTeacherIdentity, quotaAddress, LAN_HTTP_PATHS.fileOffer, offerPayload({
      fileId: 'too-large', sender: quotaTeacherIdentity, classroomIdentity: quotaClassroomIdentity,
      metadata: {
        filename: 'too-large.pdf', contentType: 'application/pdf', byteLength: maximum + 1,
        sha256: createHash('sha256').update('too-large').digest('hex'),
        chunkBytes: LAN_FILE_LIMITS.chunkBytes, chunkCount: Math.ceil((maximum + 1) / LAN_FILE_LIMITS.chunkBytes),
      },
    }));
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.body.code, 'FILE_TOO_LARGE');
  } finally {
    await Promise.allSettled([quotaTeacher.stop(), quotaClassroom.stop()]);
  }

  console.log('⑥ 中途源文件变化和远端 fileId 冲突都可能已建立文件协议状态，服务保留 UNKNOWN 而不把错误码误称为未发送');
  const changingPath = join(teacherRoot, 'teacher-export', 'changed-during-transfer.pdf');
  const changingBytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(LAN_FILE_LIMITS.chunkBytes * 3, 0x42)]);
  await writeFile(changingPath, changingBytes);
  const originalFetch = globalThis.fetch;
  let changedAfterFirstChunk = false;
  globalThis.fetch = async (...requestArgs) => {
    const response = await originalFetch(...requestArgs);
    if (!changedAfterFirstChunk && String(requestArgs[0]).includes(LAN_HTTP_PATHS.fileChunk)) {
      changedAfterFirstChunk = true;
      await writeFile(changingPath, Buffer.from('%PDF-1.7\nchanged after first durable chunk'));
    }
    return response;
  };
  try {
    await assert.rejects(
      () => teacher.sendFile({
        targetEndpointId: 'classroom-files', sourcePath: changingPath, body: '中途变化文件。', fileId: 'changed-during-transfer',
        authorization: authorization(teacher, 'send-file', 'dispatch-approved'),
      }),
      (error) => error?.code === 'FILE_SOURCE_CHANGED' && error?.lanDeliveryPhase === undefined,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(changedAfterFirstChunk, true, 'fixture must change the source after a chunk response');
  assert.equal(teacher.snapshot().files.outgoing.find((row) => row.fileId === 'changed-during-transfer').status, 'UNKNOWN');
  assert.ok(classroom.snapshot().files.incoming.find((row) => row.fileId === 'changed-during-transfer').receivedBytes > 0, 'the classroom already durably received a chunk');

  const remoteBytes = Buffer.from('%PDF-1.7\nexisting remote file');
  const conflictOffer = await postSigned(teacherIdentity, classroomAddress, LAN_HTTP_PATHS.fileOffer, offerPayload({
    fileId: 'remote-file-id-conflict', sender: teacherIdentity, classroomIdentity,
    metadata: metadataFor('remote-existing.pdf', 'application/pdf', remoteBytes),
  }));
  assert.equal(conflictOffer.status, 200);
  const conflictPath = join(teacherRoot, 'teacher-export', 'remote-conflict.pdf');
  await writeFile(conflictPath, Buffer.from('%PDF-1.7\nnew local file with a different manifest'));
  await assert.rejects(
    () => teacher.sendFile({
      targetEndpointId: 'classroom-files', sourcePath: conflictPath, body: '远端冲突。', fileId: 'remote-file-id-conflict',
      authorization: authorization(teacher, 'send-file', 'dispatch-approved'),
    }),
    (error) => error?.code === 'FILE_ID_CONFLICT' && error?.lanDeliveryPhase === undefined,
  );
  assert.equal(teacher.snapshot().files.outgoing.find((row) => row.fileId === 'remote-file-id-conflict').status, 'UNKNOWN');

  console.log('⑦ 解除后以相同 endpointId 重配新指纹时，恢复、审批绑定与旧文件附件都拒绝指向新设备');
  const rebindPath = join(teacherRoot, 'teacher-export', 'resume-after-repair.pdf');
  await writeFile(rebindPath, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4_096, 0x52)]));
  const originalPeer = teacher.snapshot().peers.find((row) => row.endpointId === 'classroom-files');
  await assert.rejects(
    () => teacher.sendFile({
      targetEndpointId: 'classroom-files', sourcePath: rebindPath, body: '等待恢复的文件。', fileId: 'resume-after-repair',
      authorization: authorization(teacher, 'send-file', 'dispatch-approved'), signal: AbortSignal.abort(),
    }),
    (error) => error?.code === 'DELIVERY_UNKNOWN',
  );
  assert.equal(teacher.snapshot().files.outgoing.find((row) => row.fileId === 'resume-after-repair').status, 'UNKNOWN');
  await teacher.unpairPeer({ endpointId: 'classroom-files', authorization: authorization(teacher, 'unpair-peer') });
  const replacementRoot = join(temporary, 'replacement-classroom');
  const replacement = new MochiLanService({
    dataRoot: replacementRoot,
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
    identity: { role: 'classroom', endpointId: 'classroom-files', schoolId: 'file-school', classId: 'g12-1', displayName: '重配后的高三一班教室' },
  });
  try {
    await replacement.start();
    await pair(teacher, replacement);
    const replacementInboxBefore = replacement.snapshot().inbox.length;
    await assert.rejects(
      () => teacher.resumeFile({ fileId: 'resume-after-repair', authorization: authorization(teacher, 'resume-file') }),
      (error) => error?.code === 'PAIRING_CHANGED' && error?.lanDeliveryPhase === 'pre-send',
    );
    assert.equal(replacement.snapshot().files.incoming.some((row) => row.fileId === 'resume-after-repair'), false);
    await assert.rejects(
      () => teacher.sendMessage({
        targetEndpointId: 'classroom-files', body: '旧审批绑定不能给新设备。', messageId: 'approval-binding-stale',
        expectedSender: teacher.snapshot().identity, expectedPeer: originalPeer,
        authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
      }),
      (error) => error?.code === 'LAN_APPROVAL_STALE' && error?.lanDeliveryPhase === 'pre-send',
    );
    await assert.rejects(
      () => teacher.sendMessage({
        targetEndpointId: 'classroom-files', body: '旧课件引用不能给新设备。', messageId: 'old-file-reference',
        attachment: { fileId: 'teacher-lesson-pptx' }, authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
      }),
      (error) => error?.code === 'PAIRING_CHANGED' && error?.lanDeliveryPhase === 'pre-send',
    );
    assert.equal(replacement.snapshot().inbox.length, replacementInboxBefore);
  } finally {
    await replacement.stop();
  }

  console.log('LAN file tests passed: real PPTX hash, signed resumable chunks, controlled inbox, cancel/TTL cleanup, source/type/reference and quota boundaries, phase-safe outcomes, and pairing-bound recovery');
} finally {
  await Promise.allSettled([teacher.stop(), classroom.stop()]);
  await rm(temporary, { recursive: true, force: true });
}
