#!/usr/bin/env node
/**
 * 常驻条数据派生层测试。
 *
 * 为什么单列一个文件：rail-model 不依赖 Electron，所以它可以脱离图形环境跑。
 * 这里压的是「不可信输入」这一面——真实世界里这批数据来自局域网 HTTP 响应，
 * 任一字段都可能缺、可能是别的类型、可能带控制字符。派生层的承诺是：
 * 坏行丢掉、好行照常显示、任何情况下都不把一块屏搞成空白或错内容。
 */
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = dirname(scriptDir);
const model = await import(join(desktopRoot, "dist-electron", "dsh", "rail-model.js"));

const {
  RAIL_ROW_LIMIT,
  readStudentRequests,
  readTeacherDirectives,
  readTeacherNotifications,
  teacherRailSnapshot,
  classroomRailSnapshot,
  newAttentionPayloads,
  railSnapshotSignature,
} = model;

let checks = 0;
function ok(label, condition) {
  checks += 1;
  assert.ok(condition, label);
}
function equal(label, actual, expected) {
  checks += 1;
  assert.deepEqual(actual, expected, label);
}

const NOW = "2026-09-18T13:00:00.000Z";

function classroomInbox(entries, outbox = []) {
  const teacher = { endpointId: "teacher-1", role: "teacher", schoolId: "jxl", displayName: "王老师", fingerprint: "sha256:teacher-1" };
  const classroom = { endpointId: "classroom-1", role: "classroom", schoolId: "jxl", classId: "g1-3", displayName: "高一3班教室端", fingerprint: "sha256:classroom-1" };
  return {
    identity: teacher,
    peers: [...new Map(entries.map((entry) => entry.from ?? classroom).map((peer) => [peer.endpointId, peer])).values()],
    inbox: entries.map((entry) => ({
      messageId: entry.messageId,
      from: entry.from ?? classroom,
      recipient: teacher,
      body: entry.body ?? "",
      ...(entry.request === undefined ? {} : { request: entry.request }),
      receivedAt: entry.receivedAt,
      ...(entry.seenAt === undefined ? {} : { seenAt: entry.seenAt }),
    })),
    outbox,
  };
}

const classroomIdentity = { endpointId: "classroom-1", role: "classroom", schoolId: "jxl", classId: "g1-3", displayName: "高一3班教室端", fingerprint: "sha256:classroom-1" };
const teacherIdentity = { endpointId: "teacher-1", role: "teacher", schoolId: "jxl", displayName: "王老师", fingerprint: "sha256:teacher-1" };

function activeClassroomLan(lan) {
  return {
    ...lan,
    identity: lan.identity ?? classroomIdentity,
    peers: lan.peers ?? [teacherIdentity],
    inbox: Array.isArray(lan.inbox) ? lan.inbox.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      return {
        ...entry,
        from: { ...teacherIdentity, ...entry.from },
        ...("recipient" in entry ? {} : { recipient: classroomIdentity }),
      };
    }) : lan.inbox,
  };
}

/* ───────────────── 1. 学生预约：读得出来，且不认错发件人 ───────────────── */

{
  const lan = classroomInbox([
    { messageId: "m1", request: { student: "李明", seat: 3, kind: "appointment", topic: "二次函数", slot: "第八节晚自习" }, body: "第 3 题不太懂", receivedAt: "2026-09-18T10:00:00.000Z" },
    { messageId: "m2", request: { student: "赵敏", seat: 1, kind: "question", topic: "完形填空", slot: "课后" }, body: "想问两道题", receivedAt: "2026-09-18T09:00:00.000Z" },
  ]);
  const read = readStudentRequests(lan);
  equal("读到两条预约", read.length, 2);
  equal("学生姓名取结构体字段", read[0].student, "李明");
  equal("座号解析为整数", read[0].seat, 3);
  equal("预约类型保留", read[1].kind, "question");
}

{
  const classThree = { ...classroomIdentity, endpointId: "classroom-3", classId: "g1-3", displayName: "高一3班教室端", fingerprint: "sha256:classroom-3" };
  const classFour = { ...classroomIdentity, endpointId: "classroom-4", classId: "g1-4", displayName: "高一4班教室端", fingerprint: "sha256:classroom-4" };
  const lan = classroomInbox([
    { messageId: "same-name-3", from: classThree, request: { student: "李明", kind: "appointment", topic: "二次函数" }, receivedAt: NOW },
    { messageId: "same-name-4", from: classFour, request: { student: "李明", kind: "appointment", topic: "二次函数" }, receivedAt: NOW },
  ]);
  const read = readStudentRequests(lan);
  equal("签名发件身份保留班级", read.map((item) => item.classId), ["g1-3", "g1-4"]);
  equal("签名发件身份保留展示名", read.map((item) => item.senderDisplayName), ["高一3班教室端", "高一4班教室端"]);
  const snapshot = teacherRailSnapshot(lan, NOW);
  ok("同名学生快览清楚区分班级", snapshot.rows.some((row) => row.context.includes("班级：g1-3")) && snapshot.rows.some((row) => row.context.includes("班级：g1-4")));
  const popups = newAttentionPayloads("teacher-rail", teacherRailSnapshot(classroomInbox([]), NOW), snapshot);
  equal("同名学生预约仍合并为一个弹窗", popups.length, 1);
  ok("弹窗可见两班身份", popups[0].detail.includes("班级：g1-3") && popups[0].detail.includes("班级：g1-4"));
  ok("弹窗列出两个同名预约", popups[0].detail.includes("李明（班级：g1-3）") && popups[0].detail.includes("李明（班级：g1-4）"));
}

{
  // 「哪份作业的哪道题」必须能拼成一句老师照着翻页的摘要。这两段以前不存在，
  // 学生只能把题目位置塞进正文，待办条上就只剩截断的自由文本。
  const lan = classroomInbox([
    {
      messageId: "loc1",
      request: { student: "李明", seat: 3, kind: "appointment", material: "步步高 Unit 5", position: "完形填空第 7 空", slot: "第八节晚自习" },
      body: "这两个空总是错",
      receivedAt: NOW,
    },
  ]);
  const read = readStudentRequests(lan)[0];
  equal("作业材料读到", read.material, "步步高 Unit 5");
  equal("题目位置读到", read.position, "完形填空第 7 空");
  const row = teacherRailSnapshot(lan, NOW).rows[0];
  equal("类型与题目位置拼进 meta", row.meta, "预约讲题 · 步步高 Unit 5 完形填空第 7 空");
  ok("学生希望时间有明确标签", row.context.includes("学生希望：第八节晚自习"));
  // 学生原话是这条预约里最个性化的部分，原样上板。
  equal("学生原话不被改写", row.note, "这两个空总是错");
  // 只填了作业、没填题号时，「要讲」那段只剩作业名，不留多余分隔符。
  const materialOnly = teacherRailSnapshot(classroomInbox([
    { messageId: "loc2", request: { student: "李明", kind: "appointment", material: "昨天的卷子" }, body: "想问", receivedAt: NOW },
  ]), NOW).rows[0];
  equal("只有作业名也能拼", materialOnly.meta, "预约讲题 · 昨天的卷子");
  // 两个位置都没填时，显示退回改造之前的样子——旧预约的观感不能被这次改动破坏。
  const legacy = teacherRailSnapshot(classroomInbox([
    { messageId: "loc3", request: { student: "李明", kind: "appointment", topic: "二次函数", slot: "第八节晚自习" }, body: "第 3 题", receivedAt: NOW },
  ]), NOW).rows[0];
  equal("缺位置时保留主题", legacy.meta, "预约讲题 · 二次函数");
  ok("学生预约时间独立于主题显示", legacy.context.includes("学生希望：第八节晚自习"));
}

