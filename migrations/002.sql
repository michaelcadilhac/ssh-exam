ALTER TABLE attempts ADD COLUMN protected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN completed_at INTEGER;
ALTER TABLE attempts ADD COLUMN collected_at INTEGER;
ALTER TABLE attempts ADD COLUMN secured_at INTEGER;
UPDATE attempts SET protected=1 WHERE state='COMPLETED' AND checksum IS NOT NULL;
INSERT INTO schema_version(version) VALUES(2);
