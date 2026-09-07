-- 消息软删除与用户级自动清理偏好
-- 设计：deleted_at 仅写在已读(read_at IS NOT NULL)的 per-recipient 行上；
-- 未读行天然不被触碰，未读存储/计数/显示零影响。messages 主表与 message_events 保留作回执凭证。

-- 1) 软删除标记：让已查看消息从用户消息中心消失，后台保留 30 天后由 Cron 彻底清理
ALTER TABLE message_recipients ADD COLUMN deleted_at TEXT;

-- 覆盖角标计数与列表过滤的主查询路径
CREATE INDEX idx_recipients_user_deleted_read
  ON message_recipients(recipient_user_id, deleted_at, read_at);

-- 2) 用户级偏好：自动清理策略（关闭 / 即时 / 延迟 1-30 分钟）
CREATE TABLE user_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_delete_mode TEXT NOT NULL DEFAULT 'off'
    CHECK(auto_delete_mode IN ('off','instant','delayed')),
  auto_delete_delay_minutes INTEGER NOT NULL DEFAULT 5
    CHECK(auto_delete_delay_minutes BETWEEN 1 AND 30),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
