UPDATE users
SET password_hash = 'wLJr40J3CFyaZfqcz0fc85MrEAjRrYuaL0yiDzNgXBo',
    must_change_password = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE username = 'tester';

INSERT INTO audit_logs (user_id, action, target_type, target_id, detail)
SELECT 5, 'REPAIR_DEMO_ACCOUNT', 'user', CAST(id AS TEXT), '修正演示测试员密码摘要'
FROM users
WHERE username = 'tester';