{
  // 教师端可能同时配对多个教室设备；学生身份在 request.student。没有 request 的
  // 收件是普通通知，不能当成预约混进待办表。
  const lan = classroomInbox([{ messageId: "m1", body: "明天带课本", receivedAt: NOW }]);
  equal("缺 request 的收件不进预约表", readStudentRequests(lan).length, 0);
}

{
  const current = classroomInbox([{ messageId: "old-request", request: { student: "李明", kind: "appointment", slot: "周五课后" }, body: "第三题", receivedAt: NOW }]);
  const changed = { ...current, identity: { ...current.identity, fingerprint: "sha256:new-teacher" } };
  const unpaired = { ...current, peers: [] };
  for (const lan of [changed, unpaired]) {
    equal("身份或配对变化后预约成为历史", readStudentRequests(lan)[0].active, false);
    const snapshot = teacherRailSnapshot(lan, NOW);
    equal("历史预约不计入待办数", snapshot.heading, "待办 · 暂无");
    equal("历史预约不堆积在当前待办", snapshot.rows.length, 0);
  }
}

{
  // 发件人是教师（教师端收到同僚的通知）时绝不算学生预约。
  const lan = {
    inbox: [{
      messageId: "m1",
      from: { endpointId: "teacher-2", role: "teacher", schoolId: "jxl", displayName: "李老师" },
      body: "教研通知",
      request: { student: "李明", kind: "appointment" },
      receivedAt: NOW,
    }],
  };
  equal("教师发件人不算学生预约", readStudentRequests(lan).length, 0);
}

{
  // 学生姓名是展示键，缺了就无处可显示。丢这一行，保留其余。
  const lan = classroomInbox([
    { messageId: "bad", request: { seat: 2, kind: "appointment", topic: "无名字" }, receivedAt: NOW },
    { messageId: "good", request: { student: "王强", kind: "appointment" }, receivedAt: NOW },
  ]);
  const read = readStudentRequests(lan);
  equal("缺姓名的行被丢弃", read.length, 1);
  equal("其余行照常读出", read[0].student, "王强");
}

{
  const lan = classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "从未见过的类型" }, receivedAt: NOW },
  ]);
  equal("未知预约类型归到 other 而不是丢行", readStudentRequests(lan)[0].kind, "other");
}

/* ───────────────── 2. 教师处置：读得出过关/不过关 ───────────────── */

{
  const reply = {
    inbox: [{
      messageId: "appointment-reply", contentType: "NOTIFY",
      from: { role: "teacher", endpointId: "teacher-1" },
      body: "老师已确认预约时间。",
      response: { replyToMessageId: "appointment-1", decision: "confirmed", slot: "周五课后" },
      receivedAt: NOW,
    }],
  };
  equal("预约回复不变成全班喊人", readTeacherDirectives(activeClassroomLan(reply)).length, 0);
  equal("预约回复不进入教室公开常驻板", classroomRailSnapshot(activeClassroomLan(reply), NOW).rows.length, 0);
  equal("预约回复不触发老师叫人弹窗", newAttentionPayloads("classroom-board", classroomRailSnapshot({ inbox: [] }, NOW), classroomRailSnapshot(activeClassroomLan(reply), NOW)).length, 0);
}

{
  const current = activeClassroomLan({ inbox: [{
    messageId: "current-roster", from: teacherIdentity, body: "本班听写结果",
    directive: { item: "听写", verdicts: [{ student: "李明", action: "fail" }] }, receivedAt: NOW,
  }] });
  equal("原教师仍配对且收件目标是本班时上板", readTeacherDirectives(current).length, 1);
  const historical = [
    { ...current, identity: { ...classroomIdentity, classId: "g1-4" } },
    { ...current, identity: { ...classroomIdentity, fingerprint: "sha256:new-classroom" } },
    { ...current, peers: [] },
    { ...current, peers: [{ ...teacherIdentity, fingerprint: "sha256:new-teacher" }] },
    { ...current, peers: [{ ...teacherIdentity, blocked: true }] },
    { ...current, inbox: [{ ...current.inbox[0], recipient: undefined }] },
  ];
  for (const lan of historical) {
    equal("旧班、旧密钥、解除配对或缺目标身份的名单不上公开板", readTeacherDirectives(lan).length, 0);
    const board = classroomRailSnapshot(lan, NOW);
    equal("历史名单不占当前教室板", board.rows.length, 0);
    equal("历史名单不触发教室弹窗", newAttentionPayloads("classroom-board", classroomRailSnapshot({ inbox: [] }, NOW), board).length, 0);
  }
  const mixed = { ...current, inbox: [current.inbox[0], { ...current.inbox[0], messageId: "old-roster", recipient: { ...classroomIdentity, classId: "g1-4" } }] };
  equal("新旧通知混合时只公开本班", classroomRailSnapshot(mixed, NOW).rows.map((row) => row.id), ["current-roster"]);
}

