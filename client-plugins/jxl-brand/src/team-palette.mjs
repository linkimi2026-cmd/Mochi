import palettes from '../../jxl-theme/assets/mochi-palettes.json' with { type: 'json' };

/** The upstream durable roster is append-only; reconnects and status changes keep each seat. */
export function teamPalette(members, memberId, leadPalette = 'caramel') {
  const colors = palettes.map(palette => palette.id);
  const lead = colors.includes(leadPalette) ? leadPalette : colors[0];
  const order = [lead, ...colors.filter(color => color !== lead)];
  const seat = members.findIndex(member => member.id === memberId);
  return order[Math.max(0, seat) % order.length];
}

export function memberAssignment(member, tasks) {
  const assigned = tasks.find(task => task.ownerName === member.name && task.status === 'in_progress')
    ?? tasks.find(task => task.ownerName === member.name && task.status === 'pending');
  return assigned?.subject ?? (member.role === 'lead' ? '统筹协作' : '等待分工');
}
