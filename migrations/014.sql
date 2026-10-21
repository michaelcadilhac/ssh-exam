CREATE TABLE exam_definition_requests (
  actor TEXT NOT NULL,
  request TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY(actor,request)
);
INSERT INTO schema_version VALUES(14);
