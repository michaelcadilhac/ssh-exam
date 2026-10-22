-- Additive metadata only. No exam/enrollment/grant/attempt/history mutation.
-- No cascading FK: historical source attestations outlive a current definition.
CREATE TABLE agent_template_versions (
  agent TEXT NOT NULL,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  entries INTEGER NOT NULL,
  files INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  max_file_bytes INTEGER NOT NULL,
  first_native_created INTEGER NOT NULL,
  last_native_created INTEGER NOT NULL,
  first_acknowledged_at INTEGER NOT NULL,
  last_attested_at INTEGER NOT NULL,
  last_acknowledged_at INTEGER NOT NULL,
  last_request TEXT NOT NULL,
  PRIMARY KEY(agent, name, hash)
);
INSERT INTO schema_version VALUES(20);
