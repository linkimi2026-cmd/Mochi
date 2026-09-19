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
  teacherRailSnapshot,
  classroomRailSnapshot,
  newAttentionPayloads,
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

function classroomInbox(entries) {
  return {
    inbox: entries.map((entry) => ({
      messageId: entry.messageId,
      from: { endpointId: "classroom-1", role: "classroom", schoolId: "jxl", classId: "g1-3", displayName: "高一3班教室端" },
      recipient: { endpointId: "teacher-1", role: "teacher", schoolId: "jxl", displayName: "王老师" },
      body: entry.body ?? "",
      ...(entry.request === undefined ? {} : { request: entry.request }),
      receivedAt: entry.receivedAt,
      ...(entry.seenAt === undefined ? {} : { seenAt: entry.seenAt }),
    })),
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
  equal("类型 · 要讲什么 · 时间 依次拼进 meta", row.meta, "预约讲题 · 步步高 Unit 5 完形填空第 7 空 · 第八节晚自习");
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
  equal("缺位置时退回旧格式", legacy.meta, "预约讲题 · 二次函数 · 第八节晚自习");
}

{
  // 教师端可能同时配对多个教室设备；学生身份在 request.student。没有 request 的
  // 收件是普通通知，不能当成预约混进待办表。
  const lan = classroomInbox([{ messageId: "m1", body: "明天带课本", receivedAt: NOW }]);
  equal("缺 request 的收件不进预约表", readStudentRequests(lan).length, 0);
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
  const read = readTeacherDirectives(lan);
  equal("一条消息展开成两行", read.length, 2);
  equal("fail 动作保留", read[0].action, "fail");
  equal("pass 动作保留", read[1].action, "pass");
  equal("名目取自 directive.item", read[0].item, "第 5 单元听写");
  equal("展开后行 id 互不相同", read[0].messageId !== read[1].messageId, true);
  equal("单个 verdict 时行 id 就是 messageId", readTeacherDirectives({
    inbox: [{ messageId: "solo", from: { role: "teacher" }, body: "x", directive: { verdicts: [{ student: "李明", action: "call" }] }, receivedAt: NOW }],
  })[0].messageId, "solo");
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
  const read = readTeacherDirectives(lan);
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
  const read = readTeacherDirectives(lan);
  equal("不过关的逐人交代读到", read[0].note, "th /θ/ 读成了 /s/，课间来重听第 2 段。");
  equal("过关也有自己的交代", read[1].note, "全对，继续预习第 6 单元。");
  // 老师没给交代时必须留空，不能拿整批正文补齐：否则一个班 40 行会重复同一句话。
  equal("缺交代就是空串，不拿整批正文填", read[2].note, "");
  equal("名目与交代是两件事", read[2].item, "第 5 单元听写");

  const board = classroomRailSnapshot(lan, NOW);
  equal("板上先显示不过关那位", board.rows[0].note, "th /θ/ 读成了 /s/，课间来重听第 2 段。");
  equal("名目进 meta 行", board.rows[0].meta, "第 5 单元听写");
  equal("徽章仍是判决", board.rows[0].badge, "不过关");
  // 板上顺序不是读取顺序：没过的排在前面（学生要自己处理的），过关的沉底当交代。
  equal("没过的连排在前", board.rows[1].name, "王强");
  equal("缺交代的行留空", board.rows[1].note, "");
  equal("过关的沉底且带自己的交代", board.rows[2].note, "全对，继续预习第 6 单元。");
  equal("过关徽章", board.rows[2].badge, "过关");

  // 不带名册的普通通知没有「名目」可言：整句话只该出现一次。
  const plain = classroomRailSnapshot({
    inbox: [{ messageId: "p1", from: { role: "teacher" }, body: "李明到讲台来", receivedAt: NOW }],
  }, NOW);
  equal("普通通知的正文进 note", plain.rows[0].note, "李明到讲台来");
  equal("普通通知不重复进 meta", plain.rows[0].meta, "");

  // 教室端弹窗那一行该放的是学生要照着做的事，不是名目。
  const before = classroomRailSnapshot({ inbox: [] }, NOW);
  const batchPopups = newAttentionPayloads("classroom-board", before, board);
  equal("一批只弹一次", batchPopups.length, 1);
  equal("多人时聚合成一条而不是逐行弹", batchPopups[0].subject, "3 位同学 · 新任务");
  equal("聚合弹窗列出前三位", batchPopups[0].detail, "李明、王强、赵敏");

  // 只来一位学生时，弹窗那一行就是给他的个性化交代。
  const solo = classroomRailSnapshot({
    inbox: [{
      messageId: "d-solo",
      from: { role: "teacher" },
      body: "第 5 单元听写已登记。",
      directive: { item: "第 5 单元听写", verdicts: [
        { student: "李明", seat: 3, action: "fail", note: "th /θ/ 读成了 /s/，课间来重听第 2 段。" },
      ] },
      receivedAt: NOW,
    }],
  }, NOW);
  const soloPopups = newAttentionPayloads("classroom-board", before, solo);
  equal("单人弹窗只有一条", soloPopups.length, 1);
  equal("单人弹窗带的是个性化交代", soloPopups[0].detail, "th /θ/ 读成了 /s/，课间来重听第 2 段。");

  // 教师端反过来：那一行放结构化摘要，老师按类型扫。
  const requestLan = classroomInbox([
    { messageId: "r-new", body: "第 3 题不太懂", request: { student: "李明", seat: 3, kind: "appointment", topic: "二次函数", slot: "第八节晚自习" }, receivedAt: NOW },
  ]);
  const teacherPopups = newAttentionPayloads(
    "teacher-rail",
    teacherRailSnapshot({ inbox: [] }, NOW),
    teacherRailSnapshot(requestLan, NOW),
  );
  equal("教师端弹窗只有一条", teacherPopups.length, 1);
  equal("教师端弹窗放结构化摘要", teacherPopups[0].detail, "预约讲题 · 二次函数 · 第八节晚自习");
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
  const read = readTeacherDirectives(lan);
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
  equal("verdicts 畸形时丢弃该消息", readTeacherDirectives(lan).length, 0);
}

/* ───────────────── 3. 教师端快照：排队号与沉底 ───────────────── */

{
  const lan = classroomInbox([
    { messageId: "late", request: { student: "王强", kind: "appointment" }, receivedAt: "2026-09-18T12:00:00.000Z" },
    { messageId: "early", request: { student: "李明", kind: "appointment" }, receivedAt: "2026-09-18T08:00:00.000Z" },
    { messageId: "done", request: { student: "赵敏", kind: "question" }, receivedAt: "2026-09-18T07:00:00.000Z", seenAt: "2026-09-18T08:30:00.000Z" },
  ]);
  const snapshot = teacherRailSnapshot(lan, NOW);
  equal("surface 正确", snapshot.surface, "teacher-rail");
  equal("先到先排号：已处理的沉底", snapshot.rows.map((row) => row.id), ["early", "late", "done"]);
  equal("序号是排队号", snapshot.rows.map((row) => row.seq), [1, 2, 3]);
  equal("标题只数未处理", snapshot.heading, "待办 · 2 位学生");
  equal("未处理标 attention", snapshot.rows[0].tone, "attention");
  equal("已看到回落 neutral", snapshot.rows[2].tone, "neutral");
  equal("状态徽标区分处理进度", snapshot.rows[2].badge, "已看到");
}

{
  const empty = teacherRailSnapshot({ inbox: [] }, NOW);
  equal("空表不谎报待办", empty.heading, "待办 · 暂无");
  equal("空表给出明确说明", empty.detail, "没有学生预约");
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
  const snapshot = classroomRailSnapshot(lan, NOW);
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
  equal("无学生名的通知兜底显示", classroomRailSnapshot(lan, NOW).rows[0].name, "全班");
}

/* ───────────────── 5. 弹窗触发：只在真的多了一条时弹 ───────────────── */

{
  const first = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW },
  ]), NOW);
  equal("首次快照不弹（避免启动时把历史全弹一遍）", newAttentionPayloads("teacher-rail", null, first).length, 0);

  const next = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW },
    { messageId: "m2", request: { student: "赵敏", kind: "appointment" }, receivedAt: NOW },
  ]), NOW);
  const payloads = newAttentionPayloads("teacher-rail", first, next);
  equal("新增预约弹一次", payloads.length, 1);
  equal("弹窗带学生名", payloads[0].subject, "赵敏");
  equal("弹窗类型是 request", payloads[0].kind, "request");
  equal("弹窗标题明确", payloads[0].title, "新的学生预约");
}

