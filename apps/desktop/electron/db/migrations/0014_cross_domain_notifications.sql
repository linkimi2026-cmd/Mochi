-- 平台中立消息上下文：继续复用同一消息中心和推送队列，不为嘉行联复制消息系统。
ALTER TABLE messages ADD COLUMN context_type TEXT;
ALTER TABLE messages ADD COLUMN context_reference TEXT;
ALTER TABLE messages ADD COLUMN navigate_path TEXT;
ALTER TABLE messages ADD COLUMN context_severity TEXT NOT NULL DEFAULT '普通';
CREATE INDEX idx_messages_context ON messages(context_type,context_reference,created_at DESC);

CREATE TABLE dorm_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_reference TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  movement_id INTEGER REFERENCES student_movements(id) ON DELETE SET NULL,
  incident_type TEXT NOT NULL CHECK(incident_type IN ('UNAPPROVED_ARRIVAL','LATE_ARRIVAL')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  note TEXT NOT NULL DEFAULT '',
  reported_by INTEGER NOT NULL REFERENCES users(id),
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  resolution_note TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reported_by,idempotency_key)
);
CREATE INDEX idx_dorm_incidents_status_time ON dorm_incidents(status,occurred_at DESC);
CREATE INDEX idx_dorm_incidents_student_time ON dorm_incidents(student_id,occurred_at DESC);
