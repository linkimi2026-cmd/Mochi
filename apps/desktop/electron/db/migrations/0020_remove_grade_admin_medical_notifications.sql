-- 安全边界修复：年级负责人只接收班级级 GRADE_ALERT。
-- 旧版本可能已经为学生医务/流转消息写入了年级负责人收件人和推送任务；
-- 删除这些历史接收关系与任务，但保留 GRADE_ALERT 及其任务不变。
DELETE FROM notification_jobs
WHERE recipient_user_id IN (
  SELECT id FROM users WHERE role='GRADE_ADMIN'
)
AND message_id IN (
  SELECT id FROM messages WHERE COALESCE(context_type,'') <> 'GRADE_ALERT'
);

DELETE FROM message_recipients
WHERE recipient_user_id IN (
  SELECT id FROM users WHERE role='GRADE_ADMIN'
)
AND message_id IN (
  SELECT id FROM messages WHERE COALESCE(context_type,'') <> 'GRADE_ALERT'
);
