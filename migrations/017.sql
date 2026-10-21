-- No attempt foreign key: cancelled preparations may be retired before purge.
-- The durable tombstone ledger, not an extant attempt row, authorizes removal.
CREATE TABLE monitoring_purges(
  attempt TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','running','retry','verified-absent')),
  owner TEXT,
  tries INTEGER NOT NULL DEFAULT 0 CHECK(tries >= 0),
  next INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  verified INTEGER,
  error TEXT
);
CREATE INDEX monitoring_purges_due ON monitoring_purges(next,attempt);
CREATE INDEX monitoring_retention_due ON attempts(ended,id) WHERE ended IS NOT NULL;
INSERT INTO schema_version(version) VALUES(17);
