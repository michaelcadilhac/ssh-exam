-- Initial ordinary grants only. No historical enrollment backfill, attempt
-- uniqueness relaxation, sandbox issuance, or student-record conversion.
CREATE TABLE attempt_grants (
 id TEXT PRIMARY KEY, agent TEXT NOT NULL, exam TEXT NOT NULL REFERENCES exams(id),
 username TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL,
 issued_at INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
 UNIQUE(agent,exam,username)
);
CREATE TABLE grant_revisions (
 grant_id TEXT NOT NULL REFERENCES attempt_grants(id), revision INTEGER NOT NULL,
 settings TEXT NOT NULL, work TEXT NOT NULL, hash TEXT NOT NULL,
 actor TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL,
 PRIMARY KEY(grant_id,revision)
);
-- First initial issuance activates the new-enrollment writer fence for this
-- exam. Existing legacy enrollments/history are deliberately not backfilled.
CREATE TABLE grant_exam_modes (
 exam TEXT PRIMARY KEY REFERENCES exams(id), activated_at INTEGER NOT NULL
);
CREATE TRIGGER activate_initial_grant_mode AFTER INSERT ON attempt_grants
BEGIN INSERT OR IGNORE INTO grant_exam_modes VALUES(NEW.exam,NEW.issued_at); END;
CREATE TRIGGER initial_grant_before_new_enrollment BEFORE INSERT ON enrollments
WHEN NEW.exam<>'sandbox'
 AND EXISTS(SELECT 1 FROM grant_exam_modes WHERE exam=NEW.exam)
 AND NOT EXISTS(SELECT 1 FROM enrollments WHERE exam=NEW.exam AND username=NEW.username)
 AND NOT EXISTS(SELECT 1 FROM attempts WHERE exam=NEW.exam AND username=NEW.username)
 AND NOT EXISTS(SELECT 1 FROM attempt_grants WHERE exam=NEW.exam AND username=NEW.username)
BEGIN SELECT RAISE(ABORT,'New enrollment requires atomic initial grant issuance; update matching gateway/CLI roles'); END;
CREATE TABLE grant_claims (
 attempt TEXT PRIMARY KEY, grant_id TEXT NOT NULL REFERENCES attempt_grants(id),
 revision INTEGER NOT NULL, hash TEXT NOT NULL, uid INTEGER NOT NULL, state TEXT NOT NULL,
 created_at INTEGER NOT NULL, ended_at INTEGER
);
CREATE UNIQUE INDEX grant_one_unresolved_claim ON grant_claims(grant_id)
 WHERE state IN ('PREPARING','BEGIN_PENDING','CONSUMED');
CREATE TABLE grant_begin_intents (
 id TEXT PRIMARY KEY, attempt TEXT NOT NULL UNIQUE REFERENCES grant_claims(attempt),
 transport TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
 verified_at INTEGER, start INTEGER, deadline INTEGER
);
CREATE TABLE grant_management_requests (
 actor TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL,
 result TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(actor,request)
);
ALTER TABLE attempts ADD COLUMN grant_id TEXT;
ALTER TABLE attempts ADD COLUMN grant_revision INTEGER;
ALTER TABLE attempts ADD COLUMN grant_hash TEXT;
ALTER TABLE attempts ADD COLUMN grant_begin_intent TEXT;
-- An old gateway cannot omit a known grant/claim and insert a legacy attempt.
CREATE TRIGGER known_grant_requires_claim BEFORE INSERT ON attempts
WHEN EXISTS(SELECT 1 FROM attempt_grants g WHERE g.exam=NEW.exam AND g.username=NEW.username)
BEGIN
 SELECT RAISE(ABORT,'Grant-aware preparation required; update matching gateway/native roles')
 WHERE NOT EXISTS(SELECT 1 FROM attempt_grants g JOIN grant_claims c ON c.grant_id=g.id
 WHERE g.id=NEW.grant_id AND g.exam=NEW.exam AND g.username=NEW.username
 AND g.status='AVAILABLE' AND g.revision=NEW.grant_revision AND c.attempt=NEW.id
 AND c.revision=NEW.grant_revision AND c.hash=NEW.grant_hash AND c.state='PREPARING');
END;
CREATE TRIGGER immutable_grant_preparation BEFORE UPDATE ON attempts
WHEN OLD.grant_id IS NOT NULL AND
 (NEW.grant_id IS NOT OLD.grant_id OR NEW.grant_revision IS NOT OLD.grant_revision OR
 NEW.grant_hash IS NOT OLD.grant_hash OR NEW.settings IS NOT OLD.settings)
BEGIN SELECT RAISE(ABORT,'Prepared grant binding/settings are immutable'); END;
INSERT INTO schema_version VALUES(23);