{
  const roomIdentity = { endpointId: "room-1", role: "classroom", schoolId: "jxl", classId: "g1-3", displayName: "高一 3 班", fingerprint: "sha256:room-1" };
  const outbox = [{
    messageId: "sent-call", contentType: "NOTIFY", targetEndpointId: "room-1",
    sender: teacherIdentity, peer: roomIdentity,
    body: "请李明查看老师的通知。",
    directive: { item: "老师叫号", verdicts: [{ student: "李明", action: "call", note: "请于课间到办公室；带听写本。" }] },
    delivery: "ACKNOWLEDGED", createdAt: NOW,
  }, {
    messageId: "sent-dictation", contentType: "NOTIFY", targetEndpointId: "room-1",
    sender: teacherIdentity, peer: roomIdentity,
    body: "第 5 单元听写结果",
    directive: { item: "第 5 单元听写", verdicts: [
      { student: "赵敏", action: "pass", note: "全对。" },
      { student: "王强", action: "fail", note: "课间来重听。" },
    ] },
    delivery: "UNKNOWN", createdAt: "2026-09-18T12:59:00.000Z",
  }];
  const lan = { identity: teacherIdentity, peers: [roomIdentity], inbox: [], outbox, receipts: [{ messageId: "sent-call", from: roomIdentity }] };
  const notifications = readTeacherNotifications(lan);
  equal("两份出站通知按消息汇总", notifications.length, 2);
  equal("单人喊话显示真实时间地点", notifications[0].note, "请于课间到办公室；带听写本。");
  equal("签名目标的人工回执才算看到", notifications[0].delivery, "RECEIPT_SEEN");
  equal("整班名册不在桌宠拆成多行", notifications[1].name, "2 位学生");
  const snapshot = teacherRailSnapshot(lan, NOW);
  equal("已确认通知退出当前待办", snapshot.rows.map((row) => row.id), ["sent-dictation"]);
  equal("投递未知会进入桌宠角标", snapshot.rows[0].actionRequired, true);
  equal("发送记录不冒充新学生预约弹窗", newAttentionPayloads("teacher-rail", teacherRailSnapshot({ inbox: [] }, NOW), snapshot).length, 0);
  const spoofed = readTeacherNotifications({ outbox: [outbox[0]], receipts: [{ messageId: "sent-call", from: { fingerprint: "sha256:other" } }] });
  equal("别的设备回执不能标记当前教室已看到", spoofed[0].delivery, "ACKNOWLEDGED");
  equal("预约回复不混进通知记录", readTeacherNotifications({ outbox: [{ ...outbox[0], response: { decision: "confirmed" } }] }).length, 0);

  for (const historical of [
    { ...lan, identity: { ...teacherIdentity, fingerprint: "sha256:new-teacher" } },
    { ...lan, peers: [] },
    { ...lan, peers: [{ ...roomIdentity, fingerprint: "sha256:new-classroom" }] },
    { ...lan, peers: [{ ...roomIdentity, blocked: true }] },
    { ...lan, outbox: [{ ...outbox[1], sender: undefined }] },
  ]) {
    const old = readTeacherNotifications(historical).find((item) => item.messageId === "sent-dictation");
    equal("旧发件身份或旧配对只能作为历史", old.active, false);
    const oldSnapshot = teacherRailSnapshot(historical, NOW);
    equal("历史 NOT_SENT 或 UNKNOWN 不算当前待核对", oldSnapshot.heading, "待办 · 暂无");
    equal("历史发送记录不堆积在当前待办", oldSnapshot.rows.length, 0);
  }
}

{
  const requests = Array.from({ length: 50 }, (_, index) => ({
    messageId: `done-${index}`, request: { student: `学生${index}`, kind: "appointment", slot: "课后" },
    receivedAt: `2026-09-18T10:00:${String(index).padStart(2, "0")}.000Z`, seenAt: NOW,
  }));
  const base = classroomInbox(requests);
  const responses = requests.map((item) => ({
    messageId: `reply-${item.messageId}`, contentType: "NOTIFY", targetEndpointId: "classroom-1",
    peer: base.peers[0], sender: base.identity, response: { replyToMessageId: item.messageId, decision: "confirmed", slot: "课后" },
    delivery: "ACKNOWLEDGED", createdAt: NOW,
  }));
  const urgent = {
    messageId: "notice-not-sent", contentType: "NOTIFY", targetEndpointId: "classroom-1",
    peer: base.peers[0], sender: base.identity, body: "请到办公室",
    directive: { item: "叫人", verdicts: [{ student: "李明", action: "call" }] },
    delivery: "NOT_SENT", createdAt: NOW,
  };
  const snapshot = teacherRailSnapshot({ ...base, outbox: [...responses, urgent] }, NOW);
  equal("50 条已结预约不能遮住待核对通知", snapshot.rows[0].id, "notice-not-sent");
  equal("50条已结预约移出待办", snapshot.rows.length, 1);
  equal("待核对通知进入角标计数", snapshot.rows.filter((row) => row.actionRequired).length, 1);
  equal("未送出总数显示在标题", snapshot.heading, "待办 · 1 条通知待核对");

  const crowded = teacherRailSnapshot({ ...base, outbox: [urgent] }, NOW);
  equal("50 条未处理预约也为通知留入口", crowded.rows.at(-2).id, "notice-not-sent");
  equal("学生请求和通知两类待办同时显示", crowded.heading, "待办 · 50 请求 + 1 通知");
  equal("真实待处理总数不受可见行上限影响", crowded.actionRequiredCount, 51);
  equal("可见行角标保持待办状态", crowded.rows.filter((row) => row.actionRequired).length, 49);
  equal("少显示的两条请求有明确入口", crowded.rows.at(-1).name, "另有 2 条学生请求");
  equal("预约入口指向第一条原消息", crowded.rows.at(-1).id, "done-48");
  equal("请求入口提示可以查看完整待办", crowded.rows.at(-1).badge, "查看其余请求");
  equal("教师通知不冒充新增预约弹窗", newAttentionPayloads("teacher-rail", teacherRailSnapshot(base, NOW), crowded).length, 0);

  const secondUrgent = { ...urgent, messageId: "notice-2", createdAt: "2026-09-18T12:59:00.000Z" };
  const bothOverflow = teacherRailSnapshot({ ...base, inbox: base.inbox.slice(0, 49), outbox: [urgent, secondUrgent] }, NOW);
  const requestMore = bothOverflow.rows.find((row) => row.badge === "查看其余请求");
  const notificationMore = bothOverflow.rows.find((row) => row.badge === "查看其余通知");
  equal("预约和通知同时溢出时各有入口", [requestMore?.id, notificationMore?.id], ["done-47", "notice-2"]);
  equal("两类待办各有真实行可供角标计算", bothOverflow.rows.filter((row) => row.actionRequired).length, 48);
  equal("教师行数仍遵守 50 上限", bothOverflow.rows.length, RAIL_ROW_LIMIT);
}

{
  const lan = {
    inbox: [
      {
        messageId: "d1",
        from: { endpointId: "teacher-1", role: "teacher", schoolId: "jxl", displayName: "王老师" },
        body: "第 5 单元听写结果",
        directive: { item: "第 5 单元听写", verdicts: [
          { student: "李明", seat: 3, action: "fail" },
          { student: "赵敏", seat: 1, action: "pass" },
        ] },
        receivedAt: "2026-09-18T11:00:00.000Z",
      },
    ],
  };
  const read = readTeacherDirectives(activeClassroomLan(lan));
  equal("一条消息展开成两行", read.length, 2);
  equal("fail 动作保留", read[0].action, "fail");
  equal("pass 动作保留", read[1].action, "pass");
  equal("名目取自 directive.item", read[0].item, "第 5 单元听写");
  equal("展开后行 id 互不相同", read[0].messageId !== read[1].messageId, true);
  equal("单个 verdict 时行 id 就是 messageId", readTeacherDirectives(activeClassroomLan({
    inbox: [{ messageId: "solo", from: { role: "teacher" }, body: "x", directive: { verdicts: [{ student: "李明", action: "call" }] }, receivedAt: NOW }],
  }))[0].messageId, "solo");
}

{
  // 缺 action / 缺 student 的 verdict 丢掉，但不影响同一条消息里的其他 verdict。
  const lan = {
    inbox: [{
      messageId: "d1",
      from: { role: "teacher" },
      body: "混合结果",
      directive: { item: "听写", verdicts: [
        { student: "李明" },
        { action: "pass" },
        { student: "王强", action: "pass" },
      ] },
      receivedAt: NOW,
    }],
  };
  const read = readTeacherDirectives(activeClassroomLan(lan));
  equal("坏 verdict 丢弃、好 verdict 保留", read.length, 1);
  equal("保留的是好 verdict", read[0].student, "王强");
}

