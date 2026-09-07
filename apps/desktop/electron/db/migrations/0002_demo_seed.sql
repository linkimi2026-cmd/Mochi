INSERT INTO classes (id, grade, name) VALUES
  (1, '七年级', '七年级1班'),
  (2, '七年级', '七年级2班'),
  (3, '八年级', '八年级1班'),
  (4, '八年级', '八年级2班');

INSERT INTO users (id, username, password_hash, password_salt, name, role, grade_scope) VALUES
  (1, 'xiaoyi', 'SlPZpfShn4Thdqp8yDDfPDM3htu5hjahinBKQkR4D78', 'xnegGi2xKhrsLE7NVgg8Eg', '周宁老师', 'NURSE', NULL),
  (2, 'banzhuren', 'eMG_iPhHQnyBhP9BJyJbylNNkg1TNz6rBtMQkuDO3Gc', '-0MFK8E62QRX4duyU9unNg', '林清老师', 'HEAD_TEACHER', '七年级'),
  (3, 'renke', 'lk8eD8ufNYAt0gAoN3A7mQACixChCGk-nE88SX2O3nA', 'jpcumFMO8G45N7lHZFI_FA', '顾言老师', 'SUBJECT_TEACHER', '七年级'),
  (4, 'nianji', 'LPjNomol3lfntmEsSis64jZf94QYiptpfDgEoq20Nds', 'lHhcUGCRt1VlRN0yIlJ51g', '陈序老师', 'GRADE_ADMIN', '七年级'),
  (5, 'admin', 'od_iAtndTxC6RpJ3EBkh0vietC1LwNk7z1_gpG4Gdm8', 'I99eLeRXMGX-uyLtneO4Gg', '系统管理员', 'ADMIN', NULL);

INSERT INTO teacher_class_roles (user_id, class_id, relation) VALUES
  (2, 1, 'HEAD_TEACHER'),
  (3, 1, 'SUBJECT_TEACHER'),
  (3, 2, 'SUBJECT_TEACHER');

INSERT INTO students (id, code, name, gender, class_id) VALUES
  (1, 'DEMO001', '林小禾', '女', 1), (2, 'DEMO002', '周星遥', '男', 2),
  (3, 'DEMO003', '陈言蹊', '女', 1), (4, 'DEMO004', '顾书宁', '男', 2),
  (5, 'DEMO005', '苏清越', '女', 1), (6, 'DEMO006', '沈舒言', '男', 2),
  (7, 'DEMO007', '叶知夏', '女', 1), (8, 'DEMO008', '陆可心', '男', 2),
  (9, 'DEMO009', '江安然', '女', 1), (10, 'DEMO010', '许予安', '男', 2),
  (11, 'DEMO011', '唐南乔', '女', 1), (12, 'DEMO012', '温明川', '男', 2),
  (13, 'DEMO013', '宋一诺', '女', 1), (14, 'DEMO014', '秦嘉木', '男', 2),
  (15, 'DEMO015', '简乐知', '女', 1), (16, 'DEMO016', '夏景行', '男', 2),
  (17, 'DEMO017', '林知夏', '女', 3), (18, 'DEMO018', '周明川', '男', 4),
  (19, 'DEMO019', '陈嘉木', '女', 3), (20, 'DEMO020', '顾安然', '男', 4),
  (21, 'DEMO021', '苏书宁', '女', 3), (22, 'DEMO022', '沈一诺', '男', 4),
  (23, 'DEMO023', '叶南乔', '女', 3), (24, 'DEMO024', '陆景行', '男', 4);

INSERT INTO card_identifiers (student_id, identifier) VALUES
  (1, 'CARD-DEMO-0001'), (2, 'CARD-DEMO-0002'), (3, 'CARD-DEMO-0003'),
  (4, 'CARD-DEMO-0004'), (5, 'CARD-DEMO-0005'), (6, 'CARD-DEMO-0006'),
  (7, 'CARD-DEMO-0007'), (8, 'CARD-DEMO-0008'), (9, 'CARD-DEMO-0009'),
  (10, 'CARD-DEMO-0010'), (11, 'CARD-DEMO-0011'), (12, 'CARD-DEMO-0012'),
  (13, 'CARD-DEMO-0013'), (14, 'CARD-DEMO-0014'), (15, 'CARD-DEMO-0015'),
  (16, 'CARD-DEMO-0016'), (17, 'CARD-DEMO-0017'), (18, 'CARD-DEMO-0018'),
  (19, 'CARD-DEMO-0019'), (20, 'CARD-DEMO-0020'), (21, 'CARD-DEMO-0021'),
  (22, 'CARD-DEMO-0022'), (23, 'CARD-DEMO-0023'), (24, 'CARD-DEMO-0024');

INSERT INTO health_events (id, student_id, category, urgency, measure, status, note, identity_verified, visited_at, created_by, created_at, updated_at) VALUES
  (1, 1, '身体不适', '需关注', '休息观察', '留观中', '仅作演示：已安排安静休息，稍后复查。', 1, datetime('now','-38 minutes'), 1, datetime('now','-38 minutes'), datetime('now','-38 minutes')),
  (2, 5, '轻微外伤', '普通', '基础处理', '准备返班', '仅作演示：已完成基础处理。', 1, datetime('now','-92 minutes'), 1, datetime('now','-92 minutes'), datetime('now','-92 minutes')),
  (3, 9, '常规测量', '普通', '初步检查', '记录结束', '仅作演示：常规记录，无真实健康数据。', 1, datetime('now','-1 day'), 1, datetime('now','-1 day'), datetime('now','-1 day')),
  (4, 3, '运动不适', '普通', '休息观察', '已返班', '仅作演示：休息后状态平稳。', 1, datetime('now','-2 days'), 1, datetime('now','-2 days'), datetime('now','-2 days')),
  (5, 17, '情绪关怀', '需关注', '联系教师', '已通知教师', '仅作演示：已请班主任关注。', 1, datetime('now','-3 days'), 1, datetime('now','-3 days'), datetime('now','-3 days'));

INSERT INTO in_app_notifications (user_id, event_id, title, body, level, created_at) VALUES
  (2, 1, '新的学生医务事件', '您负责的班级有一条新的医务事件，请登录查看。', '需关注', datetime('now','-38 minutes')),
  (3, 1, '新的学生医务事件', '您负责的班级有一条新的医务事件，请登录查看。', '需关注', datetime('now','-38 minutes')),
  (4, 1, '新的学生医务事件', '您负责的年级有一条新的医务事件，请登录查看。', '需关注', datetime('now','-38 minutes'));

INSERT INTO system_settings (key, value) VALUES
  ('card_prefix', ''), ('card_suffix', ''), ('card_timeout_ms', '80'),
  ('repush_after_minutes', '3'), ('escalate_after_minutes', '5'),
  ('retention_days', '180'), ('notification_rule', 'HEAD_AND_SUBJECT');

INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, created_at) VALUES
  (1, 'CREATE_EVENT', 'health_event', '1', '创建了一条虚拟到访记录', datetime('now','-38 minutes')),
  (5, 'EXPORT_BACKUP', 'system', 'demo', '导出演示数据备份', datetime('now','-1 day'));
