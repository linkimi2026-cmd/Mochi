// 收件箱上限回收 + 一次性授权的动作绑定（2026-09-12 修复的回归测试）。
//
// 旧行为（两个都曾有）：
//   1. 收件箱满 1000 条后**永久**返回 429，全文没有任何删除 inbox 的路径，
//      而 dispatch 侧把 429 当 NOT_SENT 反复重试 → 教室端再也收不到通知。
//   2. ensureAuthorization 只查 WeakSet 成员、**完全忽略 action 参数**，
//      为「确认已看到」铸的令牌可以拿去「拉黑设备」。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MochiLanService } from './lan-service.mjs';

const authorization = (lan, action, source = 'connection-direct') => lan.authorize(action, source);

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
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

/** 起一对已配对的教师/教室，收件箱上限由 maxMessages 注入。 */
async function bootstrap(temporary, label, maxMessages, teacherMaxMessages = 20) {
  const teacher = new MochiLanService({
    dataRoot: join(temporary, label + '-teacher'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
    testMaxMessages: teacherMaxMessages,
    identity: { role: 'teacher', endpointId: label + '-teacher', schoolId: 'limit-school', displayName: '王老师' },
  });
  const classroom = new MochiLanService({
    dataRoot: join(temporary, label + '-classroom'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
    testMaxMessages: maxMessages,
    identity: { role: 'classroom', endpointId: label + '-classroom', schoolId: 'limit-school', classId: 'g12-1', displayName: '高三一班教室' },
  });
  await teacher.start();
  await classroom.start();
  await pair(teacher, classroom);
  return { teacher, classroom };
}

async function sendRequest(classroom, targetEndpointId, messageId) {
  return classroom.sendRequest({
    targetEndpointId,
    body: '学生问题 ' + messageId,
    request: { student: '李明', kind: 'question', topic: '二次函数' },
    messageId,
    authorization: authorization(classroom, 'send-request'),
  });
}

const send = (teacher, classroom, messageId, body) => teacher.sendMessage({
  targetEndpointId: classroom.snapshot().identity.endpointId,
  body,
  messageId,
  authorization: authorization(teacher, 'send-message', 'dispatch-approved'),
});

const temporary = await mkdtemp(join(tmpdir(), 'mochi-lan-limits-'));

try {
  console.log('① 收件箱满仓时回收「已确认看到」的最旧收件，未读一条不丢');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'recycle', 3);
    try {
      for (const id of ['m1', 'm2', 'm3']) {
        assert.equal((await send(teacher, classroom, id, '通知 ' + id)).delivery, 'ACKNOWLEDGED');
      }
      assert.equal(classroom.snapshot().inbox.length, 3);
      // 前两条已被教室端人工确认看到
      for (const id of ['m1', 'm2']) {
        await classroom.markSeen({ messageId: id, authorization: authorization(classroom, 'mark-seen') });
      }
      // 第 4 条曾经会 429（永久拒收），现在应回收最旧的已读收件
      assert.equal((await send(teacher, classroom, 'm4', '通知 m4')).delivery, 'ACKNOWLEDGED');
      const afterFourth = classroom.snapshot().inbox.map((row) => row.messageId).sort();
      assert.deepEqual(afterFourth, ['m2', 'm3', 'm4'], '应淘汰最旧的已读 m1，保留未读 m3');
      // 再满一次：回收 m2（此时唯一已读），仍未读的 m3/m4/m5 都在
      assert.equal((await send(teacher, classroom, 'm5', '通知 m5')).delivery, 'ACKNOWLEDGED');
      assert.deepEqual(classroom.snapshot().inbox.map((row) => row.messageId).sort(), ['m3', 'm4', 'm5']);
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('② 全是未读时仍然明确拒绝，不静默丢弃老师的通知');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'full', 2);
    try {
      await send(teacher, classroom, 'u1', '未读 1');
      await send(teacher, classroom, 'u2', '未读 2');
      await expectCode(() => send(teacher, classroom, 'u3', '未读 3'), 'MESSAGE_LIMIT');
      assert.equal(classroom.snapshot().inbox.length, 2, '被拒绝时不得改动已有收件');
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('③ 教师已确认看到的预约仍受保护，容量拒绝后原预约仍可回复');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'seen-request', 10, 1);
    try {
      await sendRequest(classroom, teacher.snapshot().identity.endpointId, 'request-seen-1');
      assert.equal((await teacher.markSeen({ messageId: 'request-seen-1', authorization: authorization(teacher, 'mark-seen') })).status, 'ACKNOWLEDGED');
      const before = JSON.stringify(teacher.snapshot().inbox);
      await expectCode(() => sendRequest(classroom, teacher.snapshot().identity.endpointId, 'request-seen-2'), 'MESSAGE_LIMIT');
      assert.equal(JSON.stringify(teacher.snapshot().inbox), before, '拒绝新预约时不得移除已读预约');
      const response = await teacher.sendResponse({
        targetEndpointId: classroom.snapshot().identity.endpointId,
        body: '收到预约。',
        response: { replyToMessageId: 'request-seen-1', decision: 'replied' },
        messageId: 'response-seen-1',
        authorization: authorization(teacher, 'send-response'),
      });
      assert.equal(response.delivery, 'ACKNOWLEDGED', '已读预约仍应可回复');
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('④ 教师回复属于受保护收件，保留回复去重状态');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'seen-response', 1);
    try {
      await sendRequest(classroom, teacher.snapshot().identity.endpointId, 'request-for-response');
      const responseArgs = {
        targetEndpointId: classroom.snapshot().identity.endpointId,
        body: '收到预约。',
        response: { replyToMessageId: 'request-for-response', decision: 'replied' },
        messageId: 'response-protected',
        authorization: authorization(teacher, 'send-response'),
      };
      assert.equal((await teacher.sendResponse(responseArgs)).delivery, 'ACKNOWLEDGED');
      await classroom.markSeen({ messageId: 'response-protected', authorization: authorization(classroom, 'mark-seen') });
      const before = JSON.stringify(classroom.snapshot().inbox);
      await expectCode(() => send(teacher, classroom, 'notify-after-response', '容量应拒绝'), 'MESSAGE_LIMIT');
      assert.equal(JSON.stringify(classroom.snapshot().inbox), before, '拒绝新通知时不得移除回复收件');
      await expectCode(() => teacher.sendResponse({
        ...responseArgs,
        messageId: 'response-duplicate',
        authorization: authorization(teacher, 'send-response'),
      }), 'RESPONSE_ALREADY_SENT');
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('⑤ 普通通知回执状态 UNKNOWN 时不能回收，ACKNOWLEDGED 时仍可回收');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'seen-receipt-state', 1);
    try {
      await send(teacher, classroom, 'unknown-receipt', '回执结果不确定');
      await classroom.markSeen({ messageId: 'unknown-receipt', authorization: authorization(classroom, 'mark-seen') });
      // Simulate the durable state left by a failed remote receipt attempt or
      // restart recovery. seenAt alone must not imply that the receipt landed.
      classroom._state.inbox['unknown-receipt'].seenReceipt = 'UNKNOWN';
      const beforeUnknown = JSON.stringify(classroom.snapshot().inbox);
      await expectCode(() => send(teacher, classroom, 'after-unknown', '容量应拒绝'), 'MESSAGE_LIMIT');
      assert.equal(JSON.stringify(classroom.snapshot().inbox), beforeUnknown, 'UNKNOWN 回执的收件必须保留');

      classroom._state.inbox['unknown-receipt'].seenReceipt = 'ACKNOWLEDGED';
      assert.equal((await send(teacher, classroom, 'after-acknowledged', '确认回执后可回收')).delivery, 'ACKNOWLEDGED');
      assert.deepEqual(classroom.snapshot().inbox.map((row) => row.messageId), ['after-acknowledged']);
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('⑤b 历史收件超限时必须有足够安全项才可接收新消息');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'inbox-legacy-overflow', 2);
    try {
      await send(teacher, classroom, 'safe-history', '已看到的旧通知');
      await classroom.markSeen({ messageId: 'safe-history', authorization: authorization(classroom, 'mark-seen') });
      await send(teacher, classroom, 'unseen-history', '未读旧通知');
      classroom._maxMessages = 1;
      const before = JSON.stringify(classroom.snapshot().inbox);
      await expectCode(() => send(teacher, classroom, 'overflow-new', '不能超限写入'), 'MESSAGE_LIMIT');
      assert.equal(JSON.stringify(classroom.snapshot().inbox), before);
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('⑥ 一次性授权绑定动作：为「确认已看到」铸的令牌不能用于「拉黑设备」');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'scope', 3);
    try {
      const crossToken = authorization(classroom, 'mark-seen');
      await expectCode(() => classroom.blockPeer({ endpointId: 'scope-teacher', authorization: crossToken }), 'LOCAL_APPROVAL_SCOPE_MISMATCH');
      // 令牌无论匹配与否都立即作废：同一条再用一次必须回到「需要本机批准」
      await expectCode(() => classroom.blockPeer({ endpointId: 'scope-teacher', authorization: crossToken }), 'LOCAL_APPROVAL_REQUIRED');
      // 正常动作仍然可用
      await send(teacher, classroom, 'scope-1', '作用域正常');
      const seen = await classroom.markSeen({ messageId: 'scope-1', authorization: authorization(classroom, 'mark-seen') });
      assert.equal(seen.status, 'ACKNOWLEDGED');
      // 浏览器/模型递进来的普通对象不是令牌
      await expectCode(() => classroom.blockPeer({ endpointId: 'scope-teacher', authorization: { action: 'block-peer', source: 'connection-direct' } }), 'LOCAL_APPROVAL_REQUIRED');
      await expectCode(() => classroom.unblockPeer({ endpointId: 'scope-teacher', authorization: { action: 'unblock-peer', source: 'connection-direct' } }), 'LOCAL_APPROVAL_REQUIRED');
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('⑦ 对外快照里不得出现私钥（曾把含 privateKey 的身份写进 outbox 的 sender）');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'privacy', 3);
    try {
      await send(teacher, classroom, 'p1', '隐私检查');
      await classroom.markSeen({ messageId: 'p1', authorization: authorization(classroom, 'mark-seen') });
      await new Promise((resolvePause) => setTimeout(resolvePause, 50));
      for (const [label, snapshot] of [['teacher', teacher.snapshot()], ['classroom', classroom.snapshot()]]) {
        const text = JSON.stringify(snapshot);
        assert.equal(text.includes('privateKey'), false, label + ' 快照里出现了 privateKey');
        assert.equal(text.includes('PRIVATE KEY'), false, label + ' 快照里出现了 PEM 私钥');
      }
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('⑧ 发件箱只回收已确认看到的普通通知，保留预约回复与幂等重试记录');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'outbox-recycle', 10, 2);
    try {
      const target = teacher.snapshot().identity.endpointId;
      await sendRequest(classroom, target, 'request-1');
      const responseArgs = {
        targetEndpointId: classroom.snapshot().identity.endpointId,
        body: '我会在答疑时间讲二次函数。',
        response: { replyToMessageId: 'request-1', decision: 'replied' },
        messageId: 'response-1',
        authorization: authorization(teacher, 'send-response'),
      };
      assert.equal((await teacher.sendResponse(responseArgs)).delivery, 'ACKNOWLEDGED');
      assert.equal((await send(teacher, classroom, 'notice-1', '已答复的普通通知')).delivery, 'ACKNOWLEDGED');
      await classroom.markSeen({ messageId: 'notice-1', authorization: authorization(classroom, 'mark-seen') });
      const retry = await teacher.retryMessage({ messageId: 'notice-1', authorization: authorization(teacher, 'retry-message') });
      assert.equal(retry.delivery, 'ACKNOWLEDGED');
      assert.equal(retry.ack.duplicate, true);

      // Cap is full: the acknowledged, seen plain notification is the only
      // safe row to retire. The linked response remains available for retries.
      assert.equal((await send(teacher, classroom, 'notice-2', '新通知')).delivery, 'ACKNOWLEDGED');
      assert.deepEqual(teacher.snapshot().outbox.map((row) => row.messageId).sort(), ['notice-2', 'response-1']);
      const responseRetry = await teacher.retryMessage({ messageId: 'response-1', authorization: authorization(teacher, 'retry-message') });
      assert.equal(responseRetry.ack.duplicate, true);
      await expectCode(() => teacher.sendResponse({
        ...responseArgs,
        messageId: 'response-duplicate',
        authorization: authorization(teacher, 'send-response'),
      }), 'RESPONSE_ALREADY_SENT');
      await expectCode(() => teacher.retryMessage({ messageId: 'notice-1', authorization: authorization(teacher, 'retry-message') }), 'MESSAGE_NOT_FOUND');
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('⑨ 无安全回收项时发送前拒绝，历史超限按最旧安全项依序回收');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'outbox-full', 10, 1);
    try {
      await sendRequest(classroom, teacher.snapshot().identity.endpointId, 'request-full');
      const response = {
        targetEndpointId: classroom.snapshot().identity.endpointId,
        body: '收到。',
        response: { replyToMessageId: 'request-full', decision: 'replied' },
        messageId: 'response-full',
        authorization: authorization(teacher, 'send-response'),
      };
      await teacher.sendResponse(response);
      const before = JSON.stringify(teacher.snapshot().outbox);
      await expectCode(() => send(teacher, classroom, 'blocked-by-capacity', '不应发出'), 'MESSAGE_LIMIT');
      assert.equal(JSON.stringify(teacher.snapshot().outbox), before, '容量拒绝不得改变现有发件箱');

    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('⑩ 历史发件箱超限时按最旧安全项依序回收');
  {
    const { teacher, classroom } = await bootstrap(temporary, 'outbox-legacy', 10, 2);
    try {
      const legacy = ['legacy-a', 'legacy-b', 'legacy-c'].map((messageId, index) => ({
        messageId,
        targetEndpointId: classroom.snapshot().identity.endpointId,
        contentType: 'NOTIFY',
        body: messageId,
        delivery: 'ACKNOWLEDGED',
        createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      }));
      teacher._state.outbox = Object.fromEntries(legacy.map((row) => [row.messageId, row]));
      teacher._state.receipts = Object.fromEntries(legacy.map((row) => [row.messageId, { messageId: row.messageId, seenAt: row.createdAt }]));
      assert.equal((await send(teacher, classroom, 'after-legacy-overflow', '容量恢复后发送')).delivery, 'ACKNOWLEDGED');
      assert.deepEqual(teacher.snapshot().outbox.map((row) => row.messageId).sort(), ['after-legacy-overflow', 'legacy-c']);
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('LAN limit tests passed: inbox/outbox capacity preserves protected rows, authorization is action-scoped and single-use, no private key in snapshots');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