/* ─────────── 2b. 个性化交代：skill 生成的字随判决上板，本层只显示 ─────────── */

{
  // 「过关等内容由 Mochi 直接调 skill 逐人生成」——所以这段字必须能一路走到板上，
  // 而且派生层绝不能在它缺席时自己编一个：缺省显示「空」才是诚实。
  const lan = {
    inbox: [{
      messageId: "d-note",
      from: { role: "teacher" },
      body: "第 5 单元听写已登记，名单见下。",
      directive: { item: "第 5 单元听写", verdicts: [
        { student: "李明", seat: 3, action: "fail", note: "th /θ/ 读成了 /s/，课间来重听第 2 段。" },
        { student: "赵敏", seat: 1, action: "pass", note: "全对，继续预习第 6 单元。" },
        { student: "王强", seat: 7, action: "fail" },
      ] },
      receivedAt: NOW,
    }],
  };
  const read = readTeacherDirectives(activeClassroomLan(lan));
  equal("不过关的逐人交代读到", read[0].note, "th /θ/ 读成了 /s/，课间来重听第 2 段。");
  equal("过关也有自己的交代", read[1].note, "全对，继续预习第 6 单元。");
  // 老师没给交代时必须留空，不能拿整批正文补齐：否则一个班 40 行会重复同一句话。
  equal("缺交代就是空串，不拿整批正文填", read[2].note, "");
  equal("名目与交代是两件事", read[2].item, "第 5 单元听写");

  const board = classroomRailSnapshot(activeClassroomLan(lan), NOW);
  equal("板上先显示不过关那位", board.rows[0].note, "th /θ/ 读成了 /s/，课间来重听第 2 段。");
  equal("名目进 meta 行", board.rows[0].meta, "第 5 单元听写");
  equal("徽章仍是判决", board.rows[0].badge, "不过关");
  // 板上顺序不是读取顺序：没过的排在前面（学生要自己处理的），过关的沉底当交代。
  equal("没过的连排在前", board.rows[1].name, "王强");
  equal("缺交代的行留空", board.rows[1].note, "");
  equal("过关的沉底且带自己的交代", board.rows[2].note, "全对，继续预习第 6 单元。");
  equal("过关徽章", board.rows[2].badge, "过关");

  // 不带名册的普通通知没有「名目」可言：整句话只该出现一次。
  const plain = classroomRailSnapshot(activeClassroomLan({
    inbox: [{ messageId: "p1", from: { role: "teacher" }, body: "李明到讲台来", receivedAt: NOW }],
  }), NOW);
  equal("普通通知的正文进 note", plain.rows[0].note, "李明到讲台来");
  equal("普通通知不重复进 meta", plain.rows[0].meta, "");

  // 教室端弹窗那一行该放的是学生要照着做的事，不是名目。
  const before = classroomRailSnapshot({ inbox: [] }, NOW);
  const batchPopups = newAttentionPayloads("classroom-board", before, board);
  equal("一批只弹一次", batchPopups.length, 1);
  equal("多人时聚合成一条而不是逐行弹", batchPopups[0].subject, "3 位同学 · 新任务");
  equal("聚合弹窗列出前三位", batchPopups[0].detail, "李明、王强、赵敏");

  // 只来一位学生时，签收前必须看到动作、名目、个性化交代和教师正文。
  const solo = classroomRailSnapshot(activeClassroomLan({
    inbox: [{
      messageId: "d-solo",
      from: { role: "teacher" },
      body: "第 5 单元听写已登记。",
      directive: { item: "第 5 单元听写", verdicts: [
        { student: "李明", seat: 3, action: "fail", note: "th /θ/ 读成了 /s/，课间来重听第 2 段。" },
      ] },
      receivedAt: NOW,
    }],
  }), NOW);
  const soloPopups = newAttentionPayloads("classroom-board", before, solo);
  equal("单人弹窗只有一条", soloPopups.length, 1);
  equal("不过关弹窗有准确标题", soloPopups[0].title, "未过关提醒");
  equal("不过关弹窗显示动作与学生", soloPopups[0].subject, "李明 · 不过关");
  equal("签收前看到完整判定", soloPopups[0].detail,
    "事项：第 5 单元听写 · 结果：不过关 · 交代：th /θ/ 读成了 /s/，课间来重听第 2 段。 · 教师原话：第 5 单元听写已登记。");
  equal("完整单人判定可由弹窗签收", soloPopups[0].receiptMessageId, "d-solo");

  const notice = classroomRailSnapshot(activeClassroomLan({ inbox: [{
    messageId: "plain-short", from: { role: "teacher" }, body: "明天第一节带练习册。", receivedAt: NOW,
  }] }), NOW);
  const noticePopup = newAttentionPayloads("classroom-board", before, notice)[0];
  equal("普通通知不误称叫人", noticePopup.title, "叮咚，Mochi 来送信啦～");
  equal("普通通知展示完整原话", noticePopup.detail, "教师原话：明天第一节带练习册。");
  equal("完整短通知可确认", noticePopup.receiptMessageId, "plain-short");

  const longNotice = classroomRailSnapshot(activeClassroomLan({ inbox: [{
    messageId: "plain-long", from: { role: "teacher" }, body: "请看这份详细通知。".repeat(36), receivedAt: NOW,
  }] }), NOW);
  const longPopup = newAttentionPayloads("classroom-board", before, longNotice)[0];
  equal("正文截断时不可签收", longPopup.receiptMessageId, undefined);
  ok("长通知引导打开原消息", longPopup.detail.includes("点开查看完整消息"));

  const longVerdict = classroomRailSnapshot(activeClassroomLan({ inbox: [{
    messageId: "verdict-long", from: { role: "teacher" }, body: "请务必按要求在本周完成复查。".repeat(9),
    directive: { item: "第 5 单元听写", verdicts: [{ student: "李明", action: "fail", note: "复习重点词汇并重听第 2 段。".repeat(8) }] },
    receivedAt: NOW,
  }] }), NOW);
  equal("综合内容装不下弹窗时不可签收",
    newAttentionPayloads("classroom-board", before, longVerdict)[0].receiptMessageId, undefined);

  // 教师端可直接签收的单条弹窗只给原话，结构化摘要已在常驻条可见。
  const requestLan = classroomInbox([
    { messageId: "r-new", body: "第 3 题不太懂", request: { student: "李明", seat: 3, kind: "appointment", topic: "二次函数", slot: "第八节晚自习" }, receivedAt: NOW },
  ]);
  const teacherPopups = newAttentionPayloads(
    "teacher-rail",
    teacherRailSnapshot({ inbox: [] }, NOW),
    teacherRailSnapshot(requestLan, NOW),
  );
  equal("教师端弹窗只有一条", teacherPopups.length, 1);
  equal("教师端弹窗完整展示原话且不附冗余摘要", teacherPopups[0].detail, "学生原话：第 3 题不太懂");
}

