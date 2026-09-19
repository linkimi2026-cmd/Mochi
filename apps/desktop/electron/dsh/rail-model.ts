import type { RailAttentionPayload, RailRow, RailSnapshot, RailTone } from "./protocol";

/**
 * [Mochi 2026-09-18] 常驻条的数据派生层。
 *
 * 这一层只做一件事：把「已认证页面拿到的 LAN 快照」翻译成常驻条要显示的行。
 * 它刻意不碰 Electron、不碰网络、不认识窗口——因此可以脱离 Electron 直接测。
 *
 * 两块屏共用同一个行模型，差别只在「一行的状态意味着什么」：
 *   teacher-rail     一行 = 一位学生的预约待办；badge 是排队状态
 *   classroom-board  一行 = 一位学生的处置结果；badge 是过关/不过关
 * 这样两块屏不需要两套渲染，也不需要第二个事实源。
 *
 * 输入是 HTTP 响应体，一律当作不可信：所有字段都裁剪、所有类型都对不上就丢弃该行，
 * 绝不因为一行畸形而让整块屏显示错误内容。
 */

/** 学生预约的语义类型。未知值归到 other，而不是丢行——丢行等于让学生以为预约成功了。 */
export type RequestKind = "appointment" | "question" | "makeup" | "other";

/** 教师下发到教室端的处置动作。 */
export type DirectiveAction = "call" | "pass" | "fail" | "retry";

export interface StudentRequest {
  messageId: string;
  /** 学生姓名。来自预约正文的结构化字段，不是教室设备名。 */
  student: string;
  /** 学号/座号，用于「1、2、3…」的稳定排序；没有就是 null。 */
  seat: number | null;
  kind: RequestKind;
  /** 哪份作业/材料，例如「步步高 Unit 5」。 */
  material: string;
  /** 哪道题/哪个位置，例如「完形填空第 7 空」。 */
  position: string;
  /** 预约的知识点主题，例如「二次函数」。 */
  topic: string;
  /** 预约的时间，例如「第八节晚自习」。 */
  slot: string;
  /** 学生自己写的正文。 */
  body: string;
  receivedAt: string;
  /** 老师已确认看到的时刻；空串表示还没看到。 */
  seenAt: string;
}

export interface TeacherDirective {
  messageId: string;
  student: string;
  seat: number | null;
  action: DirectiveAction;
  /** 对应的听写/作业名目，例如「第 5 单元听写」。 */
  item: string;
  /**
   * 给这位学生看的个性化交代（该补什么、错在哪、下一步找谁）。
   *
   * 这段文字是 Mochi 调 skill 逐人生成后随判决过网带过来的，**不是**这边按
   * action 拼出来的模板：所以这一层只负责显示、绝不负责生成。空串表示老师没给
   * 交代（例如只是喊人），这时板上就只显示名目——绝不拿整批的正文去填每一行，
   * 否则 40 行会重复同一句话。
   *
   * 例外：不带 directive 的普通通知（老师只是说一句话）没有"名目"可言，此时
   * item 为空、note 直接放这句话本身，两处不会重复显示同一串字。
   */
  note: string;
  body: string;
  receivedAt: string;
}

/** 单行上限。必须与 rail.ts 的 LIMITS.rows 一致，否则主进程会静默砍掉尾部。 */
export const RAIL_ROW_LIMIT = 50;

const LIMITS = Object.freeze({
  id: 160,
  heading: 60,
  detail: 80,
  name: 80,
  meta: 80,
  note: 240,
  badge: 24,
  at: 40,
});

const REQUEST_KINDS: readonly RequestKind[] = ["appointment", "question", "makeup", "other"];
const DIRECTIVE_ACTIONS: readonly DirectiveAction[] = ["call", "pass", "fail", "retry"];

