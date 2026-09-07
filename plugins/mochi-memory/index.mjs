// mochi-memory · Mochi 记忆域（工单 MOCHI-P5-MEM-03 / MEM-03c）。
// 把已验收的两层存储（world-state.mjs 纯文件层 + mem-store.mjs sqlite 层）包成 dsh 插件，
// 注册 6 个对话工具。记忆是本地低风险读写，不走审批闸（memory_clear 防误清靠描述复述纪律 + forget 快照可恢复两层）。
// 写入纪律（Memory Confidence）写在工具描述里，模型靠描述决策；存储层另有正则护栏兜底。
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createStore } from './mem-store.mjs';
import { openWorldState } from './world-state.mjs';

export const name = 'mochi-memory';
export const inject = ['tools'];
// render 签名必须是 (args, value)（2026-09-05 大坑 17）：单参写法会把调用参数当结果给模型。
export const output = { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

const KIND_LABELS = {
  preference: '个人偏好',
  task_fact: '任务事实',
  org_knowledge: '组织知识',
  convention: '班级约定',
};

const kindLabel = (kind) => KIND_LABELS[kind] || String(kind || '未注明类型');

// 记忆来源中文映射。mem-store 的 SOURCE_LABELS 是模块私有不可导入，这里按工单自写一份，保持同格式。
const SOURCE_LABELS = {
  user_statement: '用户陈述',
  repeated: '多次重复',
  explicit_request: '明确要求',
};

const sourceLabel = (source) => SOURCE_LABELS[source] || '未注明来源';

export function apply(ctx, storeArg = null, worldArg = null) {
  const store = storeArg || createStore();
  const world = worldArg || openWorldState();
  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }));

  // 1) 写长期记忆。描述即纪律：只有三种情况允许写，敏感内容绝不写（存储层护栏还会拒一次）。
  register('mochi.memory_note', '把一条长期记忆写入 Mochi 的记忆库。写入纪律（Memory Confidence，必须遵守）：只在三种情况写——①主人明确表达长期偏好（例如"我以后都要…""记住我…"）；②同一偏好多次稳定重复；③主人主动要求记住。一次性闲聊、成绩明细、医疗健康、密码令牌、私人文件全文绝不写入（即使写了，存储层护栏也会拒绝）。主人随口一提的临时事项请用 mochi.memory_world 的 append-todo，不要写进长期记忆。', {
    kind: { type: 'string', enum: ['preference', 'task_fact', 'org_knowledge', 'convention'], required: true, description: '记忆类型：preference=个人偏好 / task_fact=任务事实 / org_knowledge=组织知识 / convention=班级约定。' },
    content: { type: 'string', required: true, description: '记忆正文（一句话，写清事实本身，不含敏感信息）。' },
    summary: { type: 'string', description: '可选的更短摘要（≤40 字），便于检索与展示。' },
    importance: { type: 'number', description: '重要度 0-1，默认 0.5；主人反复强调或明确要求记住的给高一些。' },
    source: { type: 'string', enum: ['user_statement', 'repeated', 'explicit_request'], description: '记忆来源：user_statement=主人陈述 / repeated=多次重复 / explicit_request=主人明确要求记住。尽量给；不给的话 recall 里会显示"未注明来源"。' },
  }, async (args) => {
    const kind = String(args.kind || '');
    const content = String(args.content || '').trim();
    if (!content) throw new Error('记忆内容不能为空。');
    const summary = String(args.summary || '').trim();
    const note = store.note({ kind, content, summary, importance: args.importance === undefined ? undefined : Number(args.importance), source: args.source ? String(args.source) : undefined });
    world.appendEvent({
      kind: 'memory-note',
      summary: `写入${kindLabel(kind)}：${(summary || content).slice(0, 80)}`,
      refs: [note.id],
      actor: 'mochi-memory',
    });
    if (kind === 'convention') world.setConvention(summary || content);
    return {
      已记住: true,
      记忆ID: note.id,
      类型: kindLabel(kind),
      内容: content,
      ...(summary ? { 摘要: summary } : {}),
      说明: '已写入长期记忆，并留了审计记录。',
    };
  });

  // 2) 检索记忆。每条结果带「为什么Mochi知道这个」（存储层已生成）；tightened 时如实说明。
  register('mochi.memory_recall', '从 Mochi 的长期记忆里检索相关条目。主人问"你还记得我…吗"或回答前想核对主人偏好/班级约定时使用。结果每条都带"为什么Mochi知道这个"（来源+时间+被召回次数），要如实转述给主人，方便主人检查和纠正。', {
    query: { type: 'string', required: true, description: '检索关键词（2-8 个字效果最好）。' },
    topK: { type: 'integer', description: '最多返回几条，默认由系统决定（引用率低时会自动收紧）。' },
  }, async (args) => {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('请给出检索关键词。');
    const result = store.recall(query, { topK: args.topK === undefined ? undefined : Number(args.topK) });
    const hits = result.memories.map((row) => ({
      记忆ID: row.id,
      类型: kindLabel(row.kind),
      内容: row.content,
      为什么Mochi知道这个: row['为什么Mochi知道这个'],
    }));
    return {
      查询: query,
      命中条数: hits.length,
      命中: hits,
      ...(result.tightened ? { 说明: '近期记忆引用率低，已收紧检索范围，只返回最相关的几条。' } : {}),
      ...(hits.length ? {} : { 说明: '记忆库里没有找到相关内容，如实告知主人即可，不要编造。' }),
    };
  });

  // 3) 忘记一条。主人说"忘掉/别记了"时用；审计行保留快照，不静默消失。
  register('mochi.memory_forget', '从长期记忆里彻底忘掉一条（主人说"忘掉这个""别记了"时使用）。需要记忆 ID（来自 mochi.memory_recall 的结果），不得猜测。忘记是删除性的，执行前应向主人复述要忘的内容。', {
    id: { type: 'integer', required: true, description: '要忘记的记忆 ID。' },
  }, async (args) => {
    const id = Math.floor(Number(args.id));
    const result = store.forget(id);
    return {
      已忘记: true,
      记忆ID: id,
      原内容: result.snapshot.content,
      说明: `已忘掉记忆 #${id}，审计日志里留有快照备查。`,
    };
  });

  // 4) 列出全部记忆与统计。主人问"你记了我什么"时用；真实调 store.listAll + store.stats，如实完整展示。
  register('mochi.memory_list', '列出 Mochi 长期记忆库里的全部记忆和统计（主人问"你记了我什么""让我看看你记住了哪些"时使用）。返回每条记忆的 ID、类型、内容、来源、创建时间、被召回次数和是否 pinned。要如实完整展示，方便主人检查和纠正。', {
    scopeId: { type: 'string', description: '可选的作用域过滤（默认全部）。' },
    includeInvalid: { type: 'boolean', description: '是否连同已被取代的记忆一起列出，默认 false。' },
  }, async (args) => {
    const rows = store.listAll({
      scopeId: args.scopeId === undefined ? undefined : String(args.scopeId),
      includeInvalid: Boolean(args.includeInvalid),
    });
    const stats = store.stats();
    const list = rows.map((row) => ({
      记忆ID: row.id,
      类型: kindLabel(row.kind),
      内容: row.content,
      pinned: Boolean(row.pinned),
      来源: `来源：${sourceLabel(row.source)}；创建于 ${row.created_at}；已被召回 ${Number(row.recall_count)} 次`,
      创建时间: row.created_at,
      被召回次数: Number(row.recall_count),
    }));
    return {
      统计: {
        总数: stats.total,
        已激活: stats.active,
        免疫: stats.pinned,
        已归档: stats.expired,
        已取代: stats.invalid,
      },
      记忆列表: list,
      ...(list.length ? {} : { 说明: '记忆库还是空的。' }),
    };
  });

  // 5) 工作状态快照。描述写明：跨天开始工作时先 read 恢复上下文。
  register('mochi.memory_world', '读写 Mochi 的工作状态快照（world-state.md：待办 / 近 24h 变更 / 已知约定）。跨天开始工作时先 action=read 恢复上下文，再继续干活。临时事项（今天要做的事）用 append-todo 记进待办；完成待办用 complete-todo；干完一件值得留痕的事用 append-change；班级固定约定用 set-convention。', {
    action: { type: 'string', enum: ['read', 'append-todo', 'complete-todo', 'append-change', 'set-convention'], required: true, description: 'read=读全文 / append-todo=加待办 / complete-todo=勾掉待办 / append-change=记一条变更 / set-convention=登记约定。' },
    text: { type: 'string', description: 'append-todo / complete-todo / append-change / set-convention 时必填的一句话内容。' },
  }, async (args) => {
    const action = String(args.action || '');
    const text = String(args.text || '').trim();
    if (action === 'read') {
      return { 工作状态全文: world.readWorldState() };
    }
    if (!text) throw new Error('除 read 外都要给出 text 内容。');
    if (action === 'append-todo') {
      world.appendTodo(text);
      return { 已加入待办: text, 说明: '已写进工作状态的待办段。' };
    }
    if (action === 'complete-todo') {
      const done = world.completeTodo(text);
      return {
        已完成: done,
        ...(done ? {} : { 说明: `待办里没有找到「${text}」，可先用 read 核对再试。` }),
      };
    }
    if (action === 'append-change') {
      world.appendChange(text);
      return { 已记录变更: text, 说明: '已带时间戳写进「近 24h 变更」。' };
    }
    if (action === 'set-convention') {
      world.setConvention(text);
      return { 已登记约定: text, 说明: '已写进「已知约定」段，重复登记会自动去重。' };
    }
    throw new Error(`未知 action：${action}。`);
  });

  // 6) 一键清空全部记忆。描述即纪律：批量删除必须先向主人复述条数（含 pinned 数）并获明确同意。
  //    决策记录（工单 MEM-03c）：不接 approval 审批闸；防误清靠 ①模型侧复述确认 ②forget 审计快照可恢复。
  register('mochi.memory_clear', '清空 Mochi 长期记忆库里的全部记忆（一键清空）。这是批量删除操作：执行前必须先向主人复述"将删除全部 N 条记忆（含 X 条 pinned 免疫记忆）"，获得主人明确同意后才可执行，绝不擅自执行。清空是不可逆的，但审计日志会保留每条记忆的快照备查。', {}, async () => {
    const stats = store.stats();
    if (stats.total === 0) {
      return { 已清空: true, 删除条数: 0, 说明: '记忆库本来就是空的。' };
    }
    const rows = store.listAll({ includeInvalid: true });
    for (const row of rows) store.forget(row.id); // forget 已留审计快照；pinned 行同样清掉（一键清空=全部，描述已向主人明示）。
    return {
      已清空: true,
      删除条数: stats.total,
      其中pinned: stats.pinned,
      说明: '全部记忆已清空，审计日志保留每条快照备查。',
    };
  });
}