{
  // 没有 directive 的教师通知是普通喊话，按「叫人」上板——老师只是叫一声，
  // 也属于学生需要看到的信息。
  const lan = {
    inbox: [{
      messageId: "c1",
      from: { endpointId: "teacher-1", role: "teacher", schoolId: "jxl", displayName: "王老师" },
      body: "李明到讲台来",
      receivedAt: NOW,
    }],
  };
  const read = readTeacherDirectives(activeClassroomLan(lan));
  equal("无 directive 的通知上板", read.length, 1);
  equal("按叫人处理", read[0].action, "call");
  equal("学生名留空由展示层兜底", read[0].student, "");
}

{
  // verdicts 不是数组（畸形推送）时，该消息不作为处置上板，但不影响其他消息。
  const lan = {
    inbox: [{
      messageId: "x1",
      from: { role: "teacher" },
      body: "莫名其妙",
      directive: { item: "听写", verdicts: "nope" },
      receivedAt: NOW,
    }],
  };
  equal("verdicts 畸形时丢弃该消息", readTeacherDirectives(activeClassroomLan(lan)).length, 0);
}

{
  const source = activeClassroomLan({ inbox: [{ messageId: "done-call", from: { role: "teacher" }, body: "到讲台", directive: { verdicts: [{ student: "李明", action: "call" }] }, receivedAt: NOW }] });
  equal("未确认喊人保留在板上", classroomRailSnapshot(source, NOW).rows.length, 1);
  source.inbox[0].seenReceipt = "ACKNOWLEDGED";
  equal("确认后喊人移出板面", classroomRailSnapshot(source, NOW).rows.length, 0);
  equal("板面清理不删除原通知", source.inbox.length, 1);
}

/* ───────────────── 3. 教师端快照：排队号与沉底 ───────────────── */

{
  const lan = classroomInbox([
    { messageId: "late", request: { student: "王强", kind: "appointment" }, receivedAt: "2026-09-18T12:00:00.000Z" },
    { messageId: "early", request: { student: "李明", kind: "appointment" }, receivedAt: "2026-09-18T08:00:00.000Z" },
    { messageId: "done", request: { student: "赵敏", kind: "question" }, receivedAt: "2026-09-18T07:00:00.000Z", seenAt: "2026-09-18T08:30:00.000Z" },
  ], [{ messageId: "done-reply", targetEndpointId: "classroom-1", peer: { fingerprint: "sha256:classroom-1" }, contentType: "NOTIFY", response: { replyToMessageId: "done", decision: "confirmed", slot: "明天课后" }, delivery: "ACKNOWLEDGED" }]);
  const snapshot = teacherRailSnapshot(lan, NOW);
  equal("surface 正确", snapshot.surface, "teacher-rail");
  equal("先到先排号：已处理退出", snapshot.rows.map((row) => row.id), ["early", "late"]);
  equal("序号是排队号", snapshot.rows.map((row) => row.seq), [1, 2]);
  equal("标题只数未处理", snapshot.heading, "待办 · 2 位学生");
  equal("未处理标 attention", snapshot.rows[0].tone, "attention");
  equal("原始请求保留供历史核对", readStudentRequests(lan).length, 3);
}

{
  const request = { messageId: "request-1", request: { student: "李明", kind: "appointment", slot: "周四课后" }, receivedAt: NOW, seenAt: NOW };
  const inbox = classroomInbox([request]);
  const response = (delivery, decision = "confirmed", slot = "周五第八节") => ({
    messageId: `reply-${delivery}`, targetEndpointId: "classroom-1", peer: { fingerprint: "sha256:classroom-1" }, contentType: "NOTIFY",
    response: { replyToMessageId: "request-1", decision, slot }, delivery,
  });
  const cases = [
    ["PENDING", "回复中", true, "教师回复正在投递"],
    ["UNKNOWN", "投递未知", true, "教师回复投递状态不明"],
    ["NOT_SENT", "未送出", true, "教师回复尚未送出"],
  ];
  for (const [delivery, badge, actionRequired, context] of cases) {
    const row = teacherRailSnapshot(classroomInbox([request], [response(delivery)]), NOW).rows[0];
    equal(`${delivery} 状态徽标`, row.badge, badge);
    equal(`${delivery} 待办标志`, row.actionRequired, actionRequired);
    ok(`${delivery} context 说明投递事实`, row.context.includes(context));
  }
  const receiptSnapshot = classroomInbox([request], [response("UNKNOWN")]);
  receiptSnapshot.receipts = [{ messageId: "reply-UNKNOWN", from: { endpointId: "classroom-1", fingerprint: "sha256:classroom-1" }, seenAt: NOW }];
  equal("已看到的回复退出教师待办", teacherRailSnapshot(receiptSnapshot, NOW).rows.length, 0);
  equal("回执保留在历史请求", readStudentRequests(receiptSnapshot)[0].response.delivery, "RECEIPT_SEEN");
  equal("已送达回复退出教师待办", teacherRailSnapshot(classroomInbox([request], [response("ACKNOWLEDGED")]), NOW).rows.length, 0);
  const rescheduled = teacherRailSnapshot(classroomInbox([request], [response("UNKNOWN", "rescheduled")]), NOW).rows[0];
  ok("待核对改期显示教师建议时间", rescheduled.context.includes("教师建议改期：周五第八节"));
  const mismatched = classroomInbox([request], [{ ...response("ACKNOWLEDGED"), targetEndpointId: "other-class" }]);
  equal("不同教室端点的回复不关联", teacherRailSnapshot(mismatched, NOW).rows[0].badge, "待回复");
  const wrongKey = classroomInbox([request], [{ ...response("ACKNOWLEDGED"), peer: { fingerprint: "sha256:replacement-device" } }]);
  equal("不同设备密钥的回复不关联", teacherRailSnapshot(wrongKey, NOW).rows[0].badge, "待回复");
}

{
  const question = { messageId: "question-1", request: { student: "李明", kind: "question" }, body: "第七题为什么选 B？", receivedAt: NOW, seenAt: NOW };
  const reply = {
    messageId: "question-reply-1", targetEndpointId: "classroom-1", peer: { fingerprint: "sha256:classroom-1" }, contentType: "NOTIFY",
    body: "课后先看第七题的条件。", response: { replyToMessageId: "question-1", decision: "replied" }, delivery: "ACKNOWLEDGED",
  };
  equal("已送达文字回复退出待办", teacherRailSnapshot(classroomInbox([question], [reply]), NOW).rows.length, 0);
  equal("文字回复仍可从历史记录核对", readStudentRequests(classroomInbox([question], [reply]))[0].response.delivery, "ACKNOWLEDGED");
  equal("未分型但有时间的旧请求仍视作预约", readStudentRequests(classroomInbox([{ messageId: "legacy-slot", request: { student: "小王", slot: "周五" }, receivedAt: NOW }]))[0].kind, "appointment");
  equal("明确留言即使有可选时间也不变预约", readStudentRequests(classroomInbox([{ messageId: "explicit-other", request: { student: "小赵", kind: "other", slot: "周五" }, receivedAt: NOW }]))[0].kind, "other");
}

{
  const empty = teacherRailSnapshot({ inbox: [] }, NOW);
  equal("空表不谎报待办", empty.heading, "待办 · 暂无");
  equal("空表给出明确说明", empty.detail, "没有学生请求");
  equal("空表没有行", empty.rows.length, 0);
}

