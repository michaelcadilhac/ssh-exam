-- Notification episodes survive SMTP delivery and process restart. No attempt FK:
-- cancelled preparation retirement must retain the operational audit history.
CREATE TABLE alert_episodes(
  id TEXT PRIMARY KEY,
  attempt TEXT NOT NULL,
  event TEXT NOT NULL,
  generation INTEGER NOT NULL,
  cause TEXT NOT NULL,
  opened INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  resolved INTEGER,
  outbox TEXT NOT NULL REFERENCES outbox(id)
);
CREATE UNIQUE INDEX alert_episode_open ON alert_episodes(attempt,event,generation)
  WHERE resolved IS NULL;
INSERT INTO schema_version(version) VALUES(12);
