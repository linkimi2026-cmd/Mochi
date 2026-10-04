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

/** 学生请求的语义类型。未知值归到 other，而不是丢行。 */
export type RequestKind = "appointment" | "question" | "makeup" | "other";

/** 教师下发到教室端的处置动作。 */
export type DirectiveAction = "call" | "pass" | "fail" | "retry";

export interface StudentRequest {
  messageId: string;
  /** 学生姓名。来自预约正文的结构化字段，不是教室设备名。 */
  student: string;
  /** 来自签名发件身份；旧消息可能没有班级字段。 */
  classId: string;
  senderDisplayName: string;
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
  fromEndpointId: string;
  fromFingerprint: string;
  /** 旧身份或已解除配对的收件只能留作历史。 */
  active: boolean;
  response: StudentResponse | null;
}

export interface StudentResponse {
  decision: "confirmed" | "rescheduled" | "replied";
  slot: string;
  /** Signed teacher message body for a non-appointment request. */
  body: string;
  delivery: "PENDING" | "ACKNOWLEDGED" | "UNKNOWN" | "NOT_SENT" | "RECEIPT_SEEN";
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
  source: "plain" | "directive";
  popupComplete: boolean;
}

export interface TeacherNotification {
  messageId: string;
  name: string;
  meta: string;
  note: string;
  target: string;
  delivery: "PENDING" | "ACKNOWLEDGED" | "UNKNOWN" | "NOT_SENT" | "RECEIPT_SEEN";
  createdAt: string;
  /** 原发件身份与目标配对都仍属于当前教师时才可操作。 */
  active: boolean;
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
  endpoint: 120,
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

function fullyPreserved(value: unknown, maximum: number): boolean {
  return typeof value === "string" && value === text(value, maximum);
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

function kindOf(value: unknown, slot: unknown): RequestKind {
  return typeof value === "string" && (REQUEST_KINDS as readonly string[]).includes(value)
    ? (value as RequestKind)
    : value === undefined && text(slot, LIMITS.meta) ? "appointment" : "other";
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

function sameIdentity(left: unknown, right: unknown): boolean {
  if (!plain(left) || !plain(right)) return false;
  const fields = ["endpointId", "role", "schoolId", "classId", "displayName", "fingerprint"] as const;
  if (!text(left.endpointId, LIMITS.endpoint) || !text(left.fingerprint, LIMITS.endpoint)) return false;
  return fields.every((field) => text(left[field], LIMITS.endpoint) === text(right[field], LIMITS.endpoint));
}

function envelopeRequest(value: unknown): Record<string, unknown> | null {
  return plain(value) ? value : null;
}

function responsesByRequest(lan: Record<string, unknown>): Map<string, StudentResponse & { targetEndpointId: string; fingerprint: string }> {
  const result = new Map<string, StudentResponse & { targetEndpointId: string; fingerprint: string }>();
  const receipts = new Map<string, string>();
  for (const receipt of rows(lan.receipts)) {
    if (!plain(receipt)) continue;
    const id = text(receipt.messageId, LIMITS.id);
    const fingerprint = plain(receipt.from) ? text(receipt.from.fingerprint, LIMITS.endpoint) : "";
    if (id && fingerprint) receipts.set(id, fingerprint);
  }
  for (const item of rows(lan.outbox)) {
    if (!plain(item) || item.contentType !== "NOTIFY") continue;
    const response = envelopeRequest(item.response);
    if (response === null) continue;
    const decision = response.decision;
    if (decision !== "confirmed" && decision !== "rescheduled" && decision !== "replied") continue;
    const replyTo = text(response.replyToMessageId, LIMITS.id);
    if (!replyTo) continue;
    const delivery = ["PENDING", "ACKNOWLEDGED", "UNKNOWN", "NOT_SENT"].includes(String(item.delivery))
      ? item.delivery as StudentResponse["delivery"] : "UNKNOWN";
    result.set(replyTo, {
      decision,
      slot: text(response.slot, LIMITS.meta),
      body: text(item.body, LIMITS.note),
      delivery: receipts.get(text(item.messageId, LIMITS.id)) === text(plain(item.peer) ? item.peer.fingerprint : "", LIMITS.endpoint)
        && text(plain(item.peer) ? item.peer.fingerprint : "", LIMITS.endpoint) !== "" ? "RECEIPT_SEEN" : delivery,
      targetEndpointId: text(item.targetEndpointId, LIMITS.endpoint),
      fingerprint: plain(item.peer) ? text(item.peer.fingerprint, LIMITS.endpoint) : "",
    });
  }
  return result;
}

/* ───────────────────────── 读：LAN 快照 → 结构化条目 ───────────────────────── */

/**
 * 从教师端的收件箱读出学生请求。
 *
 * 只认 `from.role === 'classroom'` 的收件：教师端可能同时配对多个教室设备，
 * 而不是每个学生一个端点——学生身份在 `request.student` 里，不在 `from` 上。
 * 缺 student 的收件不作为请求显示（它多半是旧格式通知），但也不丢弃整份快照。
 */
export function readStudentRequests(lan: unknown): StudentRequest[] {
  if (!plain(lan)) return [];
  const responses = responsesByRequest(lan);
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
    const active = sameIdentity(candidate.recipient, lan.identity)
      && rows(lan.peers).some((peer) => plain(peer) && peer.blocked !== true && sameIdentity(peer, candidate.from));
    collected.push({
      messageId,
      student,
      classId: plain(candidate.from) ? text(candidate.from.classId, LIMITS.meta) : "",
      senderDisplayName: plain(candidate.from) ? text(candidate.from.displayName, LIMITS.name) : "",
      seat: seatOf(request.seat),
      kind: kindOf(request.kind, request.slot),
      material: text(request.material, LIMITS.meta),
      position: text(request.position, LIMITS.meta),
      topic: text(request.topic, LIMITS.note),
      slot: text(request.slot, LIMITS.meta),
      body: text(candidate.body, LIMITS.note),
      receivedAt: text(candidate.receivedAt, LIMITS.at),
      seenAt: text(candidate.seenAt, LIMITS.at),
      fromEndpointId: plain(candidate.from) ? text(candidate.from.endpointId, LIMITS.endpoint) : "",
      fromFingerprint: plain(candidate.from) ? text(candidate.from.fingerprint, LIMITS.endpoint) : "",
      active,
      response: (() => {
        const matched = responses.get(messageId);
        const endpointId = plain(candidate.from) ? text(candidate.from.endpointId, LIMITS.endpoint) : "";
        const fingerprint = plain(candidate.from) ? text(candidate.from.fingerprint, LIMITS.endpoint) : "";
        return matched && matched.targetEndpointId === endpointId
          && fingerprint !== "" && matched.fingerprint !== "" && matched.fingerprint === fingerprint
          ? { decision: matched.decision, slot: matched.slot, body: matched.body, delivery: matched.delivery }
          : null;
      })(),
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
 * 只公开当前教室身份收下、原教师仍在配对中的通知；旧班和旧密钥的名单留在
 * LAN 历史收件箱，不得带到新的教室常驻板。`directive` 缺失的通知是普通喊话，
 * 归为 action='call'，这样「老师只是叫一声」也能上板。
 */
export function readTeacherDirectives(lan: unknown): TeacherDirective[] {
  if (!plain(lan) || identityRole(lan.identity) !== "classroom") return [];
  const collected: TeacherDirective[] = [];
  for (const candidate of rows(lan.inbox)) {
    if (!plain(candidate)) continue;
    const messageId = text(candidate.messageId, LIMITS.id);
    if (messageId === "") continue;
    if (identityRole(candidate.from) !== "teacher") continue;
    if (!sameIdentity(candidate.recipient, lan.identity)) continue;
    if (!rows(lan.peers).some((peer) => plain(peer) && peer.blocked !== true && sameIdentity(peer, candidate.from))) continue;
    // A teacher's signed appointment reply has no directive. It belongs in the
    // classroom appointment timeline, never on the public call/dictation board.
    if (candidate.response !== undefined && candidate.response !== null) continue;
    // 已确认看到的通知退出常驻板；原始消息仍保存在收件箱。
    if (candidate.seenReceipt === "ACKNOWLEDGED") continue;
    const body = text(candidate.body, LIMITS.note);
    const receivedAt = text(candidate.receivedAt, LIMITS.at);
    const directive = envelopeRequest(candidate.directive);
    if (directive === null) {
      // 不带名册的普通通知：老师说的是「一句话」，没有名目可言。把它整句放进 note、
      // 让 item 留空，行上就不会把同一串字显示两遍。
      collected.push({ messageId, student: "", seat: null, action: "call", item: "", note: body, body, receivedAt,
        source: "plain", popupComplete: Boolean(body) && fullyPreserved(candidate.body, LIMITS.note) });
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
        source: "directive",
        popupComplete: fullyPreserved(candidate.body, LIMITS.note)
          && (directive.item === undefined || fullyPreserved(directive.item, LIMITS.meta))
          && fullyPreserved(raw.student, LIMITS.name)
          && (raw.note === undefined || fullyPreserved(raw.note, LIMITS.note)),
      });
      index += 1;
    }
  }
  return collected;
}

/** 教师发出的通知按消息汇总；一份听写名册只占一行，详情由主页面展示。 */
export function readTeacherNotifications(lan: unknown): TeacherNotification[] {
  if (!plain(lan)) return [];
  const seen = new Map<string, string>();
  for (const receipt of rows(lan.receipts)) {
    if (!plain(receipt)) continue;
    const id = text(receipt.messageId, LIMITS.id);
    const fingerprint = plain(receipt.from) ? text(receipt.from.fingerprint, LIMITS.endpoint) : "";
    if (id && fingerprint) seen.set(id, fingerprint);
  }
  const result: TeacherNotification[] = [];
  for (const candidate of rows(lan.outbox)) {
    if (!plain(candidate) || candidate.contentType !== "NOTIFY" || candidate.response !== undefined) continue;
    const messageId = text(candidate.messageId, LIMITS.id);
    const peer = plain(candidate.peer) ? candidate.peer : null;
    if (!messageId || identityRole(peer) !== "classroom") continue;
    const active = identityRole(lan.identity) === "teacher"
      && sameIdentity(candidate.sender, lan.identity)
      && text(candidate.targetEndpointId, LIMITS.endpoint) === text(peer?.endpointId, LIMITS.endpoint)
      && rows(lan.peers).some((current) => plain(current) && current.blocked !== true && sameIdentity(current, peer));
    const fingerprint = text(peer?.fingerprint, LIMITS.endpoint);
    const delivery = seen.get(messageId) === fingerprint && fingerprint !== "" ? "RECEIPT_SEEN"
      : ["PENDING", "ACKNOWLEDGED", "UNKNOWN", "NOT_SENT"].includes(String(candidate.delivery))
        ? candidate.delivery as TeacherNotification["delivery"] : "UNKNOWN";
    const directive = plain(candidate.directive) ? candidate.directive : null;
    const verdicts = rows(directive?.verdicts).filter((item) => plain(item) && actionOf(item.action) !== null && text(item.student, LIMITS.name) !== "") as Record<string, unknown>[];
    const item = text(directive?.item, LIMITS.meta);
    const target = text(peer?.displayName, LIMITS.name) || text(peer?.classId, LIMITS.meta) || "已配对教室";
    const single = verdicts.length === 1 ? verdicts[0] : null;
    const failed = verdicts.filter((entry) => entry.action === "fail" || entry.action === "retry").length;
    result.push({
      messageId,
      name: single ? text(single.student, LIMITS.name) : verdicts.length > 1 ? `${verdicts.length} 位学生` : "教室通知",
      meta: [single ? (single.action === "call" ? "喊人" : "学生处置") : verdicts.length > 1 ? "名册" : "通知", item].filter(Boolean).join(" · ").slice(0, LIMITS.meta),
      note: single ? text(single.note, LIMITS.note) || text(candidate.body, LIMITS.note)
        : verdicts.length > 1 ? `共 ${verdicts.length} 人${failed ? `，${failed} 人不过关或需补做` : ""}；点开查看逐人交代。`
          : text(candidate.body, LIMITS.note),
      target,
      delivery,
      createdAt: text(candidate.createdAt, LIMITS.at),
      active,
    });
  }
  return result.sort((left, right) => timeKey(right.createdAt).localeCompare(timeKey(left.createdAt)));
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
  const detail = [place, item.topic].filter(Boolean).join(" · ");
  const response = item.response;
  const pending = item.active && response?.delivery !== "ACKNOWLEDGED" && response?.delivery !== "RECEIPT_SEEN";
  const responseLabel = response === null ? ""
    : response.delivery === "RECEIPT_SEEN" ? "教室已看到回复；学生本人是否查看：尚未确认"
    : response.delivery === "ACKNOWLEDGED" ? "教室已收件；学生是否查看：尚未确认"
      : response.delivery === "PENDING" ? "教师回复正在投递"
        : response.delivery === "UNKNOWN" ? "教师回复投递状态不明"
          : "教师回复尚未送出";
  const teacherSlot = response === null ? ""
    : response.decision === "replied" ? `教师回复：${response.body || "未填写"}`
      : response.decision === "confirmed" ? `教师确认时间：${response.slot || "未填写"}`
        : `教师建议改期：${response.slot || "未填写"}`;
  const context = [
    item.classId ? `班级：${item.classId}` : "",
    item.active ? "" : "身份或配对已变化 · 仅可查看历史",
    item.slot ? `学生希望：${item.slot}` : item.kind === "appointment" ? "学生未填写预约时间" : "",
    teacherSlot,
    responseLabel,
  ].filter(Boolean).join(" · ");
  const badge = !item.active ? "历史记录" : response === null
    ? (item.seenAt === "" ? "待查看" : "待回复")
    : response.delivery === "RECEIPT_SEEN" ? "教室已看到"
    : response.delivery === "ACKNOWLEDGED" ? (response.decision === "replied" ? "已回复" : response.decision === "confirmed" ? "已确认" : "已改期")
      : response.delivery === "PENDING" ? "回复中"
        : response.delivery === "UNKNOWN" ? "投递未知" : "未送出";
  return {
    id: item.messageId,
    seq: index + 1,
    name: item.student,
    meta: [label, detail].filter(Boolean).join(" · ").slice(0, LIMITS.meta),
    // 学生自己写的原话原样上板：那是这一条预约里最个性化的部分，不该被任何模板改写。
    note: item.body,
    context,
    badge,
    actionRequired: pending,
    tone: !item.active ? "neutral" : pending ? (response?.delivery === "NOT_SENT" ? "bad" : "attention") : "ok",
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
  call: "小纸条",
  pass: "过关",
  fail: "不过关",
  retry: "需补做",
});
const OVERFLOW_BADGE = "查看完整名单";
/** 弹窗正文和标题有固定空间；超出边界时只给预览并引导打开完整请求。 */
const REQUEST_POPUP_FULL_BODY_LIMIT = 75;
const REQUEST_POPUP_SUBJECT_LIMIT = 36;
const REQUEST_POPUP_DETAIL_LIMIT = 80;
const REQUEST_POPUP_PREVIEW_LIMIT = 32;

interface RequestAttentionEntry {
  key: string;
  row: RailRow;
}

interface AttentionSnapshot extends RailSnapshot {
  /** 仅供主进程比较；rail.apply 会把它从窗口快照中剔除。 */
  requestAttentionEntries?: RequestAttentionEntry[];
}

function requestAttentionEntries(snapshot: RailSnapshot): readonly RequestAttentionEntry[] {
  return (snapshot as AttentionSnapshot).requestAttentionEntries ?? [];
}

/** 去重签名也观察被 50 行上限隐藏的预约 ID，仍不因轮询时间变化而重绘。 */
export function railSnapshotSignature(snapshot: RailSnapshot): string {
  const visible = snapshot.rows
    .map((row) => [row.id, row.seq, row.name, row.meta, row.context, row.note, row.badge, row.tone, row.actionRequired, row.popupDetail, row.popupComplete].join("\u0000"))
    .join("\u0001");
  const display = [snapshot.surface, snapshot.heading, snapshot.detail, visible].join("\u0002");
  return snapshot.surface === "teacher-rail"
    ? `${display}\u0003${requestAttentionEntries(snapshot).map((item) => item.key).join("\u0000")}`
    : display;
}

function directiveRow(item: TeacherDirective, index: number): RailRow {
  const badge = item.source === "plain" ? "通知" : DIRECTIVE_LABELS[item.action];
  const fullDetail = item.source === "plain" ? `教师原话：${item.body}` : [
    item.item ? `事项：${item.item}` : "",
    `结果：${badge}`,
    item.note ? `交代：${item.note}` : "",
    item.body ? `教师原话：${item.body}` : "",
  ].filter(Boolean).join(" · ");
  const popupComplete = item.popupComplete && fullDetail.length <= LIMITS.note;
  return {
    id: item.messageId,
    seq: index + 1,
    name: item.student === "" ? "全班" : item.student,
    // 名目在上、个性化交代在下：学生扫一眼就同时看到「哪件事」和「我该做什么」。
    meta: item.item,
    note: item.note,
    badge,
    popupDetail: popupComplete ? fullDetail : `${fullDetail.slice(0, 170)}${fullDetail.length > 170 ? "…" : ""}`,
    popupComplete,
    tone: DIRECTIVE_TONES[item.action],
    at: item.receivedAt,
  };
}

function notificationRow(item: TeacherNotification, index: number): RailRow {
  const badge = !item.active ? "历史通知" : item.delivery === "RECEIPT_SEEN" ? "教室已看到"
    : item.delivery === "ACKNOWLEDGED" ? "教室已收件"
      : item.delivery === "PENDING" ? "投递中"
        : item.delivery === "NOT_SENT" ? "未送出" : "投递未知";
  const needsCheck = item.active && (item.delivery === "UNKNOWN" || item.delivery === "NOT_SENT");
  return {
    id: item.messageId,
    seq: index + 1,
    name: item.name,
    meta: item.meta,
    note: item.note,
    context: !item.active ? `发往 ${item.target} · 身份或配对已变化，仅可查看历史` : `发往 ${item.target} · ${badge}`,
    badge,
    actionRequired: needsCheck,
    // 发送记录不触发“新学生预约”弹窗；需要检查的记录仍在角标中计数。
    tone: needsCheck ? "bad" : "neutral",
    at: item.createdAt,
  };
}

/** 教师端常驻条：学生请求待办。标题带未处理数，老师一眼知道要不要处理。 */
export function teacherRailSnapshot(lan: unknown, now: string): AttentionSnapshot {
  const settled = (item: StudentRequest) => !item.active || item.response?.delivery === "ACKNOWLEDGED" || item.response?.delivery === "RECEIPT_SEEN";
  const requests = orderPendingFirst(readStudentRequests(lan), (item) => !settled(item));
  const pending = requests.filter((item) => !settled(item)).length;
  const notifications = readTeacherNotifications(lan);
  const needsCheck = (item: TeacherNotification) => item.active && (item.delivery === "UNKNOWN" || item.delivery === "NOT_SENT");
  const urgentNotifications = notifications.filter(needsCheck);
  const deliveryToCheck = urgentNotifications.length;
  const pendingRequests = requests.filter((item) => !settled(item));
  // 两类待办各保留可见行；若总量越过上限，再为被截断的类别留直达原记录的入口。
  let summarySlots = 0;
  let shownPending: StudentRequest[] = [];
  let shownUrgent: TeacherNotification[] = [];
  while (true) {
    const budget = RAIL_ROW_LIMIT - summarySlots;
    shownPending = pendingRequests.slice(0, urgentNotifications.length ? budget - 1 : budget);
    shownUrgent = urgentNotifications.slice(0, budget - shownPending.length);
    const needed = Number(shownPending.length < pendingRequests.length) + Number(shownUrgent.length < urgentNotifications.length);
    if (needed <= summarySlots) break;
    summarySlots = needed;
  }
  const hiddenPending = pendingRequests.slice(shownPending.length);
  const hiddenUrgent = urgentNotifications.slice(shownUrgent.length);
  const overflowRows: RailRow[] = [
    ...(hiddenPending.length ? [{
      id: hiddenPending[0].messageId, seq: 0, name: `另有 ${hiddenPending.length} 条学生请求`,
      meta: "学生请求", note: "点击打开原请求，查看完整待办", badge: "查看其余请求",
      actionRequired: false, tone: "neutral" as const, at: hiddenPending[0].receivedAt,
    }] : []),
    ...(hiddenUrgent.length ? [{
      id: hiddenUrgent[0].messageId, seq: 0, name: `另有 ${hiddenUrgent.length} 条待核对通知`,
      meta: "教师通知", note: "点击打开发件记录，查看完整待办", badge: "查看其余通知",
      actionRequired: false, tone: "neutral" as const, at: hiddenUrgent[0].createdAt,
    }] : []),
  ];
  const prioritized = [
    ...shownPending.map((item) => requestRow(item, 0)),
    ...shownUrgent.map((item) => notificationRow(item, 0)),
    ...overflowRows,
  ];
  return {
    surface: "teacher-rail",
    actionRequiredCount: pending + deliveryToCheck,
    heading: pending > 0 && deliveryToCheck > 0 ? `待办 · ${pending} 请求 + ${deliveryToCheck} 通知`
      : pending > 0 ? `待办 · ${pending} 位学生`
        : deliveryToCheck > 0 ? `待办 · ${deliveryToCheck} 条通知待核对` : "待办 · 暂无",
    detail: pending + deliveryToCheck > 0 ? "待处理事项"
      : requests.length + notifications.length > 0 ? "当前待办已清空" : "没有学生请求",
    updatedAt: text(now, LIMITS.at),
    rows: prioritized.slice(0, RAIL_ROW_LIMIT).map((row, index) => ({ ...row, seq: index + 1 })),
    // 所有实际收件 ID 都参加差集；旧身份、已处理和仅因通知挤出屏幕的旧请求
    // 不会被误认为新请求。公钥指纹让两个已配对教室的同名消息仍是不同来源。
    requestAttentionEntries: requests.map((item) => ({
      key: `${item.fromFingerprint}\u0000${item.messageId}`,
      row: requestRow(item, 0),
    })),
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
  const overflow = directives.length > RAIL_ROW_LIMIT ? directives.length - RAIL_ROW_LIMIT + 1 : 0;
  const visible = directives.slice(0, overflow ? RAIL_ROW_LIMIT - 1 : RAIL_ROW_LIMIT).map(directiveRow);
  if (overflow) {
    const firstHidden = directives[RAIL_ROW_LIMIT - 1];
    visible.push({
      // 同一批听写的行 ID 带 verdict 下标；点击时主页面按原消息 ID 定位完整名册。
      id: firstHidden.messageId,
      seq: RAIL_ROW_LIMIT,
      name: `另有 ${overflow} 条结果`,
      meta: "教室收件箱",
      note: "点击查看完整名单及逐人交代",
      badge: OVERFLOW_BADGE,
      tone: "neutral",
      at: firstHidden.receivedAt,
    });
  }
  return {
    surface: "classroom-board",
    totalRowCount: directives.length,
    heading: open === 0 ? "板上无事" : `待办 · ${open} 条`,
    detail: directives.length === 0 ? "暂无待处理通知" : overflow ? `共 ${directives.length} 条 · 其余 ${overflow} 条点开查看` : `共 ${directives.length} 条`,
    updatedAt: text(now, LIMITS.at),
    rows: visible,
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
  const previousRequests = (previous as AttentionSnapshot).requestAttentionEntries;
  const nextRequests = (next as AttentionSnapshot).requestAttentionEntries;
  if (surface === "teacher-rail" && previousRequests && nextRequests) {
    const knownRequests = new Set(previousRequests.map((item) => item.key));
    const added = nextRequests.filter((item) => item.row.tone === "attention" && !knownRequests.has(item.key));
    if (added.length === 0) return [];
    const visible = new Set(next.rows.filter((row) => row.tone === "attention").map((row) => row.id));
    const hasHidden = added.some((item) => !visible.has(item.row.id));
    const first = added[0].row;
    const canReadInPopup = !hasHidden && first.note.length > 0
      && first.note.length <= REQUEST_POPUP_FULL_BODY_LIMIT
      && first.name.length <= REQUEST_POPUP_SUBJECT_LIMIT
      && `学生原话：${first.note}`.length <= REQUEST_POPUP_DETAIL_LIMIT;
    // 直签模式的主体就是学生原话；meta/context 已在常驻条可见，塞进弹窗会挤掉正文。
    // 预览模式统一给短正文和完整请求入口，避免长姓名或长上下文挤压按钮区域。
    const subject = hasHidden ? "新增 1 条学生请求"
      : first.name.length <= REQUEST_POPUP_SUBJECT_LIMIT ? first.name
        : `${first.name.slice(0, REQUEST_POPUP_SUBJECT_LIMIT - 1)}…`;
    const detail = hasHidden
      ? `点开查看完整请求 · ${first.name}`.slice(0, REQUEST_POPUP_DETAIL_LIMIT)
      : canReadInPopup
      ? `学生原话：${first.note}`
      : [
        first.note ? `学生原话：${first.note.slice(0, REQUEST_POPUP_PREVIEW_LIMIT)}${first.note.length > REQUEST_POPUP_PREVIEW_LIMIT ? "…" : ""}` : "",
        "打开 Mochi 查看完整请求",
      ].filter(Boolean).join(" · ").slice(0, REQUEST_POPUP_DETAIL_LIMIT);
    if (added.length === 1) {
      return [{
        id: first.id,
        kind: "request",
        title: "叮咚，Mochi 来送信啦～",
        subject,
        detail,
        ...(canReadInPopup && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(first.id)
          ? { receiptMessageId: first.id } : {}),
        at: first.at,
      }];
    }
    return [{
      id: `${first.id}#${added.length}`,
      kind: "request",
      title: "叮咚，Mochi 来送信啦～",
      subject: `${added.length} 位同学 · 新请求`,
      detail: (hasHidden ? "点开查看完整请求 · " : "")
        + added.slice(0, 3).map((item) => {
          const classLabel = item.row.context?.match(/班级：[^ ·]+/u)?.[0];
          return classLabel ? `${item.row.name}（${classLabel}）` : item.row.name;
        }).join("、")
        + (added.length > 3 ? " 等" : ""),
      at: first.at,
    }];
  }
  const known = new Set(previous.rows.map((row) => row.id));
  const overflow = surface === "classroom-board" ? next.rows.find((row) => row.badge === OVERFLOW_BADGE) : undefined;
  const previousOverflow = surface === "classroom-board" ? previous.rows.find((row) => row.badge === OVERFLOW_BADGE) : undefined;
  // 已过关/已看到这类「好消息」不打断注意力，只留一个例外：教室端出现的「过关」
  // 是学生等着看的结果，值得弹一次——所以按 surface 决定哪些 tone 值得弹。
  const worthAttention = next.rows.filter((row) => {
    if (known.has(row.id)) return false;
    if (surface === "teacher-rail") return row.tone === "attention";
    return row.tone !== "neutral";
  });
  if (worthAttention.length === 0) {
    if (!overflow || (overflow.id === previousOverflow?.id && overflow.name === previousOverflow.name)) return [];
    // 新结果全落在第 50 行之后时，可见逐人行不变；溢出数变化仍要提醒教室。
    return [{
      id: `more:${overflow.id.slice(0, 120)}:${overflow.name}`,
      kind: "call",
      title: "教师名单已更新",
      subject: overflow.name,
      detail: overflow.note,
      at: overflow.at,
    }];
  }

  const first = worthAttention[0];
  const surfaceKind = surface === "teacher-rail" ? "request" : "call";
  const classroomTitle: Record<string, string> = {
    "小纸条": "叮咚，Mochi 来送信啦～", "不过关": "未过关提醒", "需补做": "补做提醒", "过关": "已过关", "通知": "叮咚，Mochi 来送信啦～",
  };
  const surfaceTitle = surface === "teacher-rail" ? "叮咚，Mochi 来送信啦～"
    : worthAttention.length === 1 ? (classroomTitle[first.badge] || "教师处置已更新") : "教师处置已更新";
  const surfaceSubject = surface === "teacher-rail" ? "新请求" : "新任务";
  // 弹窗只有一行位置，两块屏该放的东西不一样：
  //   教师端 —— 放结构化摘要（类型 · 主题 · 时间），老师按类型扫；
  //   教室端 —— 放那位学生的个性化交代，那才是他弹窗后要照着做的事。
  const detail = surface === "teacher-rail"
    ? [first.meta, first.context].filter(Boolean).join(" · ") || first.note
    : first.popupComplete ? (first.popupDetail || "")
      : `${(first.popupDetail || first.note || first.meta).slice(0, 170)} · 点开查看完整消息`;
  if (worthAttention.length === 1) {
    return [{
      id: first.id,
      kind: surfaceKind,
      title: surfaceTitle,
      subject: surface === "classroom-board" && first.badge !== "通知" ? `${first.name} · ${first.badge}` : first.name,
      detail,
      ...(surface === "classroom-board" && first.popupComplete && first.popupDetail
        && `${first.name} · ${first.badge}`.length <= LIMITS.name
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(first.id)
        ? { receiptMessageId: first.id } : {}),
      at: first.at,
    }];
  }
  return [{
    // 聚合后的 id 必须能代表「这一批」：用首行 id + 条数，避免与单行 id 撞车，
    // 也避免同一批在冷却期外被重复弹。
    id: `${first.id}#${worthAttention.length}`,
    kind: surfaceKind,
    title: surfaceTitle,
    subject: overflow
      ? `多位同学 · ${surfaceSubject}` : `${worthAttention.length} 位同学 · ${surfaceSubject}`,
    detail: worthAttention.slice(0, 3).map((row) => {
      if (surface !== "teacher-rail") return row.name;
      const classLabel = row.context?.match(/班级：[^ ·]+/u)?.[0];
      return classLabel ? `${row.name}（${classLabel}）` : row.name;
    }).join("、")
      + (overflow
        ? " 等，完整名单请点开查看" : worthAttention.length > 3 ? " 等" : ""),
    at: first.at,
  }];
}