{
  // 「没有待办」和「拿不到数据」必须同形，否则老师在断网时会以为真的没人预约。
  const broken = teacherRailSnapshot(null, NOW);
  equal("非对象输入当作空表", broken.rows.length, 0);
  equal("非对象输入不抛错", broken.heading, "待办 · 暂无");
}

/* ───────────────── 4. 教室端快照：不过关优先上板 ───────────────── */

{
  const lan = {
    inbox: [
      { messageId: "p1", from: { role: "teacher", displayName: "王老师" }, body: "听写结果", directive: { item: "听写", verdicts: [{ student: "赵敏", seat: 1, action: "pass" }] }, receivedAt: "2026-09-18T11:20:00.000Z" },
      { messageId: "f1", from: { role: "teacher", displayName: "王老师" }, body: "听写结果", directive: { item: "听写", verdicts: [{ student: "李明", seat: 3, action: "fail" }] }, receivedAt: "2026-09-18T11:10:00.000Z" },
      { messageId: "c1", from: { role: "teacher", displayName: "王老师" }, body: "到讲台", receivedAt: "2026-09-18T11:30:00.000Z" },
    ],
  };
  const snapshot = classroomRailSnapshot(activeClassroomLan(lan), NOW);
  equal("surface 正确", snapshot.surface, "classroom-board");
  equal("不过关/叫人上板在前，过关沉底", snapshot.rows.map((row) => row.id), ["f1", "c1", "p1"]);
  equal("不过关标 bad", snapshot.rows[0].tone, "bad");
  equal("不过关徽标措辞", snapshot.rows[0].badge, "不过关");
  equal("过关标 ok", snapshot.rows[2].tone, "ok");
  equal("过关徽标措辞", snapshot.rows[2].badge, "过关");
  equal("标题只数未完成", snapshot.heading, "待办 · 2 条");
}

{
  // 全班通知没有学生姓名，不能显示成空白行。
  const lan = {
    inbox: [{ messageId: "a1", from: { role: "teacher" }, body: "全班交作业", receivedAt: NOW }],
  };
  equal("无学生名的通知兜底显示", classroomRailSnapshot(activeClassroomLan(lan), NOW).rows[0].name, "全班");
}

{
  const verdicts = Array.from({ length: 64 }, (_, index) => ({ student: `学生${index + 1}`, action: "fail", note: `补第 ${index + 1} 题` }));
  const lan = {
    inbox: [{ messageId: "v64", from: { role: "teacher" }, body: "听写结果", directive: { item: "听写", verdicts }, receivedAt: NOW }],
  };
  const exactlyFull = classroomRailSnapshot(activeClassroomLan({
    inbox: [{ ...lan.inbox[0], directive: { item: "听写", verdicts: verdicts.slice(0, RAIL_ROW_LIMIT) } }],
  }), NOW);
  equal("刚好 50 人时不占用结果行", exactlyFull.rows.length, RAIL_ROW_LIMIT);
  equal("第 50 人仍逐人显示", exactlyFull.rows.at(-1).name, "学生50");

  const full = classroomRailSnapshot(activeClassroomLan(lan), NOW);
  equal("64 人结果投影保留总数", readTeacherDirectives(activeClassroomLan(lan)).length, 64);
  equal("教室角标使用裁剪前结果总数", full.totalRowCount, 64);
  equal("常驻板不越过主进程 50 行限制", full.rows.length, RAIL_ROW_LIMIT);
  equal("前 49 人逐人显示", full.rows[RAIL_ROW_LIMIT - 2].name, "学生49");
  equal("第 50 行明确提示剩余 15 条", full.rows.at(-1).name, "另有 15 条结果");
  equal("溢出入口指向第一条未显示结果所在的签名消息", full.rows.at(-1).id, "v64#49");
  equal("溢出入口有可执行提示", full.rows.at(-1).badge, "查看完整名单");
  ok("总数和隐藏数在常驻板副标题可见", full.detail.includes("共 64 条 · 其余 15 条"));
  equal("溢出提示不伪装成一位未过关学生", full.rows.at(-1).tone, "neutral");
  const notice = newAttentionPayloads("classroom-board", classroomRailSnapshot({ inbox: [] }, NOW), full);
  equal("64 人只产生一条聚合弹窗", notice.length, 1);
  equal("弹窗不把可见 49 行错称为总人数", notice[0].subject, "多位同学 · 新任务");
  ok("弹窗指向完整名单", notice[0].detail.includes("完整名单请点开查看"));

  const later = classroomRailSnapshot(activeClassroomLan({
    inbox: [...lan.inbox, {
      messageId: "extra", from: { role: "teacher" }, body: "补充处置",
      directive: { item: "听写", verdicts: [{ student: "学生65", action: "fail", note: "补第 65 题" }] },
      receivedAt: "2026-09-18T13:01:00.000Z",
    }],
  }), NOW);
  equal("第 65 条落在板外时溢出数更新", later.rows.at(-1).name, "另有 16 条结果");
  const tailNotice = newAttentionPayloads("classroom-board", full, later);
  equal("板外新增结果仍触发一次提醒", tailNotice.length, 1);
  equal("板外更新提醒标注真实剩余数", tailNotice[0].subject, "另有 16 条结果");
  equal("相同快照不重复提醒", newAttentionPayloads("classroom-board", later, later).length, 0);
}

/* ───────────────── 5. 弹窗触发：只在真的多了一条时弹 ───────────────── */

{
  const first = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW },
  ]), NOW);
  equal("首次快照不弹（避免启动时把历史全弹一遍）", newAttentionPayloads("teacher-rail", null, first).length, 0);

  const next = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW },
    { messageId: "m2", request: { student: "赵敏", kind: "appointment" }, body: "我想问第 3 题的配方法", receivedAt: NOW },
  ]), NOW);
  const payloads = newAttentionPayloads("teacher-rail", first, next);
  equal("新增预约弹一次", payloads.length, 1);
  equal("弹窗带学生名", payloads[0].subject, "赵敏");
  equal("弹窗类型是 request", payloads[0].kind, "request");
  equal("弹窗标题明确", payloads[0].title, "叮咚，Mochi 来送信啦～");
  ok("能在弹窗签收的短请求先展示学生原话", payloads[0].detail.includes("学生原话：我想问第 3 题的配方法"));
  equal("单条真实 inbox 请求携带 receipt messageId", payloads[0].receiptMessageId, "m2");
}

{
  const before = teacherRailSnapshot(classroomInbox([]), NOW);
  const note65 = "甲".repeat(65);
  const borderline = teacherRailSnapshot(classroomInbox([{
    messageId: "request-65",
    request: { student: "李明", kind: "question", topic: "一段很长的题目主题".repeat(4), material: "很长的材料名称".repeat(4), slot: "很长的预约上下文".repeat(4) },
    body: note65,
    receivedAt: NOW,
  }]), NOW);
  const direct = newAttentionPayloads("teacher-rail", before, borderline)[0];
  equal("65 字原话在主题和上下文很长时仍可完整直签", direct.receiptMessageId, "request-65");
  equal("直签详情完整保留原话且不附冗余摘要", direct.detail, `学生原话：${note65}`);
  ok("直签标题与详情都有严格字符上限", direct.subject.length <= 36 && direct.detail.length <= 80);

  const longName = teacherRailSnapshot(classroomInbox([{
    messageId: "request-long-name", request: { student: "学生姓名过长".repeat(9), kind: "question" },
    body: "请看这道题", receivedAt: NOW,
  }]), NOW);
  const namePopup = newAttentionPayloads("teacher-rail", before, longName)[0];
  equal("长姓名请求只预览不直签", namePopup.receiptMessageId, undefined);
  ok("长姓名标题被限制且详情指向完整请求", namePopup.subject.length <= 36
    && namePopup.detail.includes("打开 Mochi 查看完整请求"));
}