/** 预约类型的展示名。放在模型层，两块屏就不会各写一份中文。 */
const KIND_LABELS: Readonly<Record<RequestKind, string>> = Object.freeze({
  appointment: "预约讲题",
  question: "提问",
  makeup: "补做登记",
  other: "留言",
});

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  // 与 rail.ts 的裁剪规则保持一致：控制字符会污染窗口和日志，直接剔除。
  // 理由同 rail.ts —— \p{Cc} 覆盖 C0 + DEL + C1，比枚举区间更完整。
  return value.replace(/\p{Cc}/gu, " ").normalize("NFC").trim().slice(0, maximum);
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function seatOf(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 999) return null;
  return parsed;
}

function kindOf(value: unknown): RequestKind {
  return typeof value === "string" && (REQUEST_KINDS as readonly string[]).includes(value)
    ? (value as RequestKind)
    : "other";
}

function actionOf(value: unknown): DirectiveAction | null {
  return typeof value === "string" && (DIRECTIVE_ACTIONS as readonly string[]).includes(value)
    ? (value as DirectiveAction)
    : null;
}

/** RFC3339 的字典序即时间序；解析不出来的时间排到最前，而不是抛错。 */
function timeKey(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T/u.test(value) ? value : "";
}

function identityRole(value: unknown): string {
  return plain(value) ? text(value.role, 24) : "";
}

function envelopeRequest(value: unknown): Record<string, unknown> | null {
  return plain(value) ? value : null;
}

/* ───────────────────────── 读：LAN 快照 → 结构化条目 ───────────────────────── */

/**
 * 从教师端的收件箱读出学生预约。
 *
 * 只认 `from.role === 'classroom'` 的收件：教师端可能同时配对多个教室设备，
 * 而不是每个学生一个端点——学生身份在 `request.student` 里，不在 `from` 上。
 * 缺 student 的收件不作为预约显示（它多半是旧格式通知），但也不丢弃整份快照。
 */
export function readStudentRequests(lan: unknown): StudentRequest[] {
  if (!plain(lan)) return [];
  const collected: StudentRequest[] = [];
  for (const candidate of rows(lan.inbox)) {
    if (!plain(candidate)) continue;
    const messageId = text(candidate.messageId, LIMITS.id);
    if (messageId === "") continue;
    if (identityRole(candidate.from) !== "classroom") continue;
    const request = envelopeRequest(candidate.request);
    if (request === null) continue;
    const student = text(request.student, LIMITS.name);
    if (student === "") continue;
    collected.push({
      messageId,
      student,
      seat: seatOf(request.seat),
      kind: kindOf(request.kind),
      material: text(request.material, LIMITS.meta),
      position: text(request.position, LIMITS.meta),
      topic: text(request.topic, LIMITS.note),
      slot: text(request.slot, LIMITS.meta),
      body: text(candidate.body, LIMITS.note),
      receivedAt: text(candidate.receivedAt, LIMITS.at),
      seenAt: text(candidate.seenAt, LIMITS.at),
    });
  }
  return collected;
}

/**
 * 从教室端的收件箱读出教师处置。
 *
 * 一次登记（例如一次听写）是**一条消息**，里面带一批 verdict，而不是每个学生一条
 * 消息：一个班 40 人就是 40 条签名消息、40 条回执，还会把收件箱上限吃掉。
 * 展开放成行的时候按 verdict 展开，所以板上仍然是一人一行。
 *
 * 同样只认 `from.role === 'teacher'`；`directive` 缺失的通知是普通喊话，
 * 归为 action='call'，这样「老师只是叫一声」也能上板。
 */
