-- Metadata-only queue. A lease never reserves a student account or starts time.
CREATE TABLE grant_source_setup (
 grant_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 agent TEXT NOT NULL,
 confirm_request TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','FAILED','READY','CANCELLED')),
 lease TEXT,
 lease_until INTEGER,
 tries INTEGER NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '',
 created INTEGER NOT NULL,
 updated INTEGER NOT NULL,
 PRIMARY KEY(grant_id,revision),
 FOREIGN KEY(grant_id,revision) REFERENCES grant_revisions(grant_id,revision)
);
CREATE INDEX grant_source_setup_queue ON grant_source_setup(agent,status,updated);
INSERT INTO schema_version VALUES(35);
