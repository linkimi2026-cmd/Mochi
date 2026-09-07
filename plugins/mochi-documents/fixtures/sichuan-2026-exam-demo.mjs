/** Explicit non-user fixture for the Sichuan 2026 target exam-base template. */
export function sichuan2026ExamDemonstration() {
  return {
    sourceKind: 'demonstration',
    template: 'sichuan-2026-high-school-exam-base',
    sourceLabel: '演示材料 非官方样卷；四川 2026 官方扫描样卷待核对',
    title: '四川 2026 高中试卷基础模板符号演示',
    exam: {
      subject: '理科与英语结构化演示（非官方样卷）',
      sourcePageCount: 1,
      sections: [
        {
          title: '第一部分 数学符号',
          questions: [
            {
              number: '1',
              score: 5,
              prompt: [
                { kind: 'text', text: '化简下式，并说明中间步骤。请在答题区完整写出定义域、化简过程和最终结论，过程中的符号须保持清晰：' },
                {
                  kind: 'math',
                  expression: [
                    {
                      kind: 'fraction',
                      numerator: [{ kind: 'text', text: '1+x' }],
                      denominator: [{ kind: 'text', text: '2' }],
                    },
                    { kind: 'text', text: ' + ' },
                    { kind: 'root', radicand: [{ kind: 'text', text: 'x+1' }] },
                    { kind: 'text', text: ' + ' },
                    { kind: 'sup', base: [{ kind: 'text', text: 'x' }], script: [{ kind: 'text', text: '2' }] },
                    { kind: 'text', text: ' + ' },
                    { kind: 'sub', base: [{ kind: 'text', text: 'a' }], script: [{ kind: 'text', text: 'i' }] },
                  ],
                },
              ],
              answerArea: { lines: 3, label: '答题区（数学演示）' },
            },
          ],
        },
        {
          title: '第二部分 化学与物理符号',
          questions: [
            {
              number: '2',
              score: 5,
              prompt: [
                { kind: 'text', text: '写出下列物质和反应式中的下标、价态与箭头：' },
                {
                  kind: 'chemistry',
                  tokens: [
                    { kind: 'text', text: 'H' },
                    { kind: 'sub', text: '2' },
                    { kind: 'text', text: 'SO' },
                    { kind: 'sub', text: '4' },
                    { kind: 'text', text: '；SO' },
                    { kind: 'sub', text: '4' },
                    { kind: 'sup', text: '2−' },
                    { kind: 'text', text: '；2H' },
                    { kind: 'sub', text: '2' },
                    { kind: 'text', text: ' + O' },
                    { kind: 'sub', text: '2' },
                    { kind: 'arrow', direction: 'forward' },
                    { kind: 'text', text: '2H' },
                    { kind: 'sub', text: '2' },
                    { kind: 'text', text: 'O' },
                  ],
                },
              ],
              answerArea: { lines: 3, label: '答题区（化学演示）' },
            },
            {
              number: '3',
              score: 5,
              prompt: [
                { kind: 'text', text: '物理 ' },
                {
                  kind: 'math',
                  expression: [{ kind: 'text', text: 'v-t' }],
                },
                { kind: 'text', text: ' 图中的速度单位可写为 ' },
                { kind: 'upright-unit', text: 'm·s', exponent: '−1' },
                { kind: 'text', text: '，角频率用希腊字母 ' },
                { kind: 'math', expression: [{ kind: 'text', text: 'ω' }] },
                { kind: 'text', text: ' 表示。' },
              ],
              answerArea: { lines: 2, label: '答题区（物理演示）' },
            },
          ],
        },
        {
          title: '第三部分 英语阅读格式',
          questions: [
            {
              number: '4',
              score: 5,
              prompt: [
                { kind: 'text', text: 'Read the passage and choose the best answer. Circle A, B, C, or D.' },
              ],
              answerArea: { lines: 2, label: 'Answer area (English demonstration)' },
            },
          ],
        },
      ],
    },
    doubts: [
      {
        question: '本演示未关联真实试题原页，是否需要在接入时保留来源定位？',
        source: { kind: 'unknown' },
      },
    ],
  };
}
