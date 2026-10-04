// 七年级科学教学样例；课堂活动数据为示例，不含学生个人信息。
export function teacherLessonSample() {
  return {
    schema: 'mochi-lesson-presentation-v1',
    sourceKind: 'demonstration',
    deckId: 'teacher-water-cycle-and-conservation',
    version: 1,
    title: '七年级科学：水循环与节水行动',
    theme: 'field',
    teachingPlan: {
      objectives: [
        { id: 'water-cycle', statement: '用可观察证据解释蒸发、凝结与降水的一条常见路径' },
        { id: 'water-saving', statement: '提出适合校园场景的节水行动并说明理由' },
      ],
      slideMappings: [
        { slideId: 'observe', objectiveIds: ['water-cycle'], role: '观察引入', studentAction: '两人对照简化路径圈出受热和降温变化', understandingCheck: '能指出水变成水蒸气和小水滴的位置' },
        { slideId: 'cycle', objectiveIds: ['water-cycle'], role: '建立过程模型', studentAction: '沿路径口头解释三个过程的先后关系', understandingCheck: '能说明图中只是水循环的一条常见路径' },
        { slideId: 'process-table', objectiveIds: ['water-cycle'], role: '证据核对', studentAction: '为一个过程匹配条件与可观察证据', understandingCheck: '能用观察现象支持所选过程' },
        { slideId: 'action-chart', objectiveIds: ['water-saving'], role: '行动讨论', studentAction: '选择一项今天能开始的节水行动并说明理由', understandingCheck: '能区分示例投票与本班真实数据' },
        { slideId: 'design', objectiveIds: ['water-saving'], role: '小组应用', studentAction: '写出包含人物、时机和动作的校园节水提示', understandingCheck: '能解释提示如何减少所选场景的浪费' },
        { slideId: 'exit-ticket', objectiveIds: ['water-cycle', 'water-saving'], role: '离堂检核', studentAction: '独立完成一句过程解释和一项行动承诺', understandingCheck: '两句话分别对应课堂中的过程证据和可执行行动' },
      ],
    },
    slides: [
      {
        id: 'opening', version: 1, layout: 'cover', title: '水从哪里来，又到哪里去？',
        body: ['七年级科学 · 水循环与节水行动', '观察变化，用证据解释。'],
        source: { label: '教学样例第 1 页', reference: 'teacher-sample:water-cycle:1' },
      },
      {
        id: 'observe', version: 1, layout: 'title-compare', title: '观察任务：沿下一页的简化路径找线索',
        body: ['两人一组，对照下一页的简化路径，圈出受热与降温变化。'],
        comparison: {
          leftTitle: '观察线索',
          rightTitle: '记录方式',
          rows: [
            { left: '地表水受热', right: '圈出液态水变成水蒸气的位置' },
            { left: '水蒸气遇冷', right: '圈出形成小水滴的位置' },
          ],
        },
        source: { label: '教学样例第 2 页', reference: 'teacher-sample:water-cycle:2' },
      },
      {
        id: 'cycle', version: 1, layout: 'title-process', title: '水循环：一条常见路径',
        body: ['简化路径：实际的水可能走不同路线。'],
        process: {
          steps: [
            { label: '蒸发', detail: '地表水受热成为水蒸气' },
            { label: '凝结', detail: '水蒸气遇冷形成小水滴' },
            { label: '降水', detail: '云中水滴增大后落回地面' },
          ],
          loopLabel: '降到地面的水可以再次蒸发',
        },
        source: { label: '教学样例第 3 页', reference: 'teacher-sample:water-cycle:3' },
      },
      {
        id: 'process-table', version: 1, layout: 'title-table', title: '三个过程与可观察证据',
        body: ['先描述现象，再说明发生变化的条件。'],
        table: {
          headers: ['过程', '条件', '可观察证据'],
          rows: [
            ['蒸发', '受热', '水面逐渐减少'],
            ['凝结', '降温', '杯壁出现小水滴'],
            ['降水', '云中水滴增大', '雨滴从云中落下'],
          ],
        },
        source: { label: '教学样例第 4 页', reference: 'teacher-sample:water-cycle:4' },
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
        source: { label: '教学样例第 5 页', reference: 'teacher-sample:water-cycle:5' },
      },
      {
        id: 'design', version: 1, layout: 'title-compare', title: '小组任务：设计一条节水提示',
        body: [],
        comparison: {
          leftTitle: '行动设计',
          rightTitle: '完成标准',
          rows: [
            { left: '选择一个校园用水场景', right: '说清楚场景和用水行为' },
            { left: '写出“谁在什么时候做什么”', right: '行动句包含人物、时机和动作' },
            { left: '说明这条提示怎样减少浪费', right: '理由对应所选场景的用水行为' },
          ],
        },
        source: { label: '教学样例第 6 页', reference: 'teacher-sample:water-cycle:6' },
      },
      {
        id: 'exit-ticket', version: 1, layout: 'closing', title: '用一句话带走今天的发现',
        body: ['我能解释的一个过程是：____。', '我今天准备开始的节水行动是：____。'],
        source: { label: '教学样例第 7 页', reference: 'teacher-sample:water-cycle:7' },
      },
    ],
  };
}
