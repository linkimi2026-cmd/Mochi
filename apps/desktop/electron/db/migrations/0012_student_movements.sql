-- 嘉行联 V1：平台无关的学生跨区域闭环。全部为 additive migration，避免重建现有用户表。
CREATE TABLE movement_station_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area TEXT NOT NULL CHECK(area IN ('DORMITORY','INFIRMARY')),
  label TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, area)
);

CREATE TABLE student_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_reference TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  origin TEXT NOT NULL CHECK(origin IN ('CLASSROOM','DORMITORY','INFIRMARY')),
  destination TEXT NOT NULL CHECK(destination IN ('DORMITORY','INFIRMARY')),
  status TEXT NOT NULL CHECK(status IN ('OUTBOUND','ARRIVED','RETURNING','CLOSED','CANCELLED')),
  reason_category TEXT NOT NULL,
  approved_by INTEGER NOT NULL REFERENCES users(id),
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  departed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_arrival_at TEXT NOT NULL,
  arrived_at TEXT,
  arrival_confirmed_by INTEGER REFERENCES users(id),
  left_destination_at TEXT,
  departure_confirmed_by INTEGER REFERENCES users(id),
  expected_return_at TEXT,
  returned_at TEXT,
  return_confirmed_by INTEGER REFERENCES users(id),
  arrival_overdue_at TEXT,
  return_overdue_at TEXT,
  medical_event_id INTEGER REFERENCES health_events(id) ON DELETE SET NULL,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  cancellation_reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  last_action_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(created_by, idempotency_key)
);

CREATE TABLE movement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_id INTEGER NOT NULL REFERENCES student_movements(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'APPROVED','ARRIVED','LEFT_DESTINATION','RETURN_CONFIRMED','CANCELLED',
    'ARRIVAL_OVERDUE','RETURN_OVERDUE','MEDICAL_LINKED'
  )),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  from_status TEXT,
  to_status TEXT,
  note TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_movements_one_active_per_student
  ON student_movements(student_id)
  WHERE status IN ('OUTBOUND','ARRIVED','RETURNING');
CREATE INDEX idx_movements_status_destination
  ON student_movements(status,destination,expected_arrival_at,expected_return_at);
CREATE INDEX idx_movements_student_created
  ON student_movements(student_id,created_at DESC);
CREATE INDEX idx_movements_approver_status
  ON student_movements(approved_by,status,updated_at DESC);
CREATE INDEX idx_movement_events_movement_time
  ON movement_events(movement_id,occurred_at ASC);
CREATE INDEX idx_station_assignments_area_active
  ON movement_station_assignments(area,active,user_id);
