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
async function bootstrap(temporary, label, maxMessages) {
  const teacher = new MochiLanService({
    dataRoot: join(temporary, label + '-teacher'),
    bindHost: '127.0.0.1',
    port: 0,
    discoveryEnabled: false,
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

  console.log('③ 一次性授权绑定动作：为「确认已看到」铸的令牌不能用于「拉黑设备」');
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
    } finally {
      await classroom.stop();
      await teacher.stop();
    }
  }

  console.log('④ 对外快照里不得出现私钥（曾把含 privateKey 的身份写进 outbox 的 sender）');
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

  console.log('LAN limit tests passed: inbox recycling keeps unread messages, authorization is action-scoped and single-use, no private key in snapshots');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
