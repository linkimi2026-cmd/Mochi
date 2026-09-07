-- 演示环境复用现有年级负责人账号作为“宿舍值班站”授权，不修改其基础角色。
INSERT OR IGNORE INTO movement_station_assignments (user_id,area,label)
SELECT id,'DORMITORY','演示宿舍值班站' FROM users WHERE username='nianji';
