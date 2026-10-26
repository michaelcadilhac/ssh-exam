-- Native terminal evidence is scoped to the exact lifecycle/web dependency graph.
-- Preserve the legacy fence: never infer reconciliation from a cleared flag.
CREATE TABLE exam_native_reconciliations (
 exam TEXT PRIMARY KEY, agent TEXT NOT NULL, dependency_hash TEXT NOT NULL,
 evidence_hash TEXT NOT NULL, evidence TEXT NOT NULL, acknowledged_at INTEGER NOT NULL,
 instance TEXT NOT NULL, version INTEGER NOT NULL,
 has_history INTEGER NOT NULL CHECK(has_history IN (0,1))
);
DROP TRIGGER unused_definition_only;
CREATE TRIGGER unused_definition_only BEFORE DELETE ON exams
WHEN OLD.id='sandbox'
 OR (EXISTS(SELECT 1 FROM exam_lifecycle WHERE exam=OLD.id AND legacy_unreconciled=1)
     AND NOT EXISTS(SELECT 1 FROM exam_native_reconciliations n JOIN exam_lifecycle l ON l.exam=n.exam
       WHERE n.exam=OLD.id AND n.instance=l.instance AND n.version=l.version))
 OR EXISTS(SELECT 1 FROM enrollments WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM attempts WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM attempt_grants WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM previews WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM recovery_allowance_edits WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM recovery_grant_sources WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM grant_exam_modes WHERE exam=OLD.id)
 OR EXISTS(SELECT 1 FROM grant_issuance_previews WHERE json_extract(snapshot,'$.exam')=OLD.id)
 OR EXISTS(SELECT 1 FROM exam_native_reconciliations WHERE exam=OLD.id AND has_history=1)
BEGIN SELECT RAISE(ABORT,'Definition has unreconciled authority/history or is reserved; use reviewed archive, never cascade records'); END;
INSERT INTO schema_version VALUES(33);
