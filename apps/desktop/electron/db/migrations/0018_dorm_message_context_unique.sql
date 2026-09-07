-- 将旧版“升级阈值”改名为明确的逾期阈值。只迁移已有值，不向 API/UI 暴露旧语义。
INSERT OR IGNORE INTO system_settings (key,value,updated_by)
  SELECT 'attention_overdue_minutes',value,updated_by
  FROM system_settings WHERE key='attention_escalate_minutes';
INSERT OR IGNORE INTO system_settings (key,value,updated_by)
  SELECT 'emergency_overdue_minutes',value,updated_by
  FROM system_settings WHERE key='emergency_escalate_minutes';
INSERT OR IGNORE INTO system_settings (key,value)
  VALUES ('attention_overdue_minutes','5'),('emergency_overdue_minutes','3');
DELETE FROM system_settings WHERE key IN ('attention_escalate_minutes','emergency_escalate_minutes');

-- 同一宿舍异常事实只允许一条 DORM_INCIDENT 消息；正式库可能已有并发重复，
-- 保留最小 id，依赖 messages 子表的 ON DELETE CASCADE 清理对应收件人/任务/事件。
-- 其它消息上下文、其它 context_type 均不参与删除。
DELETE FROM messages
WHERE id IN (
  SELECT duplicate.id
  FROM messages AS duplicate
  JOIN (
    SELECT context_reference, MIN(id) AS retained_id
    FROM messages
    WHERE context_type='DORM_INCIDENT' AND context_reference IS NOT NULL
    GROUP BY context_reference
  ) AS retained
    ON retained.context_reference=duplicate.context_reference
  WHERE duplicate.context_type='DORM_INCIDENT'
    AND duplicate.context_reference IS NOT NULL
    AND duplicate.id<>retained.retained_id
);

CREATE UNIQUE INDEX idx_messages_dorm_incident_context
  ON messages(context_type,context_reference)
  WHERE context_type='DORM_INCIDENT' AND context_reference IS NOT NULL;
