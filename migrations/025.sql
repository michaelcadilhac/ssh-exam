-- Run with foreign keys temporarily disabled by the migration transaction,
-- then verify every FK before commit. Preserve all initial/revision/claim data.
DROP TRIGGER activate_initial_grant_mode;
DROP TRIGGER initial_grant_before_new_enrollment;
DROP TRIGGER known_grant_requires_claim;
DROP TRIGGER immutable_grant_preparation;
CREATE TABLE attempt_grants_next (
 id TEXT PRIMARY KEY, agent TEXT NOT NULL, exam TEXT NOT NULL REFERENCES exams(id),
 username TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL,
 issued_at INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
 issuance TEXT NOT NULL DEFAULT 'ENROLLMENT',
 initial_grant TEXT REFERENCES attempt_grants(id)
);
INSERT INTO attempt_grants_next(rowid,id,agent,exam,username,revision,status,issued_at,actor,reason,issuance)
 SELECT rowid,id,agent,exam,username,revision,status,issued_at,actor,reason,issuance FROM attempt_grants;
DROP TABLE attempt_grants;
ALTER TABLE attempt_grants_next RENAME TO attempt_grants;
CREATE UNIQUE INDEX initial_grant_once ON attempt_grants(agent,exam,username)
 WHERE issuance IN ('ENROLLMENT','REVIEWED_NEW');
ALTER TABLE attempts ADD COLUMN grant_kind TEXT;
ALTER TABLE attempts ADD COLUMN grant_issued_order INTEGER;
ALTER TABLE attempts ADD COLUMN grant_initial TEXT;
DROP INDEX ordinary_exam_once;
CREATE UNIQUE INDEX ordinary_exam_once ON attempts(exam,username)
 WHERE exam<>'sandbox' AND grant_id IS NULL;
CREATE TRIGGER activate_initial_grant_mode AFTER INSERT ON attempt_grants
BEGIN INSERT OR IGNORE INTO grant_exam_modes VALUES(NEW.exam,NEW.issued_at); END;
CREATE TRIGGER initial_grant_before_new_enrollment BEFORE INSERT ON enrollments
WHEN NEW.exam<>'sandbox'
 AND EXISTS(SELECT 1 FROM grant_exam_modes WHERE exam=NEW.exam)
 AND NOT EXISTS(SELECT 1 FROM enrollments WHERE exam=NEW.exam AND username=NEW.username)
 AND NOT EXISTS(SELECT 1 FROM attempts WHERE exam=NEW.exam AND username=NEW.username)
 AND NOT EXISTS(SELECT 1 FROM attempt_grants WHERE exam=NEW.exam AND username=NEW.username)
BEGIN SELECT RAISE(ABORT,'New enrollment requires atomic initial grant issuance; update matching gateway writers'); END;
CREATE TRIGGER known_grant_requires_claim BEFORE INSERT ON attempts
WHEN EXISTS(SELECT 1 FROM attempt_grants g WHERE g.exam=NEW.exam AND g.username=NEW.username)
BEGIN
 SELECT RAISE(ABORT,'Grant-aware preparation required; update matching gateway/native roles')
 WHERE NOT EXISTS(SELECT 1 FROM attempt_grants g JOIN grant_claims c ON c.grant_id=g.id
 WHERE g.id=NEW.grant_id AND g.exam=NEW.exam AND g.username=NEW.username
 AND g.status='AVAILABLE' AND g.revision=NEW.grant_revision AND c.attempt=NEW.id
 AND c.revision=NEW.grant_revision AND c.hash=NEW.grant_hash AND c.state='PREPARING'
 AND NEW.grant_kind IS (CASE WHEN g.issuance='ADDITIONAL_TEMPLATE' THEN 'ADDITIONAL' ELSE NULL END)
 AND NEW.grant_issued_order=g.rowid AND NEW.grant_initial IS g.initial_grant);
END;
CREATE TRIGGER immutable_grant_preparation BEFORE UPDATE ON attempts
WHEN OLD.grant_id IS NOT NULL AND
 (NEW.grant_id IS NOT OLD.grant_id OR NEW.grant_revision IS NOT OLD.grant_revision OR
 NEW.grant_hash IS NOT OLD.grant_hash OR NEW.settings IS NOT OLD.settings OR
 NEW.grant_kind IS NOT OLD.grant_kind OR NEW.grant_issued_order IS NOT OLD.grant_issued_order OR
 NEW.grant_initial IS NOT OLD.grant_initial)
BEGIN SELECT RAISE(ABORT,'Prepared grant binding/settings are immutable'); END;
INSERT INTO schema_version VALUES(25);
