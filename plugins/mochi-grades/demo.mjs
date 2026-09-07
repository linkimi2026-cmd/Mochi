/** Explicit non-user fixture for the grade-generator test suite. */
export function demonstrationGradeInput(reportScope = 'teacher-internal') {
  return {
    sourceKind: 'demonstration',
    sourceLabel: '演示成绩材料 非真实学生数据 仅用于本机模块验证',
    reportScope,
    ...(reportScope === 'external-anonymized' ? { externalReportLabel: '演示考试匿名汇总' } : {}),
    assessment: {
      name: '演示语文单元测验',
      subject: '语文',
      maxScore: 100,
      passScore: 60,
      excellentScore: 85,
    },
    rows: [
      { sourceRow: 'A2', studentId: '0001', studentName: '王芳', status: 'present', score: 0, sourceRecord: { 学号: '0001', 姓名: '王芳', 分数: 0, 状态: 'present' } },
      { sourceRow: 'A3', studentId: '0012', studentName: '王芳', status: 'present', score: 72, sourceRecord: { 学号: '0012', 姓名: '王芳', 分数: 72, 状态: 'present' } },
      { sourceRow: 'A4', studentId: '0099', studentName: '赵宁', status: 'present', score: 88, sourceRecord: { 学号: '0099', 姓名: '赵宁', 分数: 88, 状态: 'present' } },
      { sourceRow: 'A5', studentId: '0100', studentName: '李青', status: 'present', score: 100, sourceRecord: { 学号: '0100', 姓名: '李青', 分数: 100, 状态: 'present' } },
      { sourceRow: 'A6', studentId: '0101', studentName: '陈晨', status: 'absent', score: null, sourceRecord: { 学号: '0101', 姓名: '陈晨', 分数: null, 状态: 'absent' } },
      { sourceRow: 'A7', studentId: '0102', studentName: '吴欣', status: 'exempt', score: null, sourceRecord: { 学号: '0102', 姓名: '吴欣', 分数: null, 状态: 'exempt' } },
      { sourceRow: 'A8', studentId: '0103', studentName: '周宇', status: 'blank', score: null, sourceRecord: { 学号: '0103', 姓名: '周宇', 分数: null, 状态: 'blank' } },
      { sourceRow: 'A9', studentId: '0200', studentName: '孙悦', status: 'present', score: 90, sourceRecord: { 学号: '0200', 姓名: '孙悦', 分数: 90, 状态: 'present' } },
      { sourceRow: 'A10', studentId: '0200', studentName: '孙悦', status: 'present', score: 91, sourceRecord: { 学号: '0200', 姓名: '孙悦', 分数: 91, 状态: 'present' } },
    ],
  };
}
