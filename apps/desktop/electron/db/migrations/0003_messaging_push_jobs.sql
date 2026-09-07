ALTER TABLE push_subscriptions ADD COLUMN operating_system TEXT NOT NULL DEFAULT '未知';
ALTER TABLE push_subscriptions ADD COLUMN browser TEXT NOT NULL DEFAULT '未知';
ALTER TABLE push_subscriptions ADD COLUMN last_verified_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_failure_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_reference TEXT NOT NULL UNIQUE,
  medical_event_id INTEGER REFERENCES health_events(id) ON DELETE CASCADE,
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL CHECK(message_type IN ('SYSTEM','NURSE_NOTE','TEACHER_REPLY','QUICK_REPLY','STATUS_UPDATE','DEVICE_TEST')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  withdrawn_at TEXT
);

CREATE TABLE message_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_role TEXT NOT NULL,
  delivered_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivered_state IN ('pending','accepted','failed','expired','opened','read','acknowledged','overdue','escalated')),
  opened_at TEXT,
  read_at TEXT,
  acknowledged_at TEXT,
  acknowledged_role TEXT,
  acknowledged_device TEXT,
  acknowledgement_note TEXT,
  UNIQUE(message_id, recipient_user_id)
);

CREATE TABLE notification_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','accepted','retry','failed','expired','cancelled')),
  locked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE notification_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_job_id INTEGER NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  response_code INTEGER,
  result TEXT NOT NULL,
  error_category TEXT,
  error_detail_sanitized TEXT
);

CREATE TABLE message_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  device_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_event_created ON messages(medical_event_id, created_at ASC);
CREATE INDEX idx_messages_reference ON messages(public_reference);
CREATE INDEX idx_recipients_user_state ON message_recipients(recipient_user_id, delivered_state, message_id);
CREATE INDEX idx_recipients_message ON message_recipients(message_id, recipient_user_id);
CREATE INDEX idx_jobs_due ON notification_jobs(status, scheduled_at, locked_at);
CREATE INDEX idx_jobs_subscription ON notification_jobs(subscription_id, status);
CREATE INDEX idx_attempts_job ON notification_attempts(notification_job_id, started_at DESC);
CREATE INDEX idx_message_events_message ON message_events(message_id, occurred_at DESC);

INSERT INTO system_settings (key, value) VALUES
  ('normal_repush_minutes', '5'), ('normal_overdue_minutes', '10'),
  ('attention_repush_minutes', '3'), ('attention_escalate_minutes', '5'),
  ('emergency_repush_minutes', '1'), ('emergency_escalate_minutes', '3'),
  ('push_failure_threshold', '3');
