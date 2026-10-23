-- Preserve legacy history; once practice issuance activates sandbox's grant
-- mode, no older gateway can insert another grantless practice preparation.
DROP TRIGGER known_grant_requires_claim;
CREATE TRIGGER known_grant_requires_claim BEFORE INSERT ON attempts
WHEN EXISTS(SELECT 1 FROM attempt_grants g WHERE g.exam=NEW.exam AND g.username=NEW.username)
BEGIN
 SELECT RAISE(ABORT,'Grant-aware preparation required; update matching gateway/native roles')
 WHERE NOT EXISTS(SELECT 1 FROM attempt_grants g JOIN grant_claims c ON c.grant_id=g.id
 WHERE g.id=NEW.grant_id AND g.exam=NEW.exam AND g.username=NEW.username
 AND g.status='AVAILABLE' AND g.revision=NEW.grant_revision AND c.attempt=NEW.id
 AND c.revision=NEW.grant_revision AND c.hash=NEW.grant_hash AND c.state='PREPARING'
 AND NEW.grant_kind IS (CASE g.issuance WHEN 'ADDITIONAL_TEMPLATE' THEN 'ADDITIONAL' WHEN 'PRACTICE' THEN 'PRACTICE' ELSE NULL END)
 AND NEW.grant_issued_order=g.rowid AND NEW.grant_initial IS g.initial_grant);
END;
CREATE TRIGGER sandbox_grant_mode_requires_claim BEFORE INSERT ON attempts
WHEN NEW.exam='sandbox' AND NEW.grant_id IS NULL
 AND NEW.state IN ('PREPARING','ACTIVATING','ACTIVE','LOCKED')
 AND EXISTS(SELECT 1 FROM grant_exam_modes WHERE exam='sandbox')
BEGIN SELECT RAISE(ABORT,'Saved practice grant required; update matching gateway/native roles'); END;
INSERT INTO schema_version VALUES(27);
