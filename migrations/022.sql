-- Explicit operator allowance authorizations, not snapshots invented from
-- existing enrollments/defaults. Retain across enrollment removal and restore.
CREATE TABLE recovery_allowance_edits (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  exam TEXT NOT NULL REFERENCES exams(id),
  username TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK(duration BETWEEN 60 AND 21600 AND duration%60=0),
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX recovery_allowance_latest ON recovery_allowance_edits(exam,username,revision DESC);
-- A cancelled web preparation must not erase knowledge of its saved source.
-- This is an authenticated expectation, not a grant, claim or verified archive.
CREATE TABLE recovery_grant_sources (
  agent TEXT NOT NULL, exam TEXT NOT NULL REFERENCES exams(id), username TEXT NOT NULL,
  uid INTEGER NOT NULL, source_attempt TEXT NOT NULL, checksum TEXT NOT NULL,
  created_at INTEGER NOT NULL, receipt TEXT NOT NULL, observed INTEGER NOT NULL,
  PRIMARY KEY(agent,exam,username)
);
ALTER TABLE attempts ADD COLUMN recovery_preflight TEXT;
INSERT INTO schema_version VALUES(22);
