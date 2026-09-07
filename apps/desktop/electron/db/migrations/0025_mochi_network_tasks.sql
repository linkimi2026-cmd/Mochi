-- Mochi 网络二期：从「传话」升级为「派任务」（agent-to-agent 任务委托）。
-- 场景：我对 Mochi 说「帮我找一下李老师的期中卷子」——我的 Mochi 先查
-- 本校资源登记，没查到就把寻物请求投给李老师的 Mochi；李老师的 Mochi
-- 在主人登记的东西里翻找，替主人把回话预填好，主人一键确认后回传。
-- 仍是 A2A（github.com/a2aproject/A2A，Apache-2.0）的校园最小实现：
--   1. agent 之间不互读内部状态——寻物结果只能来自对方「自愿登记」的
--      共享资源表，登记本身就是同意被找的边界；
--   2. 投递的仍是有界文本（body/item ≤ 200/64 字），不触碰学生数据；
--   3. 是否应答仍由收件方主人决定，Mochi 只能预填、不能代答。
ALTER TABLE mochi_relay_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message' CHECK(kind IN ('message','request'));
ALTER TABLE mochi_relay_messages ADD COLUMN item TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS mochi_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mochi_resources_owner ON mochi_resources(owner_user_id, id);
