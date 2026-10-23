-- Lifecycle metadata stays outside saved exam settings and survives deletion.
-- Re-creation gets a new instance, so an old reviewed intent cannot target it.
CREATE TABLE exam_lifecycle (
 exam TEXT PRIMARY KEY, instance TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), changed_at INTEGER NOT NULL,
 legacy_unreconciled INTEGER NOT NULL DEFAULT 0 CHECK(legacy_unreconciled IN (0,1))
);
-- Web history alone cannot prove absence of legacy native-only recovery grants.
INSERT INTO exam_lifecycle SELECT id,lower(hex(randomblob(16))),1,0,0,0,1 FROM exams;
CREATE TRIGGER exam_lifecycle_created AFTER INSERT ON exams
BEGIN
 INSERT INTO exam_lifecycle VALUES(NEW.id,lower(hex(randomblob(16))),1,0,0,0,0)
 ON CONFLICT(exam) DO UPDATE SET instance=excluded.instance,version=exam_lifecycle.version+1,
 archived=0,deleted=0,changed_at=0;
END;
CREATE TRIGGER exam_lifecycle_deleted AFTER DELETE ON exams
BEGIN UPDATE exam_lifecycle SET deleted=1,version=version+1 WHERE exam=OLD.id; END;
CREATE TRIGGER exam_lifecycle_settings_changed AFTER UPDATE OF config ON exams
WHEN NEW.config IS NOT OLD.config
BEGIN UPDATE exam_lifecycle SET version=version+1 WHERE exam=NEW.id; END;
CREATE TRIGGER archived_definition_settings BEFORE UPDATE OF config ON exams
WHEN EXISTS(SELECT 1 FROM exam_lifecycle WHERE exam=OLD.id AND archived=1)
BEGIN SELECT RAISE(ABORT,'Archived definition: unarchive through reviewed exam management before changing defaults'); END;
CREATE TRIGGER archived_definition_enrollment BEFORE INSERT ON enrollments
WHEN EXISTS(SELECT 1 FROM exam_lifecycle WHERE exam=NEW.exam AND archived=1)
BEGIN SELECT RAISE(ABORT,'Archived definition: unarchive through reviewed exam management before roster import/enrollment'); END;
CREATE TRIGGER archived_definition_grant BEFORE INSERT ON attempt_grants
WHEN EXISTS(SELECT 1 FROM exam_lifecycle WHERE exam=NEW.exam AND archived=1)
BEGIN SELECT RAISE(ABORT,'Archived definition: unarchive through reviewed exam management before NEW grant issuance'); END;
CREATE TRIGGER archived_definition_attempt BEFORE INSERT ON attempts
WHEN EXISTS(SELECT 1 FROM exam_lifecycle WHERE exam=NEW.exam AND archived=1)
BEGIN SELECT RAISE(ABORT,'Archived definition: unarchive through reviewed exam management before NEW preparation'); END;
CREATE TRIGGER archived_definition_grant_reactivation BEFORE UPDATE OF status ON attempt_grants
WHEN NEW.status='AVAILABLE' AND OLD.status<>'AVAILABLE'
 AND EXISTS(SELECT 1 FROM exam_lifecycle WHERE exam=NEW.exam AND archived=1)
BEGIN SELECT RAISE(ABORT,'Archived definition: unarchive through reviewed exam management before reactivating a grant'); END;
CREATE TRIGGER unused_definition_only BEFORE DELETE ON exams
WHEN OLD.id='sandbox'
 OR EXISTS(SELECT 1 FROM exam_lifecycle WHERE exam=OLD.id AND legacy_unreconciled=1)
 OR EXISTS(SELECT 1 FROM enrollments WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM attempts WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM attempt_grants WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM previews WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM recovery_allowance_edits WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM recovery_grant_sources WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM grant_exam_modes WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM grant_issuance_previews WHERE json_extract(snapshot,'$.exam')=OLD.id)
BEGIN SELECT RAISE(ABORT,'Definition has history or is reserved; use reviewed archive, never cascade records'); END;
INSERT INTO schema_version VALUES(28);