{
  const before = teacherRailSnapshot(classroomInbox([]), NOW);
  const longBody = "这道题的条件我不明白，想请老师详细解释。".repeat(20);
  const long = teacherRailSnapshot(classroomInbox([{
    messageId: "request-long", request: { student: "周华", kind: "question", topic: "二次函数" },
    body: longBody, receivedAt: NOW,
  }]), NOW);
  const longPopup = newAttentionPayloads("teacher-rail", before, long)[0];
  equal("长原话的弹窗不能快捷签收", longPopup.receiptMessageId, undefined);
  ok("长原话有预览和打开完整请求入口", longPopup.detail.includes("学生原话：")
    && longPopup.detail.includes("打开 Mochi 查看完整请求") && !longPopup.detail.includes(longBody));
  const empty = teacherRailSnapshot(classroomInbox([{
    messageId: "request-empty", request: { student: "周华", kind: "question", topic: "二次函数" },
    body: "", receivedAt: NOW,
  }]), NOW);
  const emptyPopup = newAttentionPayloads("teacher-rail", before, empty)[0];
  equal("原话为空时不能快捷签收", emptyPopup.receiptMessageId, undefined);
  ok("原话为空时指向完整请求", emptyPopup.detail.includes("打开 Mochi 查看完整请求"));
}

{
  const request = (index) => ({
    messageId: `over-${index}`,
    request: { student: `学生${index}`, kind: "appointment", slot: "课后" },
    receivedAt: `2026-09-18T10:00:${String(index).padStart(2, "0")}.000Z`,
  });
  const entries = Array.from({ length: 51 }, (_, index) => request(index));
  const base = classroomInbox(entries);
  const before = teacherRailSnapshot(base, NOW);
  const after = teacherRailSnapshot(classroomInbox([...entries, request(51)]), NOW);
  const hidden = newAttentionPayloads("teacher-rail", before, after);
  equal("第 52 条预约虽藏在汇总行仍提醒一次", hidden.length, 1);
  equal("隐藏请求弹窗明确是新增请求", hidden[0].subject, "新增 1 条学生请求");
  equal("overflow 汇总提醒不携带 receipt", hidden[0].receiptMessageId, undefined);
  ok("隐藏预约弹窗带真实学生和处理入口", hidden[0].detail.includes("学生51") && hidden[0].detail.includes("点开查看"));
  equal("重复快照不会再次提醒隐藏预约", newAttentionPayloads("teacher-rail", after, after).length, 0);
  ok("待办标题变化也会更新常驻条", railSnapshotSignature(after) !== railSnapshotSignature({ ...after, heading: "待办 · 已更新" }));
  ok("汇总说明变化也会更新常驻条", railSnapshotSignature(after) !== railSnapshotSignature({ ...after, detail: "新的汇总" }));
  equal("仅轮询时间变化不重绘常驻条", railSnapshotSignature(after), railSnapshotSignature({ ...after, updatedAt: "2026-09-24T12:00:00.000Z" }));
  const batch = teacherRailSnapshot(classroomInbox([...entries, request(51), request(52)]), NOW);
  const grouped = newAttentionPayloads("teacher-rail", before, batch);
  equal("多条隐藏预约合并为一条弹窗", grouped.length, 1);
  equal("合并弹窗给出真实新增人数", grouped[0].subject, "2 位同学 · 新请求");
  equal("聚合弹窗不携带 receipt", grouped[0].receiptMessageId, undefined);

  const urgent = {
    messageId: "outgoing-urgent", contentType: "NOTIFY", targetEndpointId: "classroom-1",
    peer: base.peers[0], sender: base.identity, body: "请到办公室",
    directive: { verdicts: [{ student: "李明", action: "call" }] },
    delivery: "NOT_SENT", createdAt: NOW,
  };
  const shifted = teacherRailSnapshot({ ...base, outbox: [urgent] }, NOW);
  ok("通知改变可见容量与预约汇总数", before.rows.at(-1).name !== shifted.rows.at(-1).name);
  equal("发件状态变化不会误报新预约", newAttentionPayloads("teacher-rail", before, shifted).length, 0);

  const fuller = [...entries, request(51)];
  const replaced = [...fuller.slice(0, -1), { ...request(51), messageId: "over-new" }];
  const previous = teacherRailSnapshot(classroomInbox(fuller), NOW);
  const next = teacherRailSnapshot(classroomInbox(replaced), NOW);
  equal("隐藏预约替换时 50 条可见行完全相同", next.rows, previous.rows);
  ok("隐藏预约 ID 变更仍会穿过主进程去重签名", railSnapshotSignature(next) !== railSnapshotSignature(previous));
  const replacement = newAttentionPayloads("teacher-rail", previous, next);
  equal("隐藏预约替换也只弹一次", replacement.length, 1);
  ok("替换弹窗取自真实新预约", replacement[0].detail.includes("学生51"));

  const historical = classroomInbox([...entries, request(51)]);
  historical.inbox.at(-1).recipient = { ...historical.identity, fingerprint: "sha256:old-teacher" };
  const oldIdentity = teacherRailSnapshot(historical, NOW);
  equal("旧教师身份的隐藏预约不能触发当前老师弹窗", newAttentionPayloads("teacher-rail", before, oldIdentity).length, 0);
}

{
  const lan = {
    inbox: [{ messageId: "c1", from: { role: "teacher" }, body: "到讲台", directive: { verdicts: [{ student: "李明", action: "call" }] }, receivedAt: NOW }],
  };
  const first = classroomRailSnapshot({ inbox: [] }, NOW);
  const next = classroomRailSnapshot(activeClassroomLan(lan), NOW);
  const payloads = newAttentionPayloads("classroom-board", first, next);
  equal("教室端喊人弹窗", payloads.length, 1);
  equal("教室端弹窗类型是 call", payloads[0].kind, "call");
  equal("教室端弹窗标题", payloads[0].title, "叮咚，Mochi 来送信啦～");
  equal("单条真实 office call 携带 receipt messageId", payloads[0].receiptMessageId, "c1");
  const batch = classroomRailSnapshot(activeClassroomLan({ inbox: [{
    messageId: "batch-call", from: { role: "teacher" }, body: "逐人安排",
    directive: { verdicts: [
      { student: "李明", action: "call" },
      { student: "赵敏", action: "call" },
    ] }, receivedAt: NOW,
  }] }), NOW);
  const batchPayload = newAttentionPayloads("classroom-board", first, batch);
  equal("多 verdict synthetic row 弹窗不携带 receipt", batchPayload[0].receiptMessageId, undefined);
}

