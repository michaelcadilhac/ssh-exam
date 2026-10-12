ALTER TABLE attempts ADD COLUMN functional_test INTEGER NOT NULL DEFAULT 0;
INSERT INTO schema_version(version) VALUES(4);
