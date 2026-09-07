UPDATE users SET password_hash='T13UzeXRWcfRJsB6_5hXjGqSSdP936UfKX8QbKaNhu0', updated_at=CURRENT_TIMESTAMP WHERE username='xiaoyi';
UPDATE users SET password_hash='-LaxbJOL_Yj53R_WzOpOvmi4OlCAupqpT32VR4N97PI', updated_at=CURRENT_TIMESTAMP WHERE username='banzhuren';
UPDATE users SET password_hash='fYMogDC--phpVvPQrxEZcscrML2LTRDp3lDEbF1DNI0', updated_at=CURRENT_TIMESTAMP WHERE username='renke';
UPDATE users SET password_hash='1dKTaunuy0b6IGfS-v6ID7kAmmC-k_kTptUglrUQzV4', updated_at=CURRENT_TIMESTAMP WHERE username='nianji';
UPDATE users SET password_hash='xmWL-S0w0DNugZ1dKOedmld0VYh8cYIShk7AMHOUp38', updated_at=CURRENT_TIMESTAMP WHERE username='admin';
UPDATE users SET password_hash='hN65gPFp7yt-1XsSv-p9vcbDMTdmuKTkFnjR3UpRF_I', updated_at=CURRENT_TIMESTAMP WHERE username='tester';

INSERT INTO audit_logs (user_id, action, target_type, target_id, detail)
VALUES (5, 'MIGRATE_PASSWORD_HASH', 'system', 'cloudflare-pbkdf2', '将虚拟账号摘要迁移到Cloudflare兼容参数');
