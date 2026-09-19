// One shared scene keeps native PPTX and the separate PDF handout semantically aligned.
export const PROCESS_SCHEMA = {
  type: 'object',
  description: '可编辑步骤图：steps为3-4个{label,detail}，label≤10字、detail≤32字；仅真实循环填写loopLabel（≤32字），普通流程省略。与table/chart互斥，版式必须title-process，bullets至多1条短说明。',
  properties: {
    steps: { type: 'array', required: true, items: {
      type: 'object', additionalProperties: false,
      properties: { label: { type: 'string', required: true, description: '短步骤名，1-10字' }, detail: { type: 'string', required: true, description: '1-32字短句' } },
    } },
    loopLabel: { type: 'string', description: '1-32字短句' },
  },
  additionalProperties: false,
};

export function validateProcess(value) {
  if (!value || !Array.isArray(value.steps) || value.steps.length < 3 || value.steps.length > 4) throw new Error('process.steps需要3-4个步骤');
  const bounded = (text, max, field) => {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > max || /[\r\n]/u.test(text)) throw new Error(`${field}必须为1-${max}字单段文本`);
    return text.trim();
  };
  const steps = value.steps.map(step => ({ label: bounded(step?.label, 10, '步骤label'), detail: bounded(step?.detail, 32, '步骤detail') }));
  const loopLabel = value.loopLabel === undefined ? undefined : bounded(value.loopLabel, 32, 'loopLabel');
  return { steps, ...(loopLabel === undefined ? {} : { loopLabel }) };
}

export function processScene(process) {
  const gap = 0.52;
  const width = (11.73 - gap * (process.steps.length - 1)) / process.steps.length;
  const cards = process.steps.map((step, index) => ({ ...step, x: 0.8 + index * (width + gap), y: 2.4, w: width, h: 3 }));
  const arrows = cards.slice(0, -1).map(card => ({ x1: card.x + width + 0.07, y1: 3.9, x2: card.x + width + gap - 0.07, y2: 3.9, head: true }));
  if (process.loopLabel) {
    const left = cards[0].x + width / 2;
    const right = cards.at(-1).x + width / 2;
    arrows.push({ x1: right, y1: 5.4, x2: right, y2: 6.2 }, { x1: right, y1: 6.2, x2: left, y2: 6.2 }, { x1: left, y1: 6.2, x2: left, y2: 5.4, head: true });
  }
  return { cards, arrows };
}

export function drawProcessPptx(slide, process, theme, fontFace) {
  const { cards, arrows } = processScene(process);
  for (const card of cards) {
    slide.addShape('rect', { x: card.x, y: card.y, w: card.w, h: card.h, fill: { color: theme.surface }, line: { color: theme.rule, width: 1 } });
    slide.addShape('rect', { x: card.x, y: card.y, w: card.w, h: 0.08, fill: { color: theme.primary }, line: { color: theme.primary, transparency: 100 } });
    slide.addText(card.label, { x: card.x + 0.2, y: card.y + 0.4, w: card.w - 0.4, h: 0.95, fontFace, fontSize: 26, bold: true, color: theme.primary, margin: 0, valign: 'top', lang: 'zh-CN' });
    slide.addText(card.detail, { x: card.x + 0.2, y: card.y + 1.45, w: card.w - 0.4, h: 1.35, fontFace, fontSize: 18, lineSpacing: 22.5, color: theme.text, margin: 0, valign: 'top', lang: 'zh-CN' });
  }
  for (const a of arrows) {
    const reverse = a.x2 < a.x1 || a.y2 < a.y1;
    slide.addShape('line', { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1), line: { color: theme.primary, width: 2, ...(a.head ? { [reverse ? 'beginArrowType' : 'endArrowType']: 'triangle' } : {}) } });
  }
  if (process.loopLabel) slide.addText(process.loopLabel, { x: 0.8, y: 5.65, w: 11.73, h: 0.4, fontFace, fontSize: 18, color: theme.primary, align: 'center', margin: 0, lang: 'zh-CN' });
}
