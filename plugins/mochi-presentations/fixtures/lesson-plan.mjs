export function demonstrationLessonPlan() {
  return {
    schema: 'mochi-lesson-presentation-v1',
    sourceKind: 'demonstration',
    deckId: 'demo-water-cycle',
    version: 1,
    title: '水循环演示教案',
    slides: [
      {
        id: 'opening', version: 1, layout: 'title-body', title: '水循环',
        body: ['演示目标：识别蒸发、凝结与降水的关系', '本页内容仅用于模块验证。'],
        source: { label: '演示教案第 1 页', reference: 'fixture:lesson-plan:1' },
      },
      {
        id: 'process', version: 1, layout: 'title-table', title: '三个过程', body: ['观察水在不同条件下的变化。'],
        table: { headers: ['过程', '条件', '现象'], rows: [['蒸发', '受热', '液态水变成水蒸气'], ['凝结', '降温', '水蒸气形成小水滴']] },
        source: { label: '演示教案第 2 页', reference: 'fixture:lesson-plan:2' },
      },
      {
        id: 'review', version: 1, layout: 'title-body', title: '课堂回顾',
        body: ['用自己的话解释云的形成。', '举出生活中的一个蒸发现象。'],
        source: { label: '演示教案第 3 页', reference: 'fixture:lesson-plan:3' },
      },
    ],
  };
}
