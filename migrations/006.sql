CREATE TABLE IF NOT EXISTS agent_snapshot(agent TEXT PRIMARY KEY, sequence INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_events(agent TEXT NOT NULL, sequence INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(agent,sequence));
CREATE TABLE IF NOT EXISTS agent_attempt_sequence(attempt TEXT PRIMARY KEY, sequence INTEGER NOT NULL);
INSERT INTO schema_version VALUES(6);
