-- Historical preflight opening times were not recorded; do not invent them.
ALTER TABLE attempts ADD COLUMN preflight_started_at INTEGER;
INSERT INTO schema_version(version) VALUES(10);