export function readTeacherDirectives(lan: unknown): TeacherDirective[] {
  if (!plain(lan)) return [];
  const collected: TeacherDirective[] = [];
  for (const candidate of rows(lan.inbox)) {
    if (!plain(candidate)) continue;
    const messageId = text(candidate.messageId, LIMITS.id);
    if (messageId === "") continue;
    if (identityRole(candidate.from) !== "teacher") continue;
    const body = text(candidate.body, LIMITS.note);
    const receivedAt = text(candidate.receivedAt, LIMITS.at);
    const directive = envelopeRequest(candidate.directive);
    if (directive === null) {
      // 不带名册的普通通知：老师说的是「一句话」，没有名目可言。把它整句放进 note、
      // 让 item 留空，行上就不会把同一串字显示两遍。
      collected.push({ messageId, student: "", seat: null, action: "call", item: "", note: body, body, receivedAt });
      continue;
    }
    const item = text(directive.item, LIMITS.meta);
    const verdicts = Array.isArray(directive.verdicts) ? directive.verdicts : [];
    let index = 0;
    for (const raw of verdicts) {
      if (!plain(raw)) continue;
      const action = actionOf(raw.action);
      if (action === null) continue;
      const student = text(raw.student, LIMITS.name);
      if (student === "") continue;
      collected.push({
        // 一条消息里可能有多条处置，行 id 必须带下标，否则同一条消息的两行会互相盖掉。
        messageId: verdicts.length === 1 ? messageId : `${messageId}#${index}`,
        student,
        seat: seatOf(raw.seat),
        action,
        item,
        note: text(raw.note, LIMITS.note),
        body,
        receivedAt,
      });
      index += 1;
    }
  }
  return collected;
}

/* ───────────────────────── 排序 ───────────────────────── */

/**
 * 待办队列的排序：没处理的按到达时间升序（先到先排号），已处理的沉到后面。
 * 「1、2、3、4…」因此是排队号，不是座号——老师按号叫人，处理完一个，后面的号不会乱跳。
 */
function orderPendingFirst<T extends { receivedAt: string }>(
  items: readonly T[],
  isPending: (item: T) => boolean,
): T[] {
  const pending = items.filter(isPending).sort((left, right) => timeKey(left.receivedAt).localeCompare(timeKey(right.receivedAt)));
  const settled = items.filter((item) => !isPending(item)).sort((left, right) => timeKey(right.receivedAt).localeCompare(timeKey(left.receivedAt)));
  return [...pending, ...settled];
}

/* ───────────────────────── 派生：条目 → 常驻条快照 ───────────────────────── */

function requestRow(item: StudentRequest, index: number): RailRow {
  const label = KIND_LABELS[item.kind];
  // 「哪份作业的哪道题」拼成一个片段插在类型后面：老师扫一眼就知道要翻到哪一页，
  // 这是预约真正的用处。两者都没有时这一段整体消失，旧预约的显示不受影响。
  const place = [item.material, item.position].filter(Boolean).join(" ");
  const detail = [place, item.topic, item.slot].filter(Boolean).join(" · ");
  const pending = item.seenAt === "";
  return {
    id: item.messageId,
    seq: index + 1,
    name: item.student,
    meta: [label, detail].filter(Boolean).join(" · ").slice(0, LIMITS.meta),
    // 学生自己写的原话原样上板：那是这一条预约里最个性化的部分，不该被任何模板改写。
    note: item.body,
    badge: pending ? "待处理" : "已看到",
    tone: pending ? "attention" : "neutral",
    at: item.receivedAt,
  };
}

const DIRECTIVE_TONES: Readonly<Record<DirectiveAction, RailTone>> = Object.freeze({
  call: "attention",
  pass: "ok",
  fail: "bad",
  retry: "attention",
});

const DIRECTIVE_LABELS: Readonly<Record<DirectiveAction, string>> = Object.freeze({
  call: "老师叫你",
  pass: "过关",
  fail: "不过关",
  retry: "需补做",
});

function directiveRow(item: TeacherDirective, index: number): RailRow {
  return {
    id: item.messageId,
    seq: index + 1,
    name: item.student === "" ? "全班" : item.student,
    // 名目在上、个性化交代在下：学生扫一眼就同时看到「哪件事」和「我该做什么」。
    meta: item.item,
    note: item.note,
    badge: DIRECTIVE_LABELS[item.action],
    tone: DIRECTIVE_TONES[item.action],
    at: item.receivedAt,
  };
}

