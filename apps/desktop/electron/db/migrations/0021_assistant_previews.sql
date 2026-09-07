-- 助手放行预览是服务端待确认状态：同一账号只保留最新一张，
-- token 只存 SHA-256 摘要，避免浏览器内存状态成为唯一安全边界。
CREATE TABLE assistant_previews (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  destination TEXT NOT NULL CHECK(destination IN ('DORMITORY','INFIRMARY')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX idx_assistant_previews_pending
  ON assistant_previews(expires_at, consumed_at, user_id);
