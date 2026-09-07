-- TODO_D1_DELTA: D1 在每文件迁移时执行此 PRAGMA；better-sqlite3 中 PRAGMA foreign_keys 不能靠
--   db.exec() 跨语句持久，必须在「打开每个连接时」用 db.pragma('foreign_keys = ON') 设置
--   （已在 electron/db/migrator.ts 与 db/index.ts 的 openDb 中处理）。此行保留以对齐 D1 语义，
--   在 better-sqlite3 下为 no-op / 不保证生效，真正的开关由连接层负责。
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('NURSE','HEAD_TEACHER','SUBJECT_TEACHER','GRADE_ADMIN','ADMIN')),
  grade_scope TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE teacher_class_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('HEAD_TEACHER','SUBJECT_TEACHER','BACKUP')),
  UNIQUE(user_id, class_id, relation)
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '未设置',
  class_id INTEGER NOT NULL REFERENCES classes(id),
  guardian_hint TEXT NOT NULL DEFAULT '演示监护人（已脱敏）',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE card_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL UNIQUE,
  adapter_type TEXT NOT NULL DEFAULT 'KEYBOARD_WEDGE',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE health_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  category TEXT NOT NULL,
  urgency TEXT NOT NULL CHECK(urgency IN ('普通','需关注','紧急')),
  measure TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL,
  identity_verified INTEGER NOT NULL DEFAULT 0,
  visited_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  archived_at TEXT
);

CREATE TABLE acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES health_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT,
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, user_id)
);

CREATE TABLE in_app_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES health_events(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT '普通',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_name TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TEXT,
  disabled_at TEXT,
  failure_reason TEXT
);

CREATE TABLE push_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES health_events(id) ON DELETE SET NULL,
  initiated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  target_users INTEGER NOT NULL DEFAULT 0,
  target_devices INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  ip_hint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_key TEXT NOT NULL,
  succeeded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_active_role ON users(active, role);
CREATE INDEX idx_teacher_class_user ON teacher_class_roles(user_id, class_id);
CREATE INDEX idx_teacher_class_class ON teacher_class_roles(class_id, relation);
CREATE INDEX idx_students_class_active ON students(class_id, active);
CREATE INDEX idx_students_name ON students(name);
CREATE INDEX idx_cards_identifier_active ON card_identifiers(identifier, active);
CREATE INDEX idx_events_student_visited ON health_events(student_id, visited_at DESC);
CREATE INDEX idx_events_status_visited ON health_events(status, visited_at DESC);
CREATE INDEX idx_events_archived_visited ON health_events(archived_at, visited_at DESC);
CREATE INDEX idx_ack_event_user ON acknowledgements(event_id, user_id);
CREATE INDEX idx_notifications_user_read ON in_app_notifications(user_id, read_at, created_at DESC);
CREATE INDEX idx_push_user_active ON push_subscriptions(user_id, disabled_at);
CREATE INDEX idx_push_logs_created ON push_logs(created_at DESC);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_user_created ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_sessions_hash_expiry ON sessions(token_hash, expires_at);
CREATE INDEX idx_login_attempts_key_time ON login_attempts(attempt_key, created_at DESC);