/** 教师端常驻条：学生预约待办。标题带未处理数，老师一眼知道要不要处理。 */
export function teacherRailSnapshot(lan: unknown, now: string): RailSnapshot {
  const requests = orderPendingFirst(readStudentRequests(lan), (item) => item.seenAt === "");
  const pending = requests.filter((item) => item.seenAt === "").length;
  return {
    surface: "teacher-rail",
    heading: pending === 0 ? "待办 · 暂无" : `待办 · ${pending} 位学生`,
    detail: requests.length === 0 ? "没有学生预约" : `共 ${requests.length} 条`,
    updatedAt: text(now, LIMITS.at),
    rows: requests.slice(0, RAIL_ROW_LIMIT).map(requestRow),
  };
}

/**
 * 教室端常驻板：老师叫谁、谁过关。
 *
 * 未过关排在前面——那是学生接下来要自己处理的事；过关的沉底作为已完成的交代。
 */
export function classroomRailSnapshot(lan: unknown, now: string): RailSnapshot {
  const directives = orderPendingFirst(
    readTeacherDirectives(lan),
    (item) => item.action === "call" || item.action === "fail" || item.action === "retry",
  );
  const open = directives.filter((item) => item.action !== "pass").length;
  return {
    surface: "classroom-board",
    heading: open === 0 ? "板上无事" : `待办 · ${open} 条`,
    detail: directives.length === 0 ? "老师还没布置" : `共 ${directives.length} 条`,
    updatedAt: text(now, LIMITS.at),
    rows: directives.slice(0, RAIL_ROW_LIMIT).map(directiveRow),
  };
}

/**
 * 从「上一份快照」和「这一份快照」里找出需要弹窗的那一条。
 *
 * 刻意只返回**至多一条**：老师一次登记听写结果就会下发一整批（一个学生一条），
 * 若逐行弹窗，教室屏上会连弹几十次——那是骚扰而不是提醒。多条同时到达时聚合成
 * 一条「N 位同学」，剩下的交给常驻条本身去列。
 *
 * 首次拿到快照（previous 为 null）不弹，否则每次启动都会把历史待办全弹一遍。
 */
export function newAttentionPayloads(
  surface: RailSnapshot["surface"],
  previous: RailSnapshot | null,
  next: RailSnapshot,
): RailAttentionPayload[] {
  if (previous === null || previous.surface !== surface) return [];
  const known = new Set(previous.rows.map((row) => row.id));
  // 已过关/已看到这类「好消息」不打断注意力，只留一个例外：教室端出现的「过关」
  // 是学生等着看的结果，值得弹一次——所以按 surface 决定哪些 tone 值得弹。
  const worthAttention = next.rows.filter((row) => {
    if (known.has(row.id)) return false;
    if (surface === "teacher-rail") return row.tone === "attention";
    return row.tone !== "neutral";
  });
  if (worthAttention.length === 0) return [];

  const first = worthAttention[0];
  const surfaceKind = surface === "teacher-rail" ? "request" : "call";
  const surfaceTitle = surface === "teacher-rail" ? "新的学生预约" : "老师叫你";
  const surfaceSubject = surface === "teacher-rail" ? "新预约" : "新任务";
  // 弹窗只有一行位置，两块屏该放的东西不一样：
  //   教师端 —— 放结构化摘要（类型 · 主题 · 时间），老师按类型扫；
  //   教室端 —— 放那位学生的个性化交代，那才是他弹窗后要照着做的事。
  const detail = surface === "teacher-rail"
    ? (first.meta || first.note)
    : (first.note || first.meta);
  if (worthAttention.length === 1) {
    return [{
      id: first.id,
      kind: surfaceKind,
      title: surfaceTitle,
      subject: first.name,
      detail,
      at: first.at,
    }];
  }
  return [{
    // 聚合后的 id 必须能代表「这一批」：用首行 id + 条数，避免与单行 id 撞车，
    // 也避免同一批在冷却期外被重复弹。
    id: `${first.id}#${worthAttention.length}`,
    kind: surfaceKind,
    title: surfaceTitle,
    subject: `${worthAttention.length} 位同学 · ${surfaceSubject}`,
    detail: worthAttention.slice(0, 3).map((row) => row.name).join("、") + (worthAttention.length > 3 ? " 等" : ""),
    at: first.at,
  }];
}
