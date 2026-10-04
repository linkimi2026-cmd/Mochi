import assert from 'node:assert/strict';
import test from 'node:test';
import { memberAssignment, teamPalette } from '../src/team-palette.mjs';

test('first four teammates have distinct colors and appended members retain existing colors', () => {
  const members = Array.from({ length: 4 }, (_, i) => ({ id: `member-${i}`, name: `成员${i}`, role: i ? 'teammate' : 'lead' }));
  for (const lead of ['caramel', 'cream', 'sage', 'peach']) {
    const colors = members.map(member => teamPalette(members, member.id, lead));
    assert.equal(colors[0], lead);
    assert.equal(new Set(colors).size, 4);
    const expanded = [...members, { id: 'fifth' }];
    assert.deepEqual(members.map(member => teamPalette(expanded, member.id, lead)), colors);
    assert.equal(teamPalette(expanded, 'fifth', lead), lead);
  }
});

test('assignment comes from the actual task owner and status', () => {
  const member = { name: '检查员', role: 'teammate' };
  const tasks = [
    { ownerName: '另一个成员', subject: '不属于我', status: 'in_progress' },
    { ownerName: '检查员', subject: '已结束', status: 'completed' },
    { ownerName: '检查员', subject: '核对题目', status: 'in_progress' },
  ];
  assert.equal(memberAssignment(member, tasks), '核对题目');
  assert.equal(memberAssignment(member, []), '等待分工');
  assert.equal(memberAssignment({ role: 'lead' }, []), '统筹协作');
});
