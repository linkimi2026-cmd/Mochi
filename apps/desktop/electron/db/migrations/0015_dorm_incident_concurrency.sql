ALTER TABLE dorm_incidents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dorm_incidents ADD COLUMN last_action_key TEXT;
