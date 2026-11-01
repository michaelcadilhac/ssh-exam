-- One unused permission per student/exam, including expired or disjoint windows.
-- Keep every original rowid, revision, claim, receipt and source-retention pin.
-- Never normalize a group containing setup or uncertain consumption evidence.
CREATE TEMP TABLE single_unused_grant_candidates AS
SELECT g.id grant_id, newest.id replacement_id
FROM attempt_grants g
JOIN (
 SELECT agent,exam,username,MAX(rowid) newest_rowid
 FROM attempt_grants
 WHERE status IN ('AVAILABLE','PENDING_NATIVE')
 GROUP BY agent,exam,username HAVING COUNT(*)>1
) duplicate_groups ON duplicate_groups.agent=g.agent AND duplicate_groups.exam=g.exam AND duplicate_groups.username=g.username
JOIN attempt_grants newest ON newest.rowid=duplicate_groups.newest_rowid
WHERE g.status IN ('AVAILABLE','PENDING_NATIVE');

CREATE TEMP TABLE single_unused_grant_guard(checked INTEGER);
CREATE TEMP TRIGGER single_unused_grant_guard_before_insert
BEFORE INSERT ON single_unused_grant_guard
WHEN EXISTS (
 SELECT 1 FROM single_unused_grant_candidates candidate
 JOIN attempt_grants g ON g.id=candidate.grant_id
 WHERE NOT EXISTS (
   SELECT 1 FROM grant_revisions r WHERE r.grant_id=g.id AND r.revision=g.revision
 ) OR EXISTS (
   SELECT 1 FROM grant_claims c WHERE c.grant_id=g.id AND c.state<>'CANCELLED'
 ) OR EXISTS (
   SELECT 1 FROM grant_claims c JOIN grant_begin_intents b ON b.attempt=c.attempt
   WHERE c.grant_id=g.id AND
    (b.state<>'CANCELLED' OR b.start IS NOT NULL OR b.deadline IS NOT NULL)
 ) OR EXISTS (
   SELECT 1 FROM attempts a WHERE a.grant_id=g.id AND
    (a.state<>'CANCELLED_BEFORE_START' OR a.start IS NOT NULL OR a.deadline IS NOT NULL
     OR a.original_deadline IS NOT NULL OR a.protected<>0 OR a.checksum IS NOT NULL
     OR a.registered_owner IS NOT NULL)
 )
)
BEGIN
 SELECT RAISE(ABORT,'Duplicate unused attempts have setup or uncertain history. Preserve the database; inspect Allowed attempts and cancel only verified unstarted setup before retrying the upgrade.');
END;
INSERT INTO single_unused_grant_guard VALUES(1);

INSERT INTO audit(id,at,actor,action,target,detail)
SELECT lower(hex(randomblob(16))),CAST(strftime('%s','now') AS INTEGER)*1000,
 'system:migration-036','migrate-supersede-unused-grant',g.id,
 json_object('exam',g.exam,'username',g.username,'revision',g.revision,
  'replacement',newest.id,'replacement_revision',newest.revision)
FROM single_unused_grant_candidates candidate
JOIN attempt_grants g ON g.id=candidate.grant_id
JOIN attempt_grants newest ON newest.id=candidate.replacement_id
WHERE candidate.grant_id<>candidate.replacement_id;

UPDATE attempt_grants SET status='REVOKED'
WHERE id IN (
 SELECT grant_id FROM single_unused_grant_candidates WHERE grant_id<>replacement_id
);

DROP TRIGGER single_unused_grant_guard_before_insert;
DROP TABLE single_unused_grant_guard;
DROP TABLE single_unused_grant_candidates;
CREATE UNIQUE INDEX single_unused_grant ON attempt_grants(agent,exam,username)
WHERE status IN ('AVAILABLE','PENDING_NATIVE');
INSERT INTO schema_version VALUES(36);
