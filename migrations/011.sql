CREATE TABLE attempt_interruptions(
  id TEXT PRIMARY KEY,
  attempt TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  opened INTEGER,
  generation INTEGER NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  authorizations TEXT NOT NULL DEFAULT '[]',
  ended INTEGER,
  outcome TEXT,
  historical INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_open_interruption ON attempt_interruptions(attempt) WHERE outcome IS NULL;
CREATE INDEX interruption_attempt ON attempt_interruptions(attempt,opened);
INSERT INTO schema_version(version) VALUES(11);
-- Retention also works when rolling back to a server that does not know this table.
CREATE TRIGGER IF NOT EXISTS erase_interruption_history AFTER INSERT ON tombstones
BEGIN
  DELETE FROM attempt_interruptions WHERE attempt=NEW.attempt;
END;
CREATE TRIGGER IF NOT EXISTS erase_interruption_history_update AFTER UPDATE ON tombstones
BEGIN
  DELETE FROM attempt_interruptions WHERE attempt=NEW.attempt;
END;
