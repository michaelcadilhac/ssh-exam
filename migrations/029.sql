-- Runtime identity metadata only: no backfill, new grant or clock consumption.
ALTER TABLE grant_begin_intents ADD COLUMN owner_page TEXT;
ALTER TABLE attempts ADD COLUMN registered_owner TEXT;
INSERT INTO schema_version VALUES(29);
