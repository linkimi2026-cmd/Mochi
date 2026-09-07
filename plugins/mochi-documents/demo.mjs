/** Explicit non-user demonstration fixture for the generator test suite. */
export function demonstrationStructuredNotice() {
  return {
    sourceKind: 'demonstration',
    sourceLabel: '演示材料 非真实通知 不代表任何学生或校园安排',
    title: '演示 校园秋季健康提醒',
    pages: [
      {
        blocks: [
          { kind: 'heading', level: 1, text: '一 事项说明' },
          { kind: 'paragraph', text: '本页为文档生成模块的演示结构化材料。它用于验证标题、段落、可编辑文字和页间分页，不对应真实通知。' },
          { kind: 'paragraph', text: '请由上游授权流程确认来源后，再把识别完成的结构化内容交给本模块排版。' },
        ],
      },
      {
        blocks: [
          { kind: 'heading', level: 1, text: '二 演示安排表' },
          {
            kind: 'table',
            columns: ['日期', '事项', '负责角色', '备注'],
            rows: [
              ['9月8日', '健康提醒发布', '班主任', '演示记录'],
              ['9月10日', '反馈汇总', '校医', ''],
              ['9月12日', '家校确认', '年级组', '演示记录'],
            ],
          },
          { kind: 'paragraph', text: '表格由真实 Word 表格元素生成，后续可以在 Word 中直接编辑单元格。' },
        ],
      },
      {
        blocks: [
          { kind: 'heading', level: 1, text: '三 待核对事项' },
          { kind: 'paragraph', text: '以下疑点只用于演示机器可读的来源定位。实际材料应由授权上游提供页码和归一化区域，无法定位时应明确标为未知。' },
          { kind: 'paragraph', text: '生成的 PDF 来自同一份 DOCX 的本机 LibreOffice 转换，不以整页图片代替可编辑 Word 内容。' },
        ],
      },
    ],
    doubts: [
      {
        question: '演示区域中的日期是否需要由授权上游复核？',
        source: { kind: 'normalized-region', page: 2, x: 0.14, y: 0.25, width: 0.72, height: 0.28 },
      },
      {
        question: '演示材料没有真实来源页时，是否应保持未知？',
        source: { kind: 'unknown' },
      },
    ],
  };
}
