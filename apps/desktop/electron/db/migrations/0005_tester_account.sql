INSERT OR IGNORE INTO users (
  id, username, password_hash, password_salt, name, role, grade_scope,
  active, must_change_password, identity_verified_at, verified_by
) VALUES (
  6, 'tester', 'V4J4MHXVvxNXfkCagcu6KG_YL3Vyk6vv9dOWkIhM16o',
  'L493KkIPNJnQ67f-pqYEew', '演示测试员', 'HEAD_TEACHER', '七年级',
  1, 0, CURRENT_TIMESTAMP, 5
);

INSERT OR IGNORE INTO teacher_class_roles (user_id, class_id, relation)
VALUES (6, 2, 'HEAD_TEACHER');

INSERT INTO audit_logs (user_id, action, target_type, target_id, detail)
SELECT 5, 'CREATE_DEMO_ACCOUNT', 'user', '6', '建立独立演示测试员账号'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_logs WHERE action='CREATE_DEMO_ACCOUNT' AND target_type='user' AND target_id='6'
);