{
  const lan = {
    inbox: [{ messageId: "c1", from: { role: "teacher" }, body: "到讲台", directive: { verdicts: [{ student: "李明", action: "call" }] }, receivedAt: NOW }],
  };
  const first = classroomRailSnapshot({ inbox: [] }, NOW);
  const next = classroomRailSnapshot(lan, NOW);
  const payloads = newAttentionPayloads("classroom-board", first, next);
  equal("教室端喊人弹窗", payloads.length, 1);
  equal("教室端弹窗类型是 call", payloads[0].kind, "call");
  equal("教室端弹窗标题", payloads[0].title, "老师叫你");
}

{
  // 已看到/过关这类「好消息」不该打断老师或学生的注意力。
  const before = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW, seenAt: NOW },
  ]), NOW);
  const after = teacherRailSnapshot(classroomInbox([
    { messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW, seenAt: NOW },
    { messageId: "m2", request: { student: "赵敏", kind: "appointment" }, receivedAt: NOW, seenAt: NOW },
  ]), NOW);
  equal("不打扰：新增已处理行不弹窗", newAttentionPayloads("teacher-rail", before, after).length, 0);
}

{
  // 换了角色就不能拿旧快照做 diff，否则会把整块板当成「新增」全弹一遍。
  const teacher = teacherRailSnapshot(classroomInbox([{ messageId: "m1", request: { student: "李明", kind: "appointment" }, receivedAt: NOW }]), NOW);
  const board = classroomRailSnapshot({ inbox: [{ messageId: "c1", from: { role: "teacher" }, body: "叫", receivedAt: NOW }] }, NOW);
  equal("跨屏不比较", newAttentionPayloads("classroom-board", teacher, board).length, 0);
}

