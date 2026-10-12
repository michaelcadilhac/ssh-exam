-- Rebuild without the unconditional exam/student uniqueness constraint.
-- Keep ordinary exams single-attempt and retain every sandbox submission by UUID.
CREATE TABLE attempts_next(
id TEXT PRIMARY KEY, exam TEXT NOT NULL REFERENCES exams(id), username TEXT NOT NULL,
uid INTEGER NOT NULL, state TEXT NOT NULL, settings TEXT NOT NULL, start INTEGER,
deadline INTEGER, ended INTEGER, generation INTEGER NOT NULL DEFAULT 0, page_hash TEXT,
last_contact INTEGER, reason TEXT, work_path TEXT, export_status TEXT, checksum TEXT,
protected INTEGER NOT NULL DEFAULT 0, completed_at INTEGER, collected_at INTEGER,
secured_at INTEGER, access_state TEXT NOT NULL DEFAULT 'UNKNOWN', access_held_at INTEGER,
access_released_at INTEGER, access_override TEXT, access_checked_at INTEGER,
access_error TEXT, functional_test INTEGER NOT NULL DEFAULT 0);
INSERT INTO attempts_next SELECT * FROM attempts;
DROP TABLE attempts;
ALTER TABLE attempts_next RENAME TO attempts;
CREATE UNIQUE INDEX ordinary_exam_once ON attempts(exam,username) WHERE exam <> 'sandbox';
CREATE UNIQUE INDEX account_busy ON attempts(uid) WHERE state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED');
CREATE TRIGGER account_access_hold_insert BEFORE INSERT ON attempts
WHEN NEW.state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED')
BEGIN
 SELECT RAISE(ABORT, 'Account remains restricted by an original exam interval')
 WHERE EXISTS (SELECT 1 FROM attempts WHERE uid=NEW.uid AND
 (state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED') OR
 (start IS NOT NULL AND access_state NOT IN ('RELEASED','OVERRIDDEN'))));
END;
INSERT INTO schema_version VALUES(5);
