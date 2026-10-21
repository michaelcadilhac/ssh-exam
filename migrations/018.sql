-- Metadata-only successful deletion intents; no media or attempt FK/cascade.
CREATE TABLE monitoring_deletion_requests(
  actor TEXT NOT NULL,
  request TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY(actor,request)
);
INSERT INTO schema_version(version) VALUES(18);
