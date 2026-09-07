CREATE TABLE dorms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  grade TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE student_dorm_assignments (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  dorm_id INTEGER NOT NULL REFERENCES dorms(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_student_dorm_dorm ON student_dorm_assignments(dorm_id,student_id);

INSERT OR IGNORE INTO dorms (id,name,grade) VALUES
  (1,'七年级男生宿舍','七年级'),
  (2,'七年级女生宿舍','七年级'),
  (3,'八年级男生宿舍','八年级'),
  (4,'八年级女生宿舍','八年级');

-- 仅给 DEMO 开头的虚拟学生建立演示宿舍关系。
INSERT OR IGNORE INTO student_dorm_assignments (student_id,dorm_id)
SELECT s.id,
  CASE WHEN cl.grade='七年级' AND s.gender='男' THEN 1
       WHEN cl.grade='七年级' THEN 2
       WHEN cl.grade='八年级' AND s.gender='男' THEN 3 ELSE 4 END
FROM students s JOIN classes cl ON cl.id=s.class_id WHERE s.code LIKE 'DEMO%';
