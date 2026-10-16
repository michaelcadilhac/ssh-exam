ALTER TABLE attempts ADD COLUMN focus_lost_at INTEGER;
INSERT INTO schema_version VALUES(8);
