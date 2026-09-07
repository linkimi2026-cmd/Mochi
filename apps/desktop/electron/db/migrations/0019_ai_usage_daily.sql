-- Workers AI quota counters. The two scope rows (one user, one global) are
-- reserved by one conditional INSERT statement in the route, so a request can
-- never consume only one side of the quota under concurrent D1 requests.
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  usage_date TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  PRIMARY KEY (usage_date, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_user_date
  ON ai_usage_daily(user_id, usage_date);
