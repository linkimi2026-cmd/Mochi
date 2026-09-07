CREATE TABLE IF NOT EXISTS user_notification_onboarding (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('complete', 'skipped')),
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO user_notification_onboarding (user_id, status)
SELECT DISTINCT user_id, 'complete'
FROM push_subscriptions
WHERE status = 'active' AND disabled_at IS NULL;
