-- C18 durable native retention acknowledgements. Historical revisions and pins
-- remain inspectable; a timeout or missing gateway record never releases a pin.
CREATE TABLE grant_source_retentions (
 grant_id TEXT NOT NULL, revision INTEGER NOT NULL, grant_hash TEXT NOT NULL,
 source_attempt TEXT NOT NULL, checksum TEXT NOT NULL, uid INTEGER NOT NULL,
 metadata_hash TEXT NOT NULL, retention_hash TEXT NOT NULL,
 retained_at INTEGER NOT NULL, state TEXT NOT NULL, acknowledged_at INTEGER NOT NULL,
 PRIMARY KEY(grant_id,revision),
 FOREIGN KEY(grant_id,revision) REFERENCES grant_revisions(grant_id,revision)
);
INSERT INTO schema_version VALUES(31);
