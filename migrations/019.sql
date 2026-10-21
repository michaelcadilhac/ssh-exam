CREATE INDEX monitoring_purges_status ON monitoring_purges(status,attempt);
INSERT INTO schema_version(version) VALUES(19);
