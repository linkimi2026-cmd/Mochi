-- 助手多轮会话记忆：同一账号只保留最近一次执行的规划摘要（工具名、校验过
-- 的参数、已解析的学生/班级实体），绝不存用户消息原文。10 分钟 TTL 由读取
-- 侧判定；写入侧惰性清理一天前的旧行。
CREATE TABLE assistant_sessions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  context_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_assistant_sessions_updated
  ON assistant_sessions(updated_at);