{
  // 一次听写登记会下发一整批（一个学生一条）。逐行弹窗会在教室屏上连弹几十次，
  // 那是骚扰而不是提醒——必须聚合成一条。
  const empty = classroomRailSnapshot({ inbox: [] }, NOW);
  const batch = classroomRailSnapshot({
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
  }, NOW);
  const payloads = newAttentionPayloads("classroom-board", empty, batch);
  equal("一批新结果只弹一次", payloads.length, 1);
  equal("聚合标题带人数", payloads[0].subject, "4 位同学 · 新任务");
  ok("聚合副行列出前几位姓名", payloads[0].detail.includes("李明"));
  ok("聚合副行用「等」省略其余", payloads[0].detail.endsWith("等"));
  equal("聚合用首行 id 派生去重键", payloads[0].id, "v#0#4");
}

{
  // 只有一条时不做聚合，直接用学生名——单一事件说「1 位同学」很生硬。
  const empty = classroomRailSnapshot({ inbox: [] }, NOW);
  const single = classroomRailSnapshot({
    inbox: [{ messageId: "v0", from: { role: "teacher" }, body: "到讲台", directive: { verdicts: [{ student: "李明", action: "call" }] }, receivedAt: NOW }],
  }, NOW);
  const payloads = newAttentionPayloads("classroom-board", empty, single);
  equal("单条不聚合", payloads.length, 1);
  equal("单条直接用学生名", payloads[0].subject, "李明");
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
