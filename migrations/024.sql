-- Reviewed NEW initial grants for legacy unused enrollments. Previews reserve
-- no account or allowance and never backfill historical enrollment settings.
ALTER TABLE attempt_grants ADD COLUMN issuance TEXT NOT NULL DEFAULT 'ENROLLMENT';
CREATE TABLE grant_issuance_previews (
 id TEXT PRIMARY KEY, agent TEXT NOT NULL, actor TEXT NOT NULL,
 snapshot TEXT NOT NULL, revision TEXT NOT NULL, created INTEGER NOT NULL,
 expires INTEGER NOT NULL, status TEXT NOT NULL, issued TEXT NOT NULL
);
CREATE INDEX grant_issuance_owner ON grant_issuance_previews(agent,actor,created);
INSERT INTO schema_version VALUES(24);