{
  // 已看到/过关这类「好消息」不该打断老师或学生的注意力。
  const before = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW, seenAt: NOW },
  ]), NOW);
  const after = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW, seenAt: NOW },
    { messageId: "m2", request: { student: "赵敏", kind: "appointment" }, receivedAt: NOW, seenAt: NOW },
  ], [{ messageId: "m2-reply", targetEndpointId: "classroom-1", peer: { fingerprint: "sha256:classroom-1" }, contentType: "NOTIFY", response: { replyToMessageId: "m2", decision: "confirmed", slot: "明天" }, delivery: "ACKNOWLEDGED" }]), NOW);
  equal("不打扰：新增已处理行不弹窗", newAttentionPayloads("teacher-rail", before, after).length, 0);
}

{
  // 换了角色就不能拿旧快照做 diff，否则会把整块板当成「新增」全弹一遍。
  const teacher = teacherRailSnapshot(classroomInbox([{ messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW }]), NOW);
  const board = classroomRailSnapshot(activeClassroomLan({ inbox: [{ messageId: "c1", from: { role: "teacher" }, body: "叫", receivedAt: NOW }] }), NOW);
  equal("跨屏不比较", newAttentionPayloads("classroom-board", teacher, board).length, 0);
}

{
  // 一次听写登记会下发一整批（一个学生一条）。逐行弹窗会在教室屏上连弹几十次，
  // 那是骚扰而不是提醒——必须聚合成一条。
  const empty = classroomRailSnapshot({ inbox: [] }, NOW);
  const batch = classroomRailSnapshot(activeClassroomLan({
    inbox: [{
      messageId: "v",
      from: { role: "teacher", displayName: "王老师" },
      body: "第 5 单元听写结果",
      directive: {
        item: "第 5 单元听写",
        verdicts: ["李明", "赵敏", "王强", "陈静"].map((student) => ({ student: student, action: "fail" })),
      },
      receivedAt: "2026-09-18T11:00:00.000Z",
    }],
  }), NOW);
  const payloads = newAttentionPayloads("classroom-board", empty, batch);
  equal("一批新结果只弹一次", payloads.length, 1);
  equal("聚合标题带人数", payloads[0].subject, "4 位同学 · 新任务");
  ok("聚合副行列出前几位姓名", payloads[0].detail.includes("李明"));
  ok("聚合副行用「等」省略其余", payloads[0].detail.endsWith("等"));
  equal("聚合用首行 id 派生去重键", payloads[0].id, "v#0#4");
}

{
  // 只有一条时不做聚合，主行同时给出学生与动作。
  const empty = classroomRailSnapshot({ inbox: [] }, NOW);
  const single = classroomRailSnapshot(activeClassroomLan({
    inbox: [{ messageId: "v0", from: { role: "teacher" }, body: "到讲台", directive: { verdicts: [{ student: "李明", action: "call" }] }, receivedAt: NOW }],
  }), NOW);
  const payloads = newAttentionPayloads("classroom-board", empty, single);
  equal("单条不聚合", payloads.length, 1);
  equal("单条标明学生与动作", payloads[0].subject, "李明 · 小纸条");
  equal("单条去重键就是行 id", payloads[0].id, "v0");
}

/* ───────────────── 6. 不可信输入：裁剪、上限、不抛错 ───────────────── */

{
  const lan = classroomInbox([
    {
      messageId: "big",
      request: { student: "李".repeat(500), seat: 99999, kind: "appointment", topic: "T".repeat(5000), slot: "S".repeat(5000) },
      body: "B".repeat(50000),
      receivedAt: NOW,
    },
  ]);
  const row = teacherRailSnapshot(lan, NOW).rows[0];
  ok("超长姓名被裁剪", row.name.length <= 80);
  ok("超长正文被裁剪", row.note.length <= 240);
  ok("超长元信息被裁剪", row.meta.length <= 80);
  equal("越界座号归零而不是原样透传", readStudentRequests(lan)[0].seat, null);
}

{
  const lan = classroomInbox([
    { messageId: "ctl", request: { student: "李\u0000明\n\t", kind: "appointment" }, body: "换行\u0000在这里", receivedAt: NOW },
  ]);
  const row = teacherRailSnapshot(lan, NOW).rows[0];
  ok("控制字符被剔除", !/[\u0000-\u001f\u007f]/u.test(row.name + row.note + row.meta));
}

{
  // rows 字段形状错、行本身不是对象、缺 messageId：全部丢，但不影响同批好行。
  const lan = {
    inbox: [
      "不是对象",
      null,
      { from: { role: "classroom" }, request: { student: "无ID" }, receivedAt: NOW },
      { messageId: "keep", from: { role: "classroom" }, request: { student: "好行", kind: "appointment" }, receivedAt: NOW },
    ],
  };
  const read = readStudentRequests(lan);
  equal("坏行全丢、好行保留", read.length, 1);
  equal("保留的是好行", read[0].student, "好行");
}

{
  equal("inbox 不是数组时当作空", readStudentRequests({ inbox: "nope" }).length, 0);
  equal("inbox 是对象时当作空", readStudentRequests({ inbox: { 0: {} } }).length, 0);
  equal("undefined 输入不抛错", readStudentRequests(undefined).length, 0);
  equal("数组输入不抛错", readStudentRequests([]).length, 0);
}

{
  // 行数超过契约上限时必须截断——否则主进程会静默砍尾，而这里显示的序号会说谎。
  const many = Array.from({ length: RAIL_ROW_LIMIT + 20 }, (_, index) => ({
    messageId: `m${String(index).padStart(3, "0")}`,
    request: { student: `学生${index}`, kind: "appointment" },
    receivedAt: `2026-09-18T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
  }));
  const snapshot = teacherRailSnapshot(classroomInbox(many), NOW);
  equal("行数截断到契约上限", snapshot.rows.length, RAIL_ROW_LIMIT);
  equal("截断后序号仍然连续", snapshot.rows[RAIL_ROW_LIMIT - 1].seq, RAIL_ROW_LIMIT);
}

{
  // 时间字段畸形不能让排序抛错，"undefined".localeCompare 之类的连锁问题要在这里挡住。
  const lan = classroomInbox([
    { messageId: "a", request: { student: "甲", kind: "appointment" }, receivedAt: "不是时间" },
    { messageId: "b", request: { student: "乙", kind: "appointment" }, receivedAt: "2026-09-18T10:00:00.000Z" },
  ]);
  const snapshot = teacherRailSnapshot(lan, NOW);
  equal("畸形时间不抛错且仍出两行", snapshot.rows.length, 2);
  equal("畸形时间排在有时间的前面", snapshot.rows[0].id, "a");
}

{
  const snapshot = teacherRailSnapshot({ inbox: [] }, NOW);
  equal("updatedAt 原样带回", snapshot.updatedAt, NOW);
}

console.log(`[test-rail-model] PASS: ${checks} 项断言通过（学生预约读取、教师处置读取、排队号排序、过关上板优先级、弹窗去重、不可信输入裁剪与上限）。`);
