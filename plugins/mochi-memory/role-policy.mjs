const TOPICS = Object.freeze({
  teacher: Object.freeze(['file_format', 'layout_style', 'communication_style', 'class_portrait']),
  classroom: Object.freeze(['class_portrait']),
  unknown: Object.freeze([]),
});

const POLICIES = Object.freeze({
  teacher: '本机是教师个人工作伙伴。可从多次真实用户选择观察文件格式、排版风格与沟通风格；一次任务请求先是观察，不直接成为永久默认。班级共同风格、约定或课堂互动只在原句明确哪一个班级时观察，不将不同班级混合，不把单个学生偏好推成全班画像。用户明确要求记录仍可用现有记忆工具，文档和其他工具功能不因此受限。当前明确称呼以用户资料为准。',
  classroom: '本机是教室中的班级共同伙伴。主动观察仅限班级共同风格、共同约定与课堂互动，必须有真实班级原句依据；单个学生偏好、一次文档请求或老师的个人选择不能归为全班习惯。不默认从Word等文档请求学习班级文件格式、排版或个人沟通画像。用户明确要求记录仍可用现有记忆工具；不禁止文档功能，不为班级补编个人画像。当前班级称呼以用户资料为准。',
  unknown: '本机角色尚未明确，暂停主动偏好与班级画像观察，不从文档请求推断默认文件格式、排版或沟通习惯。用户明确要求记录仍可用现有记忆工具，正常文档和其他功能保持可用；不能通过称呼、对话内容或工具请求推断教师或教室角色。',
});

export function normalizeMemoryRole(value) {
  if (typeof value !== 'string') return 'unknown';
  const role = value.trim().toLowerCase();
  return role === 'teacher' || role === 'classroom' ? role : 'unknown';
}

export function allowedObservationTopics(role) {
  return TOPICS[normalizeMemoryRole(role)];
}

export function memoryRolePolicy(role) {
  return POLICIES[normalizeMemoryRole(role)];
}

// This gate selects topics only. Existing observation code still verifies real quotes and collective evidence.
export function shouldObserveTopic(role, topic) {
  return typeof topic === 'string' && allowedObservationTopics(role).includes(topic);
}
