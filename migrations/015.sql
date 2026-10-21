-- Explicit manual reminders never reset/deduplicate away an automatic episode.
-- These operational records contain no terminal/media payload or email body.
CREATE TABLE alert_reminders(
  outbox TEXT PRIMARY KEY REFERENCES outbox(id),
  episode TEXT NOT NULL REFERENCES alert_episodes(id),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX alert_reminders_episode ON alert_reminders(episode,created);
CREATE INDEX alert_episodes_outbox ON alert_episodes(outbox);
CREATE TABLE alert_management_requests(
  actor TEXT NOT NULL,
  request TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY(actor,request)
);
INSERT INTO schema_version(version) VALUES(15);
