import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMemoryRole,allowedObservationTopics,memoryRolePolicy,shouldObserveTopic} from './role-policy.mjs';

test('locked roles normalize without inferring a role from names or payloads', () => {
  assert.equal(normalizeMemoryRole(' Teacher '), 'teacher');
  assert.equal(normalizeMemoryRole('CLASSROOM'), 'classroom');
  for (const role of [undefined, null, {}, ['teacher'], '王老师', 'student', 'standard', '']) {
    assert.equal(normalizeMemoryRole(role), 'unknown');
    assert.deepEqual(allowedObservationTopics(role), []);
    assert.equal(shouldObserveTopic(role, 'file_format'), false);
    assert.equal(shouldObserveTopic(role, 'class_portrait'), false);
  }
});

test('a classroom document request cannot become an automatic class format preference', () => {
  for (const topic of ['file_format', 'layout_style', 'communication_style']) {
    assert.equal(shouldObserveTopic('teacher', topic), true);
    assert.equal(shouldObserveTopic('classroom', topic), false);
  }
  assert.equal(shouldObserveTopic('classroom', 'class_portrait'), true);
  assert.equal(shouldObserveTopic('teacher', 'class_portrait'), true);
  assert.equal(shouldObserveTopic('classroom', 'individual_student'), false);
  assert.equal(shouldObserveTopic('teacher', 'future_unknown_topic'), false);
  assert.equal(shouldObserveTopic('teacher', {}), false);
  assert.throws(() => allowedObservationTopics('classroom').push('file_format'), TypeError);
  assert.equal(shouldObserveTopic('classroom', 'file_format'), false);
});

test('policy preserves explicit memory and document capabilities while requiring collective evidence', () => {
  const teacher=memoryRolePolicy('teacher'),room=memoryRolePolicy('classroom'),unknown=memoryRolePolicy(null);
  assert.match(teacher, /明确哪一个班级/);
  assert.match(teacher, /不将不同班级混合/);
  assert.match(room, /单个学生偏好/);
  assert.match(room, /一次文档请求/);
  assert.match(room, /真实班级原句/);
  for (const policy of [teacher, room, unknown]) {
    assert.match(policy, /用户明确要求记录仍可用现有记忆工具/);
    assert.match(policy, /文档/);
  }
  assert.match(unknown, /暂停主动/);
  assert.match(unknown, /不能.*推断教师或教室角色/);
});
