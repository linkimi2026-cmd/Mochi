-- 嘉行联角色边界：宿舍工作人员不再由年级负责人兼任。
-- 旧 users.role 受早期 CHECK 约束限制。通过附加岗位档案扩展角色，避免重建
-- 核心账号表触发会话、设备和授权记录的级联删除。
CREATE TABLE user_role_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  effective_role TEXT NOT NULL CHECK(effective_role IN ('DORM_STAFF')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_role_profiles_effective_role
  ON user_role_profiles(effective_role, user_id);

-- 基础角色仅用于兼容旧约束；所有鉴权入口均读取 effective_role。
INSERT OR IGNORE INTO users (
  username,password_hash,password_salt,name,role,grade_scope,active,
  must_change_password,identity_verified_at,verified_by
) VALUES (
  'sushe','dLGIAFD_8y4XYejNBf6U_5Zqx1SoHKSL_T04ysu_3eQ',
  'jos4VSGM4PnhZTd04mCggQ','宿舍值班老师','SUBJECT_TEACHER','七年级',1,0,CURRENT_TIMESTAMP,5
);

INSERT OR REPLACE INTO user_role_profiles (user_id,effective_role,updated_at)
SELECT id,'DORM_STAFF',CURRENT_TIMESTAMP FROM users WHERE username='sushe';

DELETE FROM movement_station_assignments
WHERE user_id=(SELECT id FROM users WHERE username='nianji') AND area='DORMITORY';

INSERT OR IGNORE INTO movement_station_assignments (user_id,area,label)
SELECT id,'DORMITORY','七年级宿舍值班站' FROM users WHERE username='sushe';

INSERT INTO audit_logs (user_id,action,target_type,target_id,detail)
SELECT 5,'CREATE_DEMO_ACCOUNT','user',CAST(id AS TEXT),'建立独立宿舍工作人员演示账号'
FROM users WHERE username='sushe';
