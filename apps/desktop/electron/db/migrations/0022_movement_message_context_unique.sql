-- 同一流转动作版本只产生一条站内 MOVEMENT 通知。
-- 正式库可能已经存在并发重复，先保留最小 id；messages 子表通过级联一并清理。
-- 仅处理 MOVEMENT，上下文为空或其它 context_type 不受影响。
DELETE FROM messages
WHERE context_type='MOVEMENT'
  AND context_reference IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id)
    FROM messages
    WHERE context_type='MOVEMENT' AND context_reference IS NOT NULL
    GROUP BY context_reference
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_movement_context
  ON messages(context_type,context_reference)
  WHERE context_type='MOVEMENT' AND context_reference IS NOT NULL;
