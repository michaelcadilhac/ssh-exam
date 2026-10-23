-- Existing implicit material starters remain null. Only independent sources
-- need the added binding; preserve every historical setting/hash/claim.
ALTER TABLE attempts ADD COLUMN grant_work TEXT;
CREATE TRIGGER immutable_grant_work BEFORE UPDATE ON attempts
WHEN NEW.grant_work IS NOT OLD.grant_work
BEGIN SELECT RAISE(ABORT,'Prepared workspace source is immutable'); END;
CREATE TRIGGER known_grant_workspace BEFORE INSERT ON attempts
WHEN NEW.grant_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'Exact prepared workspace source required; update matching grant writers')
 WHERE NOT EXISTS(SELECT 1 FROM grant_revisions r WHERE r.grant_id=NEW.grant_id
 AND r.revision=NEW.grant_revision AND r.hash=NEW.grant_hash
 AND NEW.grant_work IS CASE WHEN json_extract(r.work,'$.kind')='template'
 AND json_extract(r.work,'$.name')=json_extract(r.settings,'$.template')
 AND json_extract(r.work,'$.hash')=json_extract(r.settings,'$.template_version')
 THEN NULL ELSE r.work END);
END;
INSERT INTO schema_version VALUES(26);
