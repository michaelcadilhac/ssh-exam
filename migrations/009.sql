ALTER TABLE attempts ADD COLUMN policy_state TEXT;
ALTER TABLE attempts ADD COLUMN policy_expires INTEGER;
ALTER TABLE attempts ADD COLUMN policy_error TEXT;
INSERT INTO schema_version(version) VALUES(9);
