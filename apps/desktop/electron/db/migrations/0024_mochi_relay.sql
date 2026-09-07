-- Mochi 网络：六端用户各自的 Mochi 之间互相传话。
-- 设计灵感来自 Google 发起、Linux 基金会托管的开放 Agent2Agent 协议
-- （github.com/a2aproject/A2A，Apache-2.0）：agent 之间互不暴露内部
-- 状态，只交换有界的结构化消息。这里是它的校园最小实现：
--   1. 传话只在本校用户之间经服务器投递，不会发给任何外部服务；
--   2. 只投递一句有界文本（body），不触碰任何学生数据；
--   3. status 状态机 pending -> accepted / declined，由收件方主人决定，
--      任何一方的 Mochi 都不能代替主人应答。
CREATE TABLE IF NOT EXISTS mochi_relay_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
  reply TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mochi_relay_to ON mochi_relay_messages(to_user_id, status, id);
CREATE INDEX IF NOT EXISTS idx_mochi_relay_from ON mochi_relay_messages(from_user_id, status, id);
