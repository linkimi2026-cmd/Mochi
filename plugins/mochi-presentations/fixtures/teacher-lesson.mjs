// 教师可直接改写的七年级科学教学样例；课堂活动数据明确标为示例，不含学生个人信息。
export function teacherLessonSample() {
  return {
    schema: 'mochi-lesson-presentation-v1',
    sourceKind: 'demonstration',
    deckId: 'teacher-water-cycle-and-conservation',
    version: 1,
    title: '七年级科学：水循环与节水行动',
    slides: [
      {
        id: 'opening', version: 1, layout: 'title-body', title: '水从哪里来，又到哪里去？',
        body: ['说出蒸发、凝结和降水三个过程。', '用生活观察解释“云为什么会出现”。', '把科学理解转化为一项可执行的节水行动。'],
        source: { label: '教学样例第 1 页', reference: 'teacher-sample:water-cycle:1' },
      },
      {
        id: 'observe', version: 1, layout: 'title-body', title: '观察任务：追踪一滴水',
        body: ['两人一组，在图中用箭头标出水的移动路径。', '圈出一个受热变化和一个降温变化。', '准备在 60 秒内用一句话解释你的路径。'],
        source: { label: '教学样例第 2 页', reference: 'teacher-sample:water-cycle:2' },
      },
      {
        id: 'process-table', version: 1, layout: 'title-table', title: '三个过程与可观察证据',
        body: ['先描述现象，再说明发生变化的条件。'],
        table: {
          headers: ['过程', '条件', '可观察证据'],
          rows: [
            ['蒸发', '受热', '水面逐渐减少'],
            ['凝结', '降温', '杯壁出现小水滴'],
            ['降水', '水滴聚集', '水滴落向地面'],
          ],
        },
        source: { label: '教学样例第 3 页', reference: 'teacher-sample:water-cycle:3' },
      },
      {
        id: 'action-chart', version: 1, layout: 'title-chart', title: '课堂活动：哪项节水行动最容易开始？',
        body: ['以下是课堂讨论用示例数据，不代表本班真实调查结果。', '先选一项今天就能完成的行动，再说明理由。'],
        chart: {
          type: 'bar',
          title: '小组投票示例（票）',
          labels: ['及时关水', '一水多用', '修理滴漏', '减少长流水'],
          series: [{ name: '示例票数', values: [18, 13, 9, 7] }],
        },
        source: { label: '教学样例第 4 页', reference: 'teacher-sample:water-cycle:4' },
      },
      {
        id: 'design', version: 1, layout: 'title-body', title: '小组任务：设计一条节水提示',
        body: ['选择一个校园用水场景。', '写出“谁在什么时候做什么”的行动句。', '用水循环中的一个过程解释为什么有帮助。'],
        source: { label: '教学样例第 5 页', reference: 'teacher-sample:water-cycle:5' },
      },
      {
        id: 'exit-ticket', version: 1, layout: 'title-body', title: '离场卡：用一句话带走今天的发现',
        body: ['我能解释的水循环过程是：____。', '我今天准备开始的节水行动是：____。', '我还想继续观察的问题是：____。'],
        source: { label: '教学样例第 6 页', reference: 'teacher-sample:water-cycle:6' },
      },
    ],
  };
}
