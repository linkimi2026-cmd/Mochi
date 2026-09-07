-- F-006 修复：为新消息表（messages / message_recipients）补充演示种子
-- 背景：迁移 0002 仅向旧表 in_app_notifications 写入种子，而 /api/messages 读取新表
-- messages/message_recipients，导致全新数据库（pnpm db:reset）后消息中心显示"没有站内消息"。
-- 本迁移仅在 messages 表为空时插入，避免在已有数据的环境中重复写入（幂等）。
-- 种子对应事件 1（需关注，校医 user 1 创建），接收人为班主任 user 2、任课教师 user 3、年级负责人 user 4，
-- 与旧表 in_app_notifications 种子语义一致；保留为未读（read_at IS NULL）以演示未读角标。

INSERT INTO messages (public_reference, medical_event_id, sender_user_id, message_type, body, created_at)
SELECT 'msg_demo_seed_event1', 1, 1, 'SYSTEM', '您负责的班级有一条新的医务事件，请登录查看。', datetime('now','-38 minutes')
WHERE NOT EXISTS (SELECT 1 FROM messages);

INSERT INTO message_recipients (message_id, recipient_user_id, recipient_role, delivered_state, opened_at, read_at)
SELECT m.id, u.id, u.role, 'accepted', datetime('now','-36 minutes'), NULL
FROM messages m
JOIN users u ON u.id IN (2, 3, 4)
WHERE m.public_reference = 'msg_demo_seed_event1'
  AND NOT EXISTS (SELECT 1 FROM message_recipients);
