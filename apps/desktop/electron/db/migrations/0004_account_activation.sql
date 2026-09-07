ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN identity_verified_at TEXT;
ALTER TABLE users ADD COLUMN verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE account_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invitations_user_expiry ON account_invitations(user_id, expires_at DESC);
CREATE INDEX idx_invitations_token_expiry ON account_invitations(token_hash, expires_at);

-- 每个演示角色使用不同密码，避免公开的统一弱密码。
UPDATE users SET password_hash='uWTz3eIv6BXKT_SnZO6bLbu3tiX4feuDSi3WJiBdcVI',password_salt='BraQ0RkeGNTLuGtnDjv-3A' WHERE username='xiaoyi';
UPDATE users SET password_hash='zdvwQiZLyL4sSxG3QtaTDmI72iF5K7_vnErrKmR8hLM',password_salt='OOVDtMcf9ICdGxZrY5icxg' WHERE username='banzhuren';
UPDATE users SET password_hash='Zi45yrlg925qTVe8ctMXkbpykZSHtJp8dBbtGYvXvTY',password_salt='x-l8vbP_sgs5Xsk-D6xCdw' WHERE username='renke';
UPDATE users SET password_hash='SXNYQ4ZJ_04UmJH9D8ntvfrffMoZyp2_gjsHFtiRv44',password_salt='BdoFx4_pTeXFqqqRLXR-Yw' WHERE username='nianji';
UPDATE users SET password_hash='0iM5t4HYsT-id_YqJLX66nExmYJVY-ns05cgqzBs5Vg',password_salt='YYGuA8-wWZUUww1NOm5bQA' WHERE username='admin';
UPDATE users SET identity_verified_at=CURRENT_TIMESTAMP,verified_by=5;
